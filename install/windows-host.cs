// Compiled by the installer with the Windows .NET Framework compiler (/target:winexe).
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Windows.Forms;

internal static class MetisHost {
    static string root = Path.GetFullPath(AppDomain.CurrentDomain.BaseDirectory).TrimEnd(Path.DirectorySeparatorChar);
    static string logDir;
    static readonly object logLock = new object();
    static void Log(string name, string line) {
        if (line == null) return;
        lock (logLock) File.AppendAllText(Path.Combine(logDir, name + ".log"),
            DateTime.UtcNow.ToString("o") + " " + line + Environment.NewLine);
    }
    static Process Start(string exe, string args, string name) {
        var p = new Process();
        p.StartInfo = new ProcessStartInfo(exe, args) {
            WorkingDirectory = root, UseShellExecute = false, CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden, RedirectStandardOutput = true,
            RedirectStandardError = true
        };
        p.OutputDataReceived += (s, e) => Log(name, e.Data);
        p.ErrorDataReceived += (s, e) => Log(name, e.Data);
        p.Start(); p.BeginOutputReadLine(); p.BeginErrorReadLine(); return p;
    }
    static string Env(string key, string fallback) {
        return Environment.GetEnvironmentVariable(key) ?? fallback;
    }
    static void CheckPort(string key, string fallback) {
        int port = int.Parse(Env(key, fallback));
        var listener = new TcpListener(IPAddress.Any, port);
        listener.Server.ExclusiveAddressUse = true;
        try { listener.Start(); }
        catch (SocketException) { throw new Exception("Port " + port + " (" + key +
            ") is occupied or unavailable. Close the conflicting application or change " + key + " in " + Path.Combine(root, ".env")); }
        finally { listener.Stop(); }
    }
    static void OpenBrowser() {
        string url = "http://127.0.0.1:" + Env("PORT", "3100");
        for (int i = 0; i < 60; i++) {
            try {
                var request = (HttpWebRequest)WebRequest.Create(url + "/api/status");
                request.Timeout = 2000; request.AllowAutoRedirect = false;
                using (var response = request.GetResponse())
                using (var reader = new StreamReader(response.GetResponseStream())) {
                    string body = reader.ReadToEnd();
                    if (body.Contains("\"authenticated\"") && body.Contains("\"worker\"") && body.Contains("\"mcp\"")) {
                        Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); return;
                    }
                }
            } catch (WebException) {}
            Thread.Sleep(1000);
        }
        MessageBox.Show("Metis did not become ready at " + url + ". Check " + logDir +
            " for startup errors and port conflicts.", "Metis AI", MessageBoxButtons.OK, MessageBoxIcon.Error);
    }
    [STAThread]
    static void Main(string[] args) {
        bool open = Array.IndexOf(args, "--open") >= 0;
        bool stop = Array.IndexOf(args, "--stop") >= 0;
        try {
            foreach (string line in File.ReadAllLines(Path.Combine(root, ".env"))) {
                int pos = line.IndexOf('=');
                if (pos > 0 && !line.TrimStart().StartsWith("#"))
                    Environment.SetEnvironmentVariable(line.Substring(0, pos).Trim().Trim('\uFEFF'),
                        line.Substring(pos + 1).Trim().Trim('"'));
            }
            Environment.SetEnvironmentVariable("NODE_ENV", "production");
            logDir = Env("CHAT_DATA_DIR", Path.Combine(root, "data"));
            Directory.CreateDirectory(logDir);
            string id;
            using (var hash = SHA256.Create()) id = BitConverter.ToString(hash.ComputeHash(
                Encoding.UTF8.GetBytes(root.ToLowerInvariant()))).Replace("-", "");
            using (var stopEvent = new EventWaitHandle(false, EventResetMode.ManualReset, "Local\\MetisStop-" + id)) {
                if (stop) { stopEvent.Set(); return; }
                bool created;
                using (var mutex = new Mutex(true, "Local\\MetisHost-" + id, out created)) {
                    if (!created) { if (open) OpenBrowser(); return; }
                    stopEvent.Reset();
                    var children = new List<Process>();
                    try {
                        if (Env("PORT", "3100") == Env("MCP_PORT", "8787"))
                            throw new Exception("PORT and MCP_PORT must be different.");
                        bool docker = Env("METIS_DOCKER", "0") == "1";
                        if (!docker) { CheckPort("PORT", "3100"); CheckPort("MCP_PORT", "8787"); }
                        string node = Env("METIS_NODE_BIN", "node.exe");
                        string tsx = "--import tsx ";
                        string[] commands = {
                            "\"" + Path.Combine(root, "scripts/run-installed-service.cjs") + "\" app",
                            "\"" + Path.Combine(root, "scripts/run-installed-service.cjs") + "\" worker",
                            "\"" + Path.Combine(root, "scripts/run-installed-service.cjs") + "\" mcp"
                        };
                        string[] names = { "app", "worker", "mcp" };
                        if (docker) {
                            using (var compose = Start("docker.exe", "compose --env-file .env up -d --remove-orphans", "host")) {
                                compose.WaitForExit();
                                if (compose.ExitCode != 0) throw new Exception("Docker Compose failed. Check host.log.");
                            }
                        } else {
                            for (int i = 0; i < commands.Length; i++) children.Add(Start(node, commands[i], names[i]));
                        }
                        if (open) new Thread(OpenBrowser) { IsBackground = true }.Start();
                        while (!stopEvent.WaitOne(2000)) {
                            for (int i = 0; i < children.Count; i++) {
                                if (!children[i].HasExited) continue;
                                Log("host", names[i] + " exited; restarting.");
                                children[i].Dispose(); children[i] = Start(node, commands[i], names[i]);
                            }
                        }
                    } finally {
                        foreach (var child in children) {
                            try { if (!child.HasExited) child.Kill(); child.WaitForExit(); } catch (InvalidOperationException) {}
                            child.Dispose();
                        }
                        mutex.ReleaseMutex();
                    }
                }
            }
        } catch (Exception e) {
            if (logDir != null) Log("host", e.ToString());
            if (open) MessageBox.Show(e.Message, "Metis AI", MessageBoxButtons.OK, MessageBoxIcon.Error);
            Environment.ExitCode = 1;
        }
    }
}
