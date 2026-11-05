import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { captureDesktopPreview, listDesktopMonitors } from "./desktop-preview.mjs";
import { unixComputerUse } from "./computer-use-unix.mjs";

const execFileAsync = promisify(execFile);
const observations = new Map();
const MAX_AGE_MS = 30_000;
const SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class MetisDesktop {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public INPUTUNION U; }
  [StructLayout(LayoutKind.Explicit, Size=32)] public struct INPUTUNION { [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public IntPtr dwExtraInfo; }
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int max);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint attach, uint attachTo, bool attachState);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int command);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
  [DllImport("user32.dll")] public static extern uint SendInput(uint count, INPUT[] inputs, int size);
  [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
  [DllImport("user32.dll")] public static extern bool CloseDesktop(IntPtr desktop);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern bool GetUserObjectInformation(IntPtr handle, int index, StringBuilder info, int length, out int needed);
  public static void Scroll(int delta) { mouse_event(2048, 0, 0, unchecked((uint)delta), UIntPtr.Zero); }
  public static string InputDesktop() {
    IntPtr desktop = OpenInputDesktop(0, false, 1);
    if (desktop == IntPtr.Zero) return "";
    try { var name = new StringBuilder(256); int needed; return GetUserObjectInformation(desktop, 2, name, name.Capacity*2, out needed) ? name.ToString() : ""; }
    finally { CloseDesktop(desktop); }
  }
  public static string Title(IntPtr h) { var s = new StringBuilder(Math.Min(GetWindowTextLength(h)+1, 4096)); GetWindowText(h,s,s.Capacity); return s.ToString(); }
  public static bool ActivateWindow(IntPtr h) {
    ShowWindow(h, 9);
    IntPtr foreground = GetForegroundWindow();
    uint ignored;
    uint foregroundThread = foreground == IntPtr.Zero ? 0 : GetWindowThreadProcessId(foreground, out ignored);
    uint currentThread = GetCurrentThreadId();
    bool attached = foregroundThread != 0 && foregroundThread != currentThread && AttachThreadInput(currentThread, foregroundThread, true);
    try {
      BringWindowToTop(h);
      SetForegroundWindow(h);
    } finally {
      if (attached) AttachThreadInput(currentThread, foregroundThread, false);
    }
    return GetForegroundWindow() == h;
  }
  public static void Text(string value) {
    foreach (char c in value) {
      var down = new INPUT { type=1, U=new INPUTUNION { ki=new KEYBDINPUT { wScan=c, dwFlags=4 } } };
      var up = new INPUT { type=1, U=new INPUTUNION { ki=new KEYBDINPUT { wScan=c, dwFlags=6 } } };
      if (SendInput(2, new INPUT[]{down,up}, Marshal.SizeOf(typeof(INPUT))) != 2) throw new Exception("SendInput text failed");
    }
  }
}
'@
$inputData = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($args[0])) | ConvertFrom-Json
$operation = [string]$inputData.operation
[MetisDesktop]::SetProcessDPIAware() | Out-Null
if ([MetisDesktop]::GetSystemMetrics(80) -lt 1) { throw 'No interactive display is available' }
if ([MetisDesktop]::InputDesktop() -ne 'Default') { throw 'The Windows desktop is locked or unavailable' }
if ($operation -eq 'status') {
  @{ available = $true; monitors = [MetisDesktop]::GetSystemMetrics(80) } | ConvertTo-Json -Compress
  exit
}
if ($operation -eq 'list_windows') {
  $items = [Collections.Generic.List[object]]::new()
  $callback = [MetisDesktop+EnumWindowsProc]{
    param($h, $unused)
    if ([MetisDesktop]::IsWindowVisible($h)) {
      $title = [MetisDesktop]::Title($h)
      $r = [MetisDesktop+RECT]::new()
      if ($title -and [MetisDesktop]::GetWindowRect($h, [ref]$r) -and $r.Right -gt $r.Left -and $r.Bottom -gt $r.Top) {
        $items.Add(@{ id = $h.ToInt64().ToString(); title = $title; x = $r.Left; y = $r.Top; width = $r.Right-$r.Left; height = $r.Bottom-$r.Top })
      }
    }
    return $true
  }
  [MetisDesktop]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null
  @{ windows = @($items.ToArray()) } | ConvertTo-Json -Compress -Depth 4
  exit
}
$handle = [IntPtr]([long]$inputData.windowId)
if (-not [MetisDesktop]::IsWindow($handle) -or -not [MetisDesktop]::IsWindowVisible($handle)) { throw 'Target window is unavailable' }
$rect = [MetisDesktop+RECT]::new()
if (-not [MetisDesktop]::GetWindowRect($handle, [ref]$rect)) { throw 'Cannot locate target window' }
$width = $rect.Right-$rect.Left
$height = $rect.Bottom-$rect.Top
if ($width -lt 1 -or $height -lt 1 -or $width -gt 8000 -or $height -gt 8000) { throw 'Target window size is invalid' }
if ($operation -eq 'observe') {
  if (-not [MetisDesktop]::ActivateWindow($handle)) { throw 'Could not activate target window' }
  Start-Sleep -Milliseconds 80
  $bitmap = [Drawing.Bitmap]::new($width, $height)
  try {
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    try { $graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bitmap.Size) }
    finally { $graphics.Dispose() }
    $stream = [IO.MemoryStream]::new()
    try {
      $bitmap.Save($stream, [Drawing.Imaging.ImageFormat]::Png)
      @{ windowId = $inputData.windowId; title = [MetisDesktop]::Title($handle); width = $width; height = $height; png = [Convert]::ToBase64String($stream.ToArray()) } | ConvertTo-Json -Compress
    } finally { $stream.Dispose() }
  } finally { $bitmap.Dispose() }
  exit
}
if (-not [MetisDesktop]::ActivateWindow($handle)) { throw 'Could not activate target window' }
Start-Sleep -Milliseconds 80
function Position($px, $py) {
  $x = [int]$px; $y = [int]$py
  if ($x -lt 0 -or $y -lt 0 -or $x -ge $width -or $y -ge $height) { throw 'Coordinates are outside the target window' }
  if (-not [MetisDesktop]::SetCursorPos($rect.Left+$x, $rect.Top+$y)) { throw 'Could not move pointer' }
}
if ($operation -eq 'move') {
  Position $inputData.x $inputData.y
} elseif ($operation -eq 'click') {
  Position $inputData.x $inputData.y
  $button = [string]$inputData.button
  $down = 2; $up = 4
  if ($button -eq 'right') { $down = 8; $up = 16 }
  if ($button -eq 'middle') { $down = 32; $up = 64 }
  $count = [Math]::Max(1,[Math]::Min(3,[int]$inputData.count))
  for ($i=0; $i -lt $count; $i++) {
    [MetisDesktop]::mouse_event($down,0,0,0,[UIntPtr]::Zero)
    [MetisDesktop]::mouse_event($up,0,0,0,[UIntPtr]::Zero)
    if ($i+1 -lt $count) { Start-Sleep -Milliseconds 80 }
  }
} elseif ($operation -eq 'scroll') {
  Position $inputData.x $inputData.y
  $delta = [int]$inputData.deltaY
  [MetisDesktop]::Scroll($delta)
} elseif ($operation -eq 'drag') {
  Position $inputData.x $inputData.y
  [MetisDesktop]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
  try {
    for ($i=1; $i -le 12; $i++) {
      $px = [int]([int]$inputData.x + ([int]$inputData.toX-[int]$inputData.x)*$i/12)
      $py = [int]([int]$inputData.y + ([int]$inputData.toY-[int]$inputData.y)*$i/12)
      Position $px $py
      Start-Sleep -Milliseconds 12
    }
  } finally { [MetisDesktop]::mouse_event(4,0,0,0,[UIntPtr]::Zero) }
} elseif ($operation -eq 'type') {
  [MetisDesktop]::Text([string]$inputData.text)
} elseif ($operation -eq 'key') {
  $keys = @([string]$inputData.key -split '\+' | ForEach-Object { $_.Trim().ToLowerInvariant() })
  $map = @{ ctrl=17; control=17; shift=16; alt=18; enter=13; return=13; tab=9; escape=27; esc=27; backspace=8; delete=46; space=32; up=38; down=40; left=37; right=39; home=36; end=35; pageup=33; pagedown=34; insert=45; f1=112; f2=113; f3=114; f4=115; f5=116; f6=117; f7=118; f8=119; f9=120; f10=121; f11=122; f12=123 }
  $codes = [Collections.Generic.List[byte]]::new()
  foreach ($key in $keys) {
    if ($key -in @('win','windows','meta','super','cmd','command')) { throw 'System key is unavailable' }
    $code = if ($map.ContainsKey($key)) { $map[$key] } elseif ($key -match '^[a-z0-9]$') { [int][char]$key.ToUpperInvariant() } else { throw "Unsupported key: $key" }
    $codes.Add([byte]$code)
  }
  try {
    foreach ($code in $codes) { [MetisDesktop]::keybd_event($code,0,0,[UIntPtr]::Zero) }
  } finally {
    for ($i=$codes.Count-1; $i -ge 0; $i--) { [MetisDesktop]::keybd_event($codes[$i],0,2,[UIntPtr]::Zero) }
  }
} else { throw 'Unsupported computer use operation' }
@{ ok = $true; windowId = $inputData.windowId } | ConvertTo-Json -Compress
`;

function finiteInt(value, label, min = -100000, max = 100000) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw new Error(`${label} must be an integer from ${min} to ${max}`);
  return number;
}

export async function computerUse(params = {}, { signal } = {}) {
  const operation = String(params.operation || "");
  if (operation === "preview") return captureDesktopPreview({ signal, monitorId: params.monitorId });
  if (operation === "monitors") return listDesktopMonitors({ signal });
  const allowed = ["status", "list_windows", "observe", "move", "click", "scroll", "drag", "type", "key", "request_permissions"];
  if (!allowed.includes(operation)) throw new Error("Unsupported computer use operation");
  const payload = { operation };
  if (!["status", "list_windows", "request_permissions"].includes(operation)) {
    const windowId = String(params.windowId || "");
    if (!/^\d{1,20}$/.test(windowId)) throw new Error("Select a returned window ID");
    payload.windowId = windowId;
  }
  if (["move", "click", "scroll", "drag", "type", "key"].includes(operation)) {
    const observation = observations.get(String(params.observationId || ""));
    if (!observation || observation.windowId !== payload.windowId || Date.now() - observation.at > MAX_AGE_MS) {
      throw new Error("Observe this window again before acting");
    }
    payload.expectedGeometry = observation.geometry;
    payload.coordinateScale = observation.scale;
    observations.delete(String(params.observationId));
  }
  if (["move", "click", "scroll", "drag"].includes(operation)) {
    payload.x = finiteInt(params.x, "x", 0, 8000);
    payload.y = finiteInt(params.y, "y", 0, 8000);
  }
  if (operation === "click") {
    payload.button = ["left", "right", "middle"].includes(params.button) ? params.button : "left";
    payload.count = finiteInt(params.count ?? 1, "count", 1, 3);
  }
  if (operation === "scroll") payload.deltaY = finiteInt(params.deltaY, "deltaY", -2400, 2400);
  if (operation === "drag") {
    payload.toX = finiteInt(params.toX, "toX", 0, 8000);
    payload.toY = finiteInt(params.toY, "toY", 0, 8000);
  }
  if (operation === "type") {
    if (typeof params.text !== "string" || params.text.length > 2000) throw new Error("Text must contain at most 2000 characters");
    payload.text = params.text;
  }
  if (operation === "key") {
    if (typeof params.key !== "string" || !/^[A-Za-z0-9+ ]{1,60}$/.test(params.key)) throw new Error("Invalid key chord");
    payload.key = params.key;
  }
  if (payload.coordinateScale) {
    for (const key of ["x", "toX"]) if (key in payload) payload[key] = Math.floor(payload[key] * payload.coordinateScale.x);
    for (const key of ["y", "toY"]) if (key in payload) payload[key] = Math.floor(payload[key] * payload.coordinateScale.y);
  }
  let result;
  if (process.platform !== "win32") {
    result = await unixComputerUse(payload, { signal });
  } else {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64");
  const command = Buffer.from(SCRIPT.replace("$args[0]", `'${encoded}'`), "utf16le").toString("base64");
  let stdout;
  try {
    ({ stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", command], {
      windowsHide: true,
      timeout: 30_000,
      signal,
      maxBuffer: 16 * 1024 * 1024,
    }));
  } catch (error) {
    if (signal?.aborted) throw new Error("Computer Use was cancelled on this device");
    const stderr = String(error?.stderr || "");
    const match = stderr.match(/<S S="Error">([^<]+)/);
    const detail = match?.[1]?.split("_x000D__x000A_")[0]?.replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">")?.trim();
    throw new Error(detail || (error?.killed ? "Computer Use timed out" : "Computer Use failed on Windows"));
  }
  result = JSON.parse(stdout.trim());
  }
  if (operation === "observe") {
    const observationId = randomUUID();
    observations.clear();
    observations.set(observationId, { windowId: payload.windowId, at: Date.now(),
      geometry: process.platform !== "win32" ? { x: result.x, y: result.y,
        width: result.coordinateWidth ?? result.width, height: result.coordinateHeight ?? result.height } : undefined,
      scale: { x: (result.coordinateWidth ?? result.width) / result.width,
        y: (result.coordinateHeight ?? result.height) / result.height } });
    return { ...result, observationId };
  }
  return result;
}
