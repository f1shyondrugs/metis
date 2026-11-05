// Passive monitor discovery/capture: never changes foreground windows or input.
const windowsDesktopSetup = String.raw`
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class MetisPreview {
 [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
 [DllImport("user32.dll")] public static extern IntPtr OpenInputDesktop(uint f,bool i,uint a);
 [DllImport("user32.dll")] public static extern bool CloseDesktop(IntPtr h);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern bool GetUserObjectInformation(IntPtr h,int n,StringBuilder s,int l,out int r);
 public static bool Unlocked() {
  IntPtr h=OpenInputDesktop(0,false,1); if(h==IntPtr.Zero)return false;
  try { var s=new StringBuilder(256); int n; return GetUserObjectInformation(h,2,s,512,out n)&&s.ToString()=="Default"; }
  finally { CloseDesktop(h); }
 }
}
'@
[MetisPreview]::SetProcessDPIAware() | Out-Null
if(-not [MetisPreview]::Unlocked()){throw 'The Windows desktop is locked or unavailable'}
$screens=@([Windows.Forms.Screen]::AllScreens)
`;

export function validateDesktopMonitorId(monitorId) {
  if (monitorId === undefined) return undefined;
  if (typeof monitorId !== "string" || !monitorId.length || monitorId.length > 200 || /[\u0000-\u001f\u007f]/.test(monitorId)) {
    throw new Error("Invalid monitor ID");
  }
  return monitorId;
}

export const windowsDesktopMonitorsScript = windowsDesktopSetup + String.raw`
@{monitors=@($screens | ForEach-Object {
 @{id=$_.DeviceName;name=$_.DeviceName;x=$_.Bounds.X;y=$_.Bounds.Y;width=$_.Bounds.Width;height=$_.Bounds.Height;primary=[bool]$_.Primary}
})} | ConvertTo-Json -Depth 4 -Compress
`;

export function buildWindowsDesktopPreviewScript(monitorId) {
  const selected = validateDesktopMonitorId(monitorId);
  // Base64 JSON is data, never interpolated PowerShell source.
  const payload = Buffer.from(JSON.stringify(selected === undefined ? {} : { monitorId: selected }), "utf8").toString("base64");
  return windowsDesktopSetup + `
$selection=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')) | ConvertFrom-Json
$screen=$null
if($null -eq $selection.monitorId) {$screen=[Windows.Forms.Screen]::PrimaryScreen}
else {$screen=$screens | Where-Object {$_.DeviceName -ceq $selection.monitorId} | Select-Object -First 1}
if($null -eq $screen){throw 'Selected monitor is unavailable'}
$r=$screen.Bounds
` + String.raw`
if($r.Width -lt 1 -or $r.Height -lt 1){throw 'No interactive display is available'}
$b=[Drawing.Bitmap]::new($r.Width,$r.Height)
try {
 $g=[Drawing.Graphics]::FromImage($b)
 try {$g.CopyFromScreen($r.Left,$r.Top,0,0,$b.Size)} finally {$g.Dispose()}
 $w=[Math]::Min(1600,$r.Width); $h=[Math]::Max(1,[int]($r.Height*$w/$r.Width))
 $small=[Drawing.Bitmap]::new($w,$h)
 try {
  $g=[Drawing.Graphics]::FromImage($small)
  try {$g.DrawImage($b,0,0,$w,$h)} finally {$g.Dispose()}
  $s=[IO.MemoryStream]::new()
  try {
   $small.Save($s,[Drawing.Imaging.ImageFormat]::Jpeg)
   @{image_base64=[Convert]::ToBase64String($s.ToArray());mimeType='image/jpeg';width=$w;height=$h;monitorId=$screen.DeviceName} | ConvertTo-Json -Compress
  } finally {$s.Dispose()}
 } finally {$small.Dispose()}
} finally {$b.Dispose()}
`;
}

export const windowsDesktopPreviewScript = buildWindowsDesktopPreviewScript();
function encodedCommand(script) {
  return "powershell.exe -NoProfile -NonInteractive -EncodedCommand " + Buffer.from(script, "utf16le").toString("base64");
}
export function windowsDesktopPreviewCommand(monitorId) {
  return encodedCommand(buildWindowsDesktopPreviewScript(monitorId));
}
export function windowsDesktopMonitorsCommand() {
  return encodedCommand(windowsDesktopMonitorsScript);
}
