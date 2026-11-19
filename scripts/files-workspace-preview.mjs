#!/usr/bin/env node
// Isolated fixture with real production components and the installed Monaco runtime.
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import postcss from "postcss";
import tailwindcss from "@tailwindcss/postcss";

const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("tsx"))("esbuild");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const directory = path.join(root, "output", "file-fix-verify");
const requireMonaco = createRequire(require.resolve("@monaco-editor/react"));
// Resolve from the component's dependency tree; Monaco's exports do not include its package.json.
const monaco = path.resolve(path.dirname(requireMonaco.resolve("monaco-editor/editor/editor.api")), "../../../min");
const port = Number(process.argv[2] || 3264);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Expected a local test port.");
fs.mkdirSync(directory, { recursive: true });
await build({ absWorkingDir: root, tsconfig: path.join(root, "tsconfig.json"), entryPoints: ["tests/files-workspace.browser.tsx"],
  outfile: path.join(directory, "app.js"), bundle: true, platform: "browser", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" } });
const globalCss = path.join(root, "app/globals.css");
const css = await postcss([tailwindcss()]).process(fs.readFileSync(globalCss, "utf8"), { from: globalCss });
fs.writeFileSync(path.join(directory, "theme.css"), css.css);
const mime = { ".css": "text/css", ".js": "text/javascript", ".ttf": "font/ttf" };
http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/report" && req.method === "POST") {
    let body = "";
    for await (const part of req) { body += part; if (body.length > 100) return res.writeHead(413).end(); }
    if (!/^(JUMP (first|second|deletion) L\d+ (inline|split)|FILES NAME MATCHES|CONTENT NAME MATCHES|DOTFILE OPEN)$/.test(body)) return res.writeHead(400).end();
    fs.appendFileSync(path.join(directory, "browser.log"), body + "\n");
    return res.writeHead(204).end();
  }
  if (url.pathname === "/") return res.writeHead(200, { "Content-Type": "text/html" }).end('<!doctype html><html lang="en" class="dark"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Files regression preview</title><link rel="stylesheet" href="/theme.css"><body><div id="root"></div><script src="/app.js"></script></body></html>');
  const file = url.pathname.startsWith("/monaco/vs/") ? path.resolve(monaco, "." + url.pathname.slice("/monaco".length)) :
    ["/app.js", "/theme.css"].includes(url.pathname) ? path.join(directory, url.pathname) : "";
  if (!file || ![directory + path.sep, monaco + path.sep].some(prefix => file.startsWith(prefix))) return res.writeHead(404).end();
  try { res.writeHead(200, { "Content-Type": mime[path.extname(file)] || "application/octet-stream" }).end(fs.readFileSync(file)); }
  catch { res.writeHead(404).end(); }
}).listen(port, "127.0.0.1", () => console.log("FILES_PREVIEW_READY", port));
