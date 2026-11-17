param(
  [Parameter(Position=0)][string]$Command = "",
  [string]$InstallDir = "",
  [string]$RepoUrl = $env:METIS_AI_REPO_URL,
  [string]$DataDir = "",
  [string]$AgentCwd = "",
  [string]$Port = "3100",
  [Alias("Host")][string]$BindHost = "127.0.0.1",
  [string]$McpPort = "8787",
  [string]$Username = "admin",
  [string]$Password = "",
  [string]$PasswordFile = "",
  [string]$ServiceName = "MetisAI",
  [string]$PublicUrl = "",
  [string]$Version = "",
  [string]$Commit = "",
  [switch]$NonInteractive,
  [switch]$SkipRuntimeInstall,
  [switch]$Native,
  [switch]$Docker,
  [switch]$ReplaceExisting,
  [switch]$DryRun,
  [switch]$Help,
  [switch]$Yes,
  [switch]$KeepData,
  [switch]$RemoveData
)

$ErrorActionPreference = "Stop"
if ($Help) {
  @"
Usage:
  windows.ps1                         Guided installation
  windows.ps1 -NonInteractive

This script must be invoked with powershell -File. Do not pipe it to iex;
use install.ps1 for the one-line installer.

Options: -InstallDir, -DataDir, -AgentCwd, -Port, -Host, -McpPort,
         -Username, -Password, -PasswordFile, -ServiceName, -PublicUrl, -Version, -Commit
         -NonInteractive, -SkipRuntimeInstall, -Native, -ReplaceExisting, -DryRun
         uninstall [-Yes] [-KeepData] [-InstallDir DIR]
"@ | Write-Host
  exit 0
}
if ($Command -eq "uninstall") {
  $selfDir = Split-Path -Parent $MyInvocation.MyCommand.Path
  $uninstaller = Join-Path $selfDir "uninstall.ps1"
  if (-not (Test-Path -LiteralPath $uninstaller)) {
    $uninstaller = Join-Path (Join-Path $selfDir "install") "uninstall.ps1"
  }
  if (-not (Test-Path -LiteralPath $uninstaller)) { throw "Could not find uninstall.ps1 next to windows.ps1." }
  $forward = @()
  if ($InstallDir) { $forward += @("-InstallDir", $InstallDir) }
  if ($ServiceName) { $forward += @("-ServiceName", $ServiceName) }
  if ($KeepData) { $forward += "-KeepData" }
  if ($RemoveData) { $forward += "-RemoveData" }
  if ($DryRun) { $forward += "-DryRun" }
  if ($Yes) { $forward += "-Yes" }
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $uninstaller @forward
  exit $LASTEXITCODE
}
if (-not $RepoUrl) { $RepoUrl = "https://github.com/f1shyondrugs/metis-ai.git" }
if (-not $InstallDir) {
  $InstallDir = if ($env:METIS_AI_INSTALL_DIR) { $env:METIS_AI_INSTALL_DIR } else { Join-Path $HOME "metis-ai" }
}

function Ask([string]$Prompt, [string]$Default) {
  if ($NonInteractive) { return $Default }
  $value = Read-Host "$Prompt [$Default]"
  if ([string]::IsNullOrWhiteSpace($value)) { return $Default }
  return $value
}
function Get-DefaultPublicHost {
  $ip = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" } |
    Select-Object -First 1 -ExpandProperty IPAddress
  if ($ip) { return $ip }
  return "127.0.0.1"
}
function Require-Command([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) { throw "$Name is required." }
}
function Refresh-Path {
  $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
    [Environment]::GetEnvironmentVariable("Path", "User")
}
function Get-NodeMajor {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) { return 0 }
  try { return [int]((& $node.Source -p "process.versions.node.split('.')[0]")) } catch { return 0 }
}
function Confirm-Install([string]$Name) {
  if ($NonInteractive) { return $true }
  $answer = Read-Host "$Name is missing or too old. Install/update it automatically now? (Y/n)"
  return [string]::IsNullOrWhiteSpace($answer) -or $answer -match "^(y|yes)$"
}

if ($PasswordFile) {
  if (-not (Test-Path -LiteralPath $PasswordFile -PathType Leaf)) { throw "Password file is not readable: $PasswordFile" }
  $Password = (Get-Content -LiteralPath $PasswordFile -Raw).TrimEnd("`r", "`n")
}

$port = $Port
$mcpPort = $McpPort
$username = $Username
$serviceName = $ServiceName
$dataDir = if ($DataDir) { $DataDir } else { Join-Path $InstallDir "data" }
$agentCwd = if ($AgentCwd) { $AgentCwd } else { $HOME }

if (-not $NonInteractive) {
  $InstallDir = Ask "Installation directory" $InstallDir
  $dataDir = if ($DataDir) { $DataDir } else { Join-Path $InstallDir "data" }
  $aiChatHost = if ($BindHost) { $BindHost } else { "127.0.0.1" }
} else {
  $aiChatHost = if ($BindHost) { $BindHost } else { "127.0.0.1" }
}
$passwordPlain = $Password
if ($Password -and $Password.Length -lt 8) { throw "Password must contain at least 8 characters." }
if ($Docker) { throw "Docker installation is no longer available. Use the native installer." }
$Native = $true
$legacyManifest = Join-Path $InstallDir ".metis-ai-install.json"
if ((Test-Path -LiteralPath $legacyManifest) -and (Get-Content -LiteralPath $legacyManifest -Raw | ConvertFrom-Json).installMethod -eq "docker") {
  throw "This directory contains a legacy Docker installation. Choose a separate directory for native installation; migrate data separately."
}
if ($Commit -and $Version) { throw "Use either -Version or -Commit, not both." }
if ($Commit) {
  if ($Commit -notmatch '^[0-9a-fA-F]{7,40}$') { throw "Commit must be a git SHA." }
} else {
  if ([string]::IsNullOrWhiteSpace($Version) -or $Version -eq "latest") {
    try {
      $release = Invoke-RestMethod -Headers @{ Accept = "application/vnd.github+json" } -Uri "https://api.github.com/repos/f1shyondrugs/metis-ai/releases/latest"
      $Version = [string]$release.tag_name
    } catch {
      throw "Could not resolve the latest stable Metis AI release."
    }
  }
  if ($Version -notmatch '^v\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$') {
    throw "The selected stable release tag is invalid or unavailable: $Version"
  }
}
# Preflight uses GitHub metadata, so a fresh machine does not need Git yet.
if ($RepoUrl -match '^https://github\.com/(.+?)(?:\.git)?$') {
  $repoSlug = $Matches[1]
  if ($Commit) {
    try {
      $commitInfo = Invoke-RestMethod -Headers @{ Accept = "application/vnd.github+json" } -Uri "https://api.github.com/repos/$repoSlug/commits/$Commit"
      $Commit = [string]$commitInfo.sha
    } catch { throw "The selected commit is unavailable: $Commit" }
    if ($Commit -notmatch '^[0-9a-fA-F]{40}$') { throw "GitHub returned no valid commit." }
  } else {
    if (-not $release) {
      try { $release = Invoke-RestMethod -Headers @{ Accept = "application/vnd.github+json" } -Uri "https://api.github.com/repos/$repoSlug/releases/tags/$Version" }
      catch { throw "The selected published release is unavailable: $Version" }
    }
    if (-not ($release.assets | Where-Object { $_.name -eq "SHA256SUMS" })) { throw "The selected release has no installer checksum asset." }
  }
}
if (-not $env:METIS_AI_INSTALL_BASE) {
  $selectedRef = if ($Commit) { $Commit } else { $Version }
  $env:METIS_AI_INSTALL_BASE = "https://raw.githubusercontent.com/f1shyondrugs/metis-ai/$selectedRef"
}
# Account creation takes place in the browser.

$publicHost = if ($aiChatHost -eq "0.0.0.0") { Get-DefaultPublicHost } else { "127.0.0.1" }
$publicUrl = if ($PublicUrl) { $PublicUrl } else { "http://$publicHost`:$port" }

$portNumber = 0
$mcpPortNumber = 0
if (-not [int]::TryParse($port, [ref]$portNumber) -or $portNumber -lt 1 -or $portNumber -gt 65535) {
  throw "Web port must be a number between 1 and 65535."
}
if (-not [int]::TryParse($mcpPort, [ref]$mcpPortNumber) -or $mcpPortNumber -lt 1 -or $mcpPortNumber -gt 65535) {
  throw "MCP port must be a number between 1 and 65535."
}
if ($port -eq $mcpPort) { throw "Web and MCP ports must be different." }
if ($serviceName -notmatch '^[A-Za-z0-9][A-Za-z0-9_-]*$') {
  throw "Service name may contain letters, numbers, underscores and hyphens."
}

$existingServiceDir = ""
$appKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$serviceName"
try {
  $existingServiceDir = (Get-ItemProperty -LiteralPath $appKey -ErrorAction Stop).InstallLocation
} catch {}
try {
  $existingRun = (Get-ItemProperty -LiteralPath "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -Name "$serviceName-app" -ErrorAction Stop)."$serviceName-app"
  if ($existingRun -and -not $existingServiceDir) {
    $cmdPath = [string]$existingRun.Trim().Trim('"')
    if (Test-Path -LiteralPath $cmdPath) { $existingServiceDir = Split-Path -Parent $cmdPath }
  }
} catch {}

if ($DryRun) {
  Write-Host "Dry run; no files or services will be changed."
  Write-Host "  os:            windows"
  Write-Host "  install dir:   $InstallDir"
  Write-Host "  data dir:      $dataDir"
  Write-Host "  agent cwd:     $agentCwd"
  Write-Host "  bind:          ${aiChatHost}:${port}"
  Write-Host "  mcp port:      $mcpPort"
  Write-Host "  service name:  $serviceName"
  Write-Host "  public url:    $publicUrl"
  Write-Host "  username:      $username"
  Write-Host "  native:        $Native"
  if ($existingServiceDir) { Write-Host "  existing:      $serviceName-app at $existingServiceDir" } else { Write-Host "  existing:      none" }
  exit 0
}

function Test-OwnedDockerPort([int]$Number) {
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { return $false }
  try {
    $ownedPorts = & docker ps --filter "label=com.docker.compose.project.working_dir=$InstallDir" --format "{{.Ports}}" 2>$null
    if ($LASTEXITCODE -ne 0) { return $false }
    return [bool](@($ownedPorts | Where-Object { $_ -match ":$Number->" }).Count)
  } catch { return $false }
}

function Assert-AvailablePorts([string]$WebPort, [string]$GatewayPort) {
  if ($WebPort -eq $GatewayPort) { throw "Web and MCP ports must be different." }
  foreach ($entry in @(@{ Name = "Web"; Port = $WebPort }, @{ Name = "MCP"; Port = $GatewayPort })) {
    $number = 0
    if (-not [int]::TryParse($entry.Port, [ref]$number) -or $number -lt 1 -or $number -gt 65535) {
      throw "$($entry.Name) port must be between 1 and 65535."
    }
    if (Test-OwnedDockerPort $number) { continue }
    $owners = @(Get-NetTCPConnection -State Listen -LocalPort $number -ErrorAction SilentlyContinue)
    foreach ($owner in $owners) {
      $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$($owner.OwningProcess)" -ErrorAction SilentlyContinue
      $owned = $proc -and $proc.CommandLine -and
        $proc.CommandLine.IndexOf([IO.Path]::GetFullPath($InstallDir) + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and
        $proc.CommandLine -match 'server\.mjs|gateway-core\.mjs|MetisHost\.exe'
      # Legacy node children may use relative paths; verify their PowerShell parent.
      if (-not $owned -and $proc) {
        $parent = Get-CimInstance Win32_Process -Filter "ProcessId=$($proc.ParentProcessId)" -ErrorAction SilentlyContinue
        $owned = $parent -and $parent.CommandLine -and
          $parent.CommandLine.IndexOf([IO.Path]::GetFullPath($InstallDir) + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and
          $parent.CommandLine -match 'run-service\.ps1'
      }
      if (-not $owned) {
        throw "$($entry.Name) port $number is already occupied by $($proc.Name) (PID $($owner.OwningProcess)). Metis has not been started. Choose a free -Port / -McpPort or close the conflicting application (for example OpenWebUI)."
      }
    }
    if ($owners.Count -eq 0) {
      $listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Any, $number)
      $listener.Server.ExclusiveAddressUse = $true
      try { $listener.Start() } catch { throw "$($entry.Name) port $number cannot be bound. Choose a free -Port / -McpPort. $($_.Exception.Message)" }
      finally { $listener.Stop() }
    }
  }
}

$script:ReplaceDataStash = $null
$script:ReplaceEnvStash = $null

function Get-EnvStashPath([string]$Dir) {
  $full = [IO.Path]::GetFullPath($Dir).TrimEnd('\')
  return Join-Path (Split-Path -Parent $full) (".$(Split-Path -Leaf $full).metis-keep-env")
}

function Get-EnvKey([string]$Line) {
  $trim = $Line.Trim()
  if (-not $trim -or $trim.StartsWith('#')) { return "" }
  $idx = $trim.IndexOf('=')
  if ($idx -lt 1) { return "" }
  return $trim.Substring(0, $idx)
}

function Save-ExistingEnv([string]$Dir) {
  $src = Join-Path $Dir ".env"
  if (-not (Test-Path -LiteralPath $src)) { return }
  $script:ReplaceEnvStash = Get-EnvStashPath $Dir
  Copy-Item -LiteralPath $src -Destination $script:ReplaceEnvStash -Force
  Write-Host "Kept previous .env at $($script:ReplaceEnvStash)"
}

function Adopt-EnvStash([string]$Dir) {
  if ($script:ReplaceEnvStash -and (Test-Path -LiteralPath $script:ReplaceEnvStash)) { return }
  $candidate = Get-EnvStashPath $Dir
  if (Test-Path -LiteralPath $candidate) {
    $script:ReplaceEnvStash = $candidate
    return
  }
  Save-ExistingEnv $Dir
}

function Merge-PreservedEnv([string]$Dest) {
  if (-not $script:ReplaceEnvStash -or -not (Test-Path -LiteralPath $script:ReplaceEnvStash) -or -not (Test-Path -LiteralPath $Dest)) { return }
  $structural = @{}
  foreach ($key in @(
    'AI_CHAT_ROOT', 'AI_CHAT_INSTALL_DIR', 'METIS_NODE_BIN', 'METIS_NODE_HOME',
    'CHAT_DATA_DIR', 'METIS_DATA_DIR', 'AGENT_CWD', 'METIS_WORKSPACE',
    'AI_CHAT_MCP_STATE_DIR', 'METIS_DOCKER', 'AI_CHAT_SERVICE_NAME', 'MCP_SDK_ROOT'
  )) { $structural[$key] = $true }
  $oldLines = [ordered]@{}
  foreach ($line in Get-Content -LiteralPath $script:ReplaceEnvStash) {
    $k = Get-EnvKey $line
    if ($k) { $oldLines[$k] = $line }
  }
  $used = @{}
  $out = New-Object System.Collections.Generic.List[string]
  foreach ($line in Get-Content -LiteralPath $Dest) {
    $k = Get-EnvKey $line
    if ($k -and -not $structural.ContainsKey($k) -and $oldLines.Contains($k)) {
      $out.Add([string]$oldLines[$k])
      $used[$k] = $true
    } else {
      $out.Add($line)
      if ($k) { $used[$k] = $true }
    }
  }
  foreach ($k in $oldLines.Keys) {
    if (-not $used.ContainsKey($k) -and -not $structural.ContainsKey($k)) {
      $out.Add([string]$oldLines[$k])
    }
  }
  $utf8NoBom = New-Object System.Text.UTF8Encoding $false
  [IO.File]::WriteAllText($Dest, (($out -join [Environment]::NewLine).TrimEnd() + [Environment]::NewLine), $utf8NoBom)
  Remove-Item -LiteralPath $script:ReplaceEnvStash -Force
  $script:ReplaceEnvStash = $null
  Write-Host "Merged previous .env into $Dest (old values kept, new keys added)."
}

function Get-ExistingDataDir([string]$Dir) {
  $envFile = Join-Path $Dir ".env"
  if (Test-Path -LiteralPath $envFile) {
    $line = Get-Content -LiteralPath $envFile | Where-Object { $_ -match '^CHAT_DATA_DIR=' } | Select-Object -First 1
    if ($line) {
      $value = $line.Substring('CHAT_DATA_DIR='.Length).Trim().Trim('"')
      if ($value) { return $value }
    }
  }
  $manifestPath = Join-Path $Dir ".metis-ai-install.json"
  if (Test-Path -LiteralPath $manifestPath) {
    try {
      $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
      if ($manifest.dataDir) { return [string]$manifest.dataDir }
    } catch {}
  }
  $nested = Join-Path $Dir "data"
  if (Test-Path -LiteralPath $nested) { return $nested }
  return ""
}

function Test-PathInside([string]$Inner, [string]$Outer) {
  $innerFull = [IO.Path]::GetFullPath($Inner).TrimEnd('\')
  $outerFull = [IO.Path]::GetFullPath($Outer).TrimEnd('\')
  return ($innerFull -eq $outerFull) -or $innerFull.StartsWith($outerFull + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)
}

function Test-InstallProcess($Process, [string[]]$Roots) {
  if ($Process.Name -notin @("node.exe", "esbuild.exe")) { return $false }
  foreach ($root in $Roots) {
    if (-not $root) { continue }
    $prefix = $root.TrimEnd('\') + '\'
    if ($Process.Name -eq "node.exe" -and $Process.CommandLine -and
        $Process.CommandLine.IndexOf($prefix, [StringComparison]::OrdinalIgnoreCase) -ge 0) { return $true }
    if ($Process.Name -eq "esbuild.exe" -and $Process.ExecutablePath -and
        $Process.ExecutablePath.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { return $true }
  }
  return $false
}

function Stop-ScriptHost([string]$Dir) {
  $scriptHost = Join-Path $Dir "windows-script-host.mjs"
  if (-not (Test-Path -LiteralPath $scriptHost)) { return }
  $node = (Get-Command node -ErrorAction Stop).Source
  & $node $scriptHost --stop
  if ($LASTEXITCODE -ne 0) { throw "Metis script host did not stop. Check host.log." }
}

function Uninstall-DetectedInstall([string]$Dir) {
  if (-not $Dir -or $Dir -eq [IO.Path]::GetPathRoot($Dir) -or $Dir -eq $HOME) {
    throw "Refusing to uninstall an unsafe install directory: $Dir"
  }
  Write-Host "Uninstalling existing Metis AI at $Dir (data kept)."
  $data = Get-ExistingDataDir $Dir
  Stop-ScriptHost $Dir
  $hostExe = Join-Path $Dir "MetisHost.exe"
  $hostProcesses = @(Get-CimInstance Win32_Process -Filter "Name='MetisHost.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.ExecutablePath -and [IO.Path]::GetFullPath($_.ExecutablePath) -eq [IO.Path]::GetFullPath($hostExe) })
  if ($hostProcesses.Count) {
    Start-Process -FilePath $hostExe -ArgumentList "--stop" -Wait
    Start-Sleep -Seconds 1
    $runningHost = @(Get-CimInstance Win32_Process -Filter "Name='MetisHost.exe'" -ErrorAction SilentlyContinue |
      Where-Object { $_.ExecutablePath -and [IO.Path]::GetFullPath($_.ExecutablePath) -eq [IO.Path]::GetFullPath($hostExe) })
    foreach ($proc in $runningHost) { Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue }
  }
  $runKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
  foreach ($suffix in @("app", "worker", "mcp")) {
    $task = "$serviceName-$suffix"
    Remove-ItemProperty -LiteralPath $runKey -Name $task -ErrorAction SilentlyContinue
    cmd.exe /c "schtasks /Delete /TN `"$task`" /F >nul 2>&1" | Out-Null
  }
  $rootNorm = [IO.Path]::GetFullPath($Dir).TrimEnd('\')
  $rootAliases = @($Dir, $rootNorm)
  $oldManifestPath = Join-Path $Dir ".metis-ai-install.json"
  if (Test-Path -LiteralPath $oldManifestPath) {
    $oldManifest = Get-Content -LiteralPath $oldManifestPath -Raw | ConvertFrom-Json
    if ($oldManifest.installDir -and [IO.Path]::GetFullPath([string]$oldManifest.installDir).TrimEnd('\') -eq $rootNorm) {
      $rootAliases += [string]$oldManifest.installDir
    }
  }
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { Test-InstallProcess $_ $rootAliases } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Save-ExistingEnv $Dir
  if ($data -and (Test-Path -LiteralPath $data) -and (Test-PathInside $data $Dir)) {
    $parent = Split-Path -Parent $rootNorm
    $script:ReplaceDataStash = Join-Path $parent (".$(Split-Path -Leaf $rootNorm).metis-keep-data")
    if (Test-Path -LiteralPath $script:ReplaceDataStash) { Remove-Item -LiteralPath $script:ReplaceDataStash -Recurse -Force }
    Move-Item -LiteralPath $data -Destination $script:ReplaceDataStash
    Write-Host "Kept nested data at $($script:ReplaceDataStash)"
  }
  Start-Sleep -Seconds 1
  if (Test-Path -LiteralPath $rootNorm) {
    cmd.exe /c "rmdir /s /q `"\\?\$rootNorm`"" | Out-Null
  }
}

function Restore-StashedData([string]$Dest) {
  if (-not $script:ReplaceDataStash -or -not (Test-Path -LiteralPath $script:ReplaceDataStash)) { return }
  $destParent = Split-Path -Parent $Dest
  if ($destParent) { New-Item -ItemType Directory -Force -Path $destParent | Out-Null }
  if (Test-Path -LiteralPath $Dest) { Remove-Item -LiteralPath $Dest -Recurse -Force }
  Move-Item -LiteralPath $script:ReplaceDataStash -Destination $Dest
  $script:ReplaceDataStash = $null
  Write-Host "Restored kept data to $Dest"
}

if ($existingServiceDir) {
  $existingFull = [IO.Path]::GetFullPath($existingServiceDir)
  $installFull = [IO.Path]::GetFullPath($InstallDir)
  $same = $existingFull -eq $installFull
  $choice = ""
  if ($ReplaceExisting) {
    $choice = "r"
  } elseif ($NonInteractive) {
    if ($same) { $choice = "u" }
  } else {
    Write-Host "Existing Metis AI detected."
    Write-Host "  service:   $serviceName-app"
    Write-Host "  directory: $existingServiceDir"
    Write-Host "[u] Upgrade that install"
    Write-Host "[r] Replace it (uninstall, keep data, then continue)"
    Write-Host "[n] Uninstall and exit (keeps data)"
    Write-Host "[a] Abort"
    $choice = Read-Host "Choice [u/r/n/a]"
  }
  switch -Regex ($choice) {
    '^[rR]$' {
      $InstallDir = $existingServiceDir
      if (-not $DataDir) { $dataDir = Join-Path $InstallDir "data" }
      Uninstall-DetectedInstall $InstallDir
      $existingServiceDir = ""
    }
    '^[uU]$' {
      $InstallDir = $existingServiceDir
      Write-Host "Existing Metis AI install detected: $serviceName-app is registered in $InstallDir. Upgrading in place."
    }
    '^[aA]$' {
      Write-Host "Aborted."
      exit 0
    }
    '^[nN]$' {
      $self = $MyInvocation.MyCommand.Path
      $forward = @("uninstall", "-InstallDir", $existingServiceDir, "-Yes", "-KeepData")
      if ($DryRun) { $forward += "-DryRun" }
      & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $self @forward
      exit $LASTEXITCODE
    }
    default {
      throw "Metis AI is already installed as $serviceName-app in $existingServiceDir. Re-run and choose upgrade/replace/uninstall, or pass -ReplaceExisting."
    }
  }
}

# Check effective preserved ports before dependency installation or building.
$preflightEnv = Join-Path $InstallDir ".env"
if (Test-Path -LiteralPath $preflightEnv) {
  foreach ($line in Get-Content -LiteralPath $preflightEnv) {
    if ($line -match '^PORT=(.+)$') { $port = $Matches[1].Trim().Trim('"') }
    if ($line -match '^MCP_PORT=(.+)$') { $mcpPort = $Matches[1].Trim().Trim('"') }
  }
}
if ($Native -and ((Test-OwnedDockerPort ([int]$port)) -or (Test-OwnedDockerPort ([int]$mcpPort)))) {
  throw "This installation is running in Docker. Keep its current mode for upgrade, or stop its Compose stack before migrating with -Native."
}
if ($Docker -and $existingServiceDir) {
  $oldManifest = Join-Path $InstallDir ".metis-ai-install.json"
  if ((Test-Path -LiteralPath $oldManifest) -and (Get-Content -LiteralPath $oldManifest -Raw | ConvertFrom-Json).installMethod -eq "native") {
    throw "This is a native installation. Upgrade without -Docker; migrate its runtime separately."
  }
}
Assert-AvailablePorts $port $mcpPort
$publicUrl = if ($PublicUrl) { $PublicUrl } else { "http://$publicHost`:$port" }

$useDocker = [bool]$Docker
$previousManifest = Join-Path $InstallDir ".metis-ai-install.json"
if (-not $Native -and -not $Docker -and (Test-Path -LiteralPath $previousManifest)) {
  $useDocker = (Get-Content -LiteralPath $previousManifest -Raw | ConvertFrom-Json).installMethod -eq "docker"
}
if ($useDocker) {
  Require-Command docker
  & docker info | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Docker is not running. Start Docker Desktop or omit -Docker for native installation." }
  & docker compose version | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Docker Compose is required with -Docker." }
}

if (-not $SkipRuntimeInstall) {
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    throw "winget is required to install Git and Node.js automatically."
  }
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    if (-not (Confirm-Install "Git")) { throw "git is required." }
    winget install --id Git.Git --accept-source-agreements --accept-package-agreements
  }
  if (-not $useDocker -and (Get-NodeMajor) -lt 22) {
    if (-not (Confirm-Install "Node.js 22 or newer")) { throw "Node.js 22 or newer is required." }
    winget install --id OpenJS.NodeJS.LTS --source winget --accept-source-agreements --accept-package-agreements
  }
  Refresh-Path
}
Require-Command git
if (-not $useDocker -and (Get-NodeMajor) -lt 22) { throw "Node.js 22 or newer is required." }


if (Test-Path (Join-Path $InstallDir ".git")) {
  git -C $InstallDir fetch --force origin
  if ($LASTEXITCODE -ne 0) { throw "Could not fetch Metis AI commits." }
  git -C $InstallDir fetch --tags --force
  if ($LASTEXITCODE -ne 0) { throw "Could not fetch Metis AI release tags." }
} elseif ((Test-Path $InstallDir) -and (Get-ChildItem -Force $InstallDir | Select-Object -First 1)) {
  throw "Installation directory exists and is not a Metis AI checkout: $InstallDir"
} else {
  New-Item -ItemType Directory -Force -Path (Split-Path $InstallDir) | Out-Null
  git clone $RepoUrl $InstallDir
  if ($LASTEXITCODE -ne 0) { throw "Could not clone Metis AI." }
}
if ($Commit) {
  $updateRef = $Commit
  git -C $InstallDir checkout --force --detach $updateRef
} else {
  $updateRef = $Version
  git -C $InstallDir checkout --force $updateRef
}
if ($LASTEXITCODE -ne 0) { throw "Could not check out Metis AI $updateRef." }
# Replace tracked local edits and divergent commits, preserving ignored install state.
git -C $InstallDir reset --hard $updateRef
if ($LASTEXITCODE -ne 0) { throw "Could not reset Metis AI to $updateRef." }
Restore-StashedData $dataDir

function Get-PnpmCommand {
  $existing = (Get-Command pnpm.cmd -ErrorAction SilentlyContinue).Source
  if ($existing) { return [string]$existing }
  $runtimePrefix = Join-Path $InstallDir ".runtime"
  $candidates = @(
    (Join-Path $runtimePrefix "pnpm.cmd"),
    (Join-Path $runtimePrefix "node_modules\.bin\pnpm.cmd")
  )
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) { return [string]$candidate }
  }
  $npmCommand = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
  if (-not $npmCommand) { throw "npm is required to install pnpm without Administrator access." }
  New-Item -ItemType Directory -Force -Path $runtimePrefix | Out-Null
  & $npmCommand install --global --prefix $runtimePrefix pnpm@9 | Out-Null
  $env:Path = "$runtimePrefix;$runtimePrefix\node_modules\.bin;" + $env:Path
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) { return [string]$candidate }
  }
  $refreshed = (Get-Command pnpm.cmd -ErrorAction SilentlyContinue).Source
  if ($refreshed) { return [string]$refreshed }
  throw "pnpm is required."
}
$pnpmCommand = $null
$nodeBin = $null
if (-not $useDocker) {
  $pnpmCommand = [string](Get-PnpmCommand)
  $nodeBin = (Get-Command node).Source
}

$randomHex = { -join (1..32 | ForEach-Object { "{0:x2}" -f (Get-Random -Maximum 256) }) }
$chatPassword = & $randomHex
$secretsKey = & $randomHex
$mcpToken = & $randomHex

New-Item -ItemType Directory -Force -Path $dataDir, $agentCwd | Out-Null
Adopt-EnvStash $InstallDir
$dockerEnv = ""
if ($useDocker) {
  $dockerEnv = @"
METIS_WORKSPACE=$agentCwd
METIS_DATA_DIR=$dataDir
AI_CHAT_BIND=$aiChatHost
METIS_DOCKER=1
AGENT_CWD=/workspace
CHAT_DATA_DIR=/data
METIS_AI_BOOTSTRAP_USERNAME=$username
METIS_AI_BOOTSTRAP_PASSWORD=$passwordPlain
METIS_AI_BOOTSTRAP_OPTIONAL=1
"@
} else {
  $hostOsUsername = (& $nodeBin -p "require('node:os').userInfo().username").Trim()
  if ($LASTEXITCODE -ne 0 -or -not $hostOsUsername) { throw "Could not resolve the Windows installation account." }
  $mcpSdkRoot = Join-Path $InstallDir "node_modules\@modelcontextprotocol\sdk"
  $dockerEnv = "METIS_NODE_BIN=$nodeBin" + [Environment]::NewLine +
    "METIS_HOST_OS_USERNAME=$hostOsUsername" + [Environment]::NewLine +
    "MCP_SDK_ROOT=$mcpSdkRoot"
}
$envLines = @"
APP_NAME=Metis AI
PORT=$port
AI_CHAT_HOST=$aiChatHost
CHAT_USERNAME=$username
CHAT_PASSWORD=$chatPassword
CHAT_DATA_DIR=$dataDir
AGENT_CWD=$agentCwd
AI_CHAT_ROOT=$InstallDir
AI_CHAT_INSTALL_DIR=$InstallDir
AI_CHAT_PUBLIC_URL=$publicUrl
AI_CHAT_INTERNAL_ORIGIN=http://127.0.0.1:$port
AI_CHAT_SERVICE_NAME=$serviceName
AI_CHAT_WORKER_CONCURRENCY=25
AI_CHAT_MCP_STATE_DIR=$(Join-Path $dataDir "mcp-state")
AI_CHAT_INTERNAL_URL=http://127.0.0.1:$port/api/internal/mcp-question
AI_CHAT_WORKSPACE_URL=http://127.0.0.1:$port/api/internal/mcp-workspace
AI_CHAT_CHAT_URL=http://127.0.0.1:$port/api/internal/mcp-chat
AI_CHAT_NOTES_URL=http://127.0.0.1:$port/api/internal/mcp-notes
AI_CHAT_MEMORY_URL=http://127.0.0.1:$port/api/internal/mcp-memory
AI_CHAT_BROWSER_URL=http://127.0.0.1:$port/api/internal/browser
AI_CHAT_AGENT_STATE_URL=http://127.0.0.1:$port/api/internal/mcp-agent-state
AI_CHAT_SUBAGENT_URL=http://127.0.0.1:$port/api/internal/mcp-subagent
AI_CHAT_AUTOMATION_URL=http://127.0.0.1:$port/api/internal/mcp-automation
AI_CHAT_FILE_URL=http://127.0.0.1:$port/api/internal/mcp-file
AI_CHAT_SECRETS_KEY=$secretsKey
MCP_PORT=$mcpPort
MCP_PUBLIC_URL=http://127.0.0.1:$mcpPort
MCP_BEARER_TOKEN=$mcpToken
MCP_ALLOW_REMOTE_ADMIN=false
MCP_ENABLE_REMOTE_SERVERS=false
MCP_ENABLE_OPTIONAL_SERVERS=false
$dockerEnv
"@
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText((Join-Path $InstallDir ".env"), $envLines.Trim() + [Environment]::NewLine, $utf8NoBom)
Merge-PreservedEnv (Join-Path $InstallDir ".env")
$mergedEnv = Join-Path $InstallDir ".env"
foreach ($line in Get-Content -LiteralPath $mergedEnv) {
  $k = Get-EnvKey $line
  if (-not $k) { continue }
  $v = $line.Substring($k.Length + 1).Trim().Trim('"')
  if ($k -eq 'PORT' -and $v -match '^[0-9]+$') { $port = $v }
  if ($k -eq 'MCP_PORT' -and $v -match '^[0-9]+$') { $mcpPort = $v }
  if ($k -eq 'AI_CHAT_PUBLIC_URL') { $publicUrl = $v }
}

Assert-AvailablePorts $port $mcpPort

if ($useDocker) {
  $reloadPs1 = @"
# Apply .env and published-port changes. `docker compose restart` keeps the old config.
Set-Location -LiteralPath $PSScriptRoot
Remove-Item Env:PORT,Env:MCP_PORT,Env:AI_CHAT_HOST,Env:AI_CHAT_BIND,Env:METIS_DATA_DIR,Env:METIS_WORKSPACE,Env:METIS_IMAGE -ErrorAction SilentlyContinue
docker compose --env-file .env up -d --remove-orphans --force-recreate
"@
  Set-Content -LiteralPath (Join-Path $InstallDir "reload.ps1") -Value $reloadPs1.Trim() -Encoding utf8
  Push-Location $InstallDir
  try {
    Remove-Item Env:PORT,Env:MCP_PORT,Env:AI_CHAT_HOST,Env:AI_CHAT_BIND,Env:METIS_DATA_DIR,Env:METIS_WORKSPACE,Env:METIS_IMAGE -ErrorAction SilentlyContinue
    docker compose --env-file .env up -d --build --remove-orphans
  } finally {
    Pop-Location
  }
} else {
Push-Location $InstallDir
try {
  $previousNodeEnv = $env:NODE_ENV
  Remove-Item Env:NODE_ENV -ErrorAction SilentlyContinue
  & $pnpmCommand install --frozen-lockfile
  if ($LASTEXITCODE -ne 0) { throw "Dependency installation failed." }
  $env:CHAT_DATA_DIR = $dataDir
  & node scripts/sync-provider-clis.mjs
  if ($LASTEXITCODE -ne 0) { throw "Provider CLI synchronization failed." }
  & $pnpmCommand exec playwright install chromium
  if ($LASTEXITCODE -ne 0) { throw "Browser installation failed." }
  $env:METIS_AI_BOOTSTRAP_USERNAME = $username
  $env:METIS_AI_BOOTSTRAP_PASSWORD = $passwordPlain
  $env:METIS_AI_BOOTSTRAP_OPTIONAL = "1"
  if ($passwordPlain) {
    & $pnpmCommand exec tsx scripts/bootstrap-user.ts
    if ($LASTEXITCODE -ne 0) { throw "User bootstrap failed." }
  }
  $previousDistDir = $env:NEXT_DIST_DIR
  $activeDistDir = ""
  foreach ($line in Get-Content -LiteralPath $mergedEnv) {
    if ($line -match '^NEXT_DIST_DIR=(.+)$') { $activeDistDir = $Matches[1].Trim().Trim('"') }
  }
  $nextDistDir = if ($activeDistDir -eq ".next-a") { ".next-b" } else { ".next-a" }
  $env:NEXT_DIST_DIR = $nextDistDir
  $previousNodeOptions = $env:NODE_OPTIONS
  try {
    $buildNodeOptions = & node scripts/build-node-options.cjs
    if ($LASTEXITCODE -ne 0) { throw "Could not determine the production build memory limit." }
    $env:NODE_OPTIONS = $buildNodeOptions
    & $pnpmCommand build
    if ($LASTEXITCODE -ne 0) { throw "Production build failed; existing services were not restarted." }
  } finally {
    if ($null -ne $previousDistDir) { $env:NEXT_DIST_DIR = $previousDistDir } else { Remove-Item Env:NEXT_DIST_DIR -ErrorAction SilentlyContinue }
    if ($null -ne $previousNodeOptions) { $env:NODE_OPTIONS = $previousNodeOptions } else { Remove-Item Env:NODE_OPTIONS -ErrorAction SilentlyContinue }
  }
  $runtimeEnv = @(Get-Content -LiteralPath $mergedEnv | Where-Object { $_ -notmatch '^NEXT_DIST_DIR=' })
  [IO.File]::WriteAllText($mergedEnv, ($runtimeEnv + "NEXT_DIST_DIR=$nextDistDir") -join [Environment]::NewLine, $utf8NoBom)
} finally {
  if ($null -ne $previousNodeEnv) { $env:NODE_ENV = $previousNodeEnv }
  Pop-Location
  Remove-Item Env:METIS_AI_BOOTSTRAP_USERNAME -ErrorAction SilentlyContinue
  Remove-Item Env:METIS_AI_BOOTSTRAP_PASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:METIS_AI_BOOTSTRAP_OPTIONAL -ErrorAction SilentlyContinue
}

$runner = Join-Path $InstallDir "run-service.ps1"
@"
`$ErrorActionPreference = "Stop"
Get-Content -LiteralPath (Join-Path `$PSScriptRoot ".env") | Where-Object { `$_ -and -not `$_.StartsWith("#") } | ForEach-Object {
  `$pair = `$_ -split "=", 2
  if (`$pair.Count -eq 2) { [Environment]::SetEnvironmentVariable(`$pair[0].Trim([char]0xFEFF), `$pair[1], "Process") }
}
Set-Location `$PSScriptRoot
if (`$args.Count -eq 1 -and `$args[0] -eq "--metis-load-env-only") { return }
`$node = `$env:METIS_NODE_BIN
if (-not `$node -or -not (Test-Path -LiteralPath `$node)) { `$node = (Get-Command node).Source }
& `$node @args
"@ | Set-Content -LiteralPath $runner -Encoding ascii

}
# GUI host and hidden child processes never allocate a console.
$hostExe = Join-Path $InstallDir "MetisHost.exe"
$hostNew = Join-Path $InstallDir "MetisHost.new.exe"
$csc = Join-Path $env:SystemRoot "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path -LiteralPath $csc)) {
  $csc = Join-Path $env:SystemRoot "Microsoft.NET\Framework\v4.0.30319\csc.exe"
}

$hostSource = Join-Path $InstallDir "MetisHost.cs"
@'
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
'@ | Set-Content -LiteralPath $hostSource -Encoding UTF8
$nativeHostReady = $false
if (Test-Path -LiteralPath $csc) {
  try {
    & $csc /nologo /target:winexe /reference:System.Windows.Forms.dll "/out:$hostNew" $hostSource
    $nativeHostReady = ($LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath $hostNew))
  } catch { Write-Host "Native host compilation unavailable: $($_.Exception.Message)" }
}
Stop-ScriptHost $InstallDir
$running = @(Get-CimInstance Win32_Process -Filter "Name='MetisHost.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.ExecutablePath -and [IO.Path]::GetFullPath($_.ExecutablePath) -eq [IO.Path]::GetFullPath($hostExe) })
if ($running.Count) {
  Start-Process -FilePath $hostExe -ArgumentList "--stop" -Wait
  foreach ($proc in $running) {
    $process = Get-Process -Id $proc.ProcessId -ErrorAction SilentlyContinue
    if ($process -and -not $process.WaitForExit(15000)) { throw "Existing Metis host did not stop. Check host.log." }
  }
}
# Migrate only legacy runners/processes belonging to this installation.
$rootNorm = [IO.Path]::GetFullPath($InstallDir).TrimEnd('\') + '\'
$legacy = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
  $_.CommandLine -and $_.CommandLine.IndexOf($rootNorm, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and
  $_.CommandLine -match 'run-service\.ps1|server\.mjs|worker\.ts|gateway-core\.mjs'
})
foreach ($proc in $legacy) {
  Get-CimInstance Win32_Process -Filter "ParentProcessId=$($proc.ProcessId)" -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -eq "node.exe" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
}
if ($nativeHostReady) { Move-Item -LiteralPath $hostNew -Destination $hostExe -Force }
@'
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

const installRoot = realpathSync.native(dirname(fileURLToPath(import.meta.url)));
const envPath = join(installRoot, ".env");
const args = process.argv.slice(2);
const allowed = new Set(["--open", "--stop"]);
if (args.some((arg) => !allowed.has(arg))) {
  console.error("Usage: windows-script-host.mjs [--open|--stop]");
  process.exitCode = 2;
  process.exit();
}
const wantsOpen = args.includes("--open");
const wantsStop = args.includes("--stop");
let stopping = false;

function parseEnv(text) {
  const result = {};
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.replace(/^\uFEFF/u, "").trim();
    if (!line || line.startsWith("#")) continue;
    const at = line.indexOf("=");
    if (at <= 0) continue;
    let value = line.slice(at + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    result[line.slice(0, at).trim()] = value;
  }
  return result;
}
const config = existsSync(envPath) ? parseEnv(readFileSync(envPath, "utf8")) : {};
for (const [key, value] of Object.entries(config)) process.env[key] = value;
process.env.NODE_ENV = "production";

const dataDir = resolve(config.CHAT_DATA_DIR || config.METIS_DATA_DIR || join(installRoot, "data"));
mkdirSync(dataDir, { recursive: true });
const paths = {
  lock: join(dataDir, ".windows-script-host.lock"),
  stop: join(dataDir, ".windows-script-host.stop"),
  hostLog: join(dataDir, "host.log"),
};
const token = randomBytes(24).toString("hex");

function log(line) {
  appendFileSync(paths.hostLog, new Date().toISOString() + " " + line + "\n");
}
function windowsHidden(options = {}) {
  return { windowsHide: true, stdio: options.stdio || "ignore", cwd: installRoot, ...options };
}
function runHidden(command, commandArgs, options = {}) {
  return spawnSync(command, commandArgs, { ...windowsHidden(options), encoding: "utf8", timeout: options.timeout });
}
function processExists(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  const result = runHidden("tasklist.exe", ["/FI", "PID eq " + pid, "/FO", "CSV", "/NH"], { stdio: ["ignore", "pipe", "ignore"] });
  return result.status === 0 && new RegExp('"[^"]+","\\s*' + pid + '","', "u").test(result.stdout || "");
}
function atomicWrite(file, value) {
  const temp = file + "." + process.pid + "." + Date.now() + ".tmp";
  writeFileSync(temp, value, { encoding: "utf8", mode: 0o600 });
  renameSync(temp, file);
}
function readLock() {
  try { return JSON.parse(readFileSync(paths.lock, "utf8")); } catch { return null; }
}
function staleLock() {
  const current = readLock();
  if (!current) {
    try { return Date.now() - statSync(paths.lock).mtimeMs > 15000; } catch { return false; }
  }
  return !processExists(Number(current.pid));
}
function acquireLock() {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const fd = openSync(paths.lock, "wx", 0o600);
      try { writeFileSync(fd, JSON.stringify({ pid: process.pid, root: installRoot, token, heartbeat: Date.now() }) + "\n"); } finally { closeSync(fd); }
      return true;
    } catch (error) {
      if (error.code !== "EEXIST" || !staleLock()) return false;
      try { renameSync(paths.lock, paths.lock + ".stale." + Date.now()); } catch {}
    }
  }
  return false;
}
function releaseLock() {
  const current = readLock();
  if (current?.pid === process.pid && current.token === token) rmSync(paths.lock, { force: true });
}
function requestStop() {
  const current = readLock();
  if (!current || current.root !== installRoot || !processExists(Number(current.pid))) return;
  atomicWrite(paths.stop, JSON.stringify({ root: installRoot, pid: current.pid, token: current.token, requestedAt: Date.now() }) + "\n");
  for (let i = 0; i < 75; i += 1) {
    if (!existsSync(paths.lock)) return;
    const latest = readLock();
    if (!latest || latest.root !== installRoot) return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
  }
  throw new Error("Metis background host did not stop within 15 seconds.");
}
function removeOwnStop() { try { rmSync(paths.stop, { force: true }); } catch {} }
function appendChildLog(name, chunk) {
  if (chunk) appendFileSync(join(dataDir, name + ".log"), chunk);
}
function childCommand(name) {
  const node = config.METIS_NODE_BIN || "node.exe";
  if (!["app", "worker", "mcp"].includes(name)) throw new Error("Unsupported service role");
  return { command: node, args: [join(installRoot, "scripts", "run-installed-service.cjs"), name] };
}
function startChild(name) {
  const command = childCommand(name);
  const child = spawn(command.command, command.args, {
    cwd: installRoot, env: { ...process.env, NODE_ENV: "production" }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => appendChildLog(name, chunk));
  child.stderr.on("data", (chunk) => appendChildLog(name, chunk));
  child.on("error", (error) => log(name + " spawn error: " + error.message));
  return child;
}
function stopChild(child, name) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  log("stopping " + name + " tree pid=" + child.pid);
  runHidden("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { timeout: 10000 });
}
function healthyUrl() { return config.AI_CHAT_PUBLIC_URL || "http://127.0.0.1:" + (config.PORT || "3100"); }
async function isHealthy() {
  try {
    const response = await fetch("http://127.0.0.1:" + (config.PORT || "3100") + "/api/status", { signal: AbortSignal.timeout(3000) });
    const status = await response.json();
    return response.ok && typeof status.authenticated === "boolean" && status.worker?.ok === true && status.mcp?.ok === true;
  } catch { return false; }
}
async function openBrowser() {
  const url = healthyUrl();
  for (let i = 0; i < 60; i += 1) {
    if (stopping) return;
    if (await isHealthy()) {
      runHidden("powershell.exe", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command",
        "Start-Process -FilePath '" + url.replaceAll("'", "''") + "'"], { timeout: 5000 });
      return;
    }
    await new Promise((resolveSleep) => setTimeout(resolveSleep, 1000));
  }
  throw new Error("Metis did not become ready at " + url + ". Check " + dataDir + " for startup errors.");
}
function showError(error) {
  log(error.stack || String(error));
  if (!wantsOpen) return;
  const message = String(error.message || error).replaceAll("'", "''");
  runHidden("powershell.exe", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command",
    "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('" + message + "','Metis AI','OK','Error') | Out-Null"], { timeout: 10000 });
}
function dockerEnabled() { return config.METIS_DOCKER === "1" || config.METIS_DOCKER === "true"; }
function dockerStart() {
  const result = runHidden("docker.exe", ["compose", "--env-file", envPath, "up", "-d", "--remove-orphans"],
    { stdio: ["ignore", "pipe", "pipe"], timeout: 120000 });
  appendChildLog("host", result.stdout || "");
  appendChildLog("host", result.stderr || "");
  if (result.status !== 0) throw new Error("Docker Compose failed. Check host.log.");
  log("docker compose started; stop leaves the compose stack running.");
}

async function main() {
  if (wantsStop) { requestStop(); return; }
  if (!acquireLock()) {
    if (wantsOpen) await openBrowser();
    return;
  }
  removeOwnStop();
  const children = [];
  const docker = dockerEnabled();
  try {
    if (config.PORT && config.MCP_PORT && config.PORT === config.MCP_PORT) throw new Error("PORT and MCP_PORT must be different.");
    if (!docker) {
      for (const portName of ["PORT", "MCP_PORT"]) {
        const port = Number(config[portName] || (portName === "PORT" ? 3100 : 8787));
        const probe = runHidden("powershell.exe", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command",
          "$l=New-Object Net.Sockets.TcpListener([Net.IPAddress]::Any," + port + "); try{$l.Start();$l.Stop();exit 0}catch{exit 1}"], { timeout: 5000 });
        if (probe.status !== 0) throw new Error("Port " + port + " (" + portName + ") is occupied or unavailable.");
      }
      for (const name of ["app", "worker", "mcp"]) children.push({ name, child: startChild(name) });
    } else dockerStart();
    let openPromise;
    if (wantsOpen) { openPromise = openBrowser().catch(showError); }
    while (true) {
      const stopRequest = readLock();
      let command = null;
      try { command = JSON.parse(readFileSync(paths.stop, "utf8")); } catch {}
      if (command && command.root === installRoot && command.token === token && stopRequest?.token === token) break;
      for (const entry of children) {
        if (entry.child.exitCode !== null) {
          log(entry.name + " exited code=" + entry.child.exitCode + "; restarting");
          entry.child = startChild(entry.name);
        }
      }
      atomicWrite(paths.lock, JSON.stringify({ pid: process.pid, root: installRoot, token, heartbeat: Date.now() }) + "\n");
      await new Promise((resolveSleep) => setTimeout(resolveSleep, 500));
    }

  } finally {
    stopping = true;
    for (const entry of children) stopChild(entry.child, entry.name);
    removeOwnStop();
    releaseLock();
  }
}
main().catch((error) => { showError(error); process.exitCode = 1; });
'@ | Set-Content -LiteralPath (Join-Path $InstallDir 'windows-script-host.mjs') -Encoding UTF8
@'
Option Explicit
Dim fso, shell, root, envPath, nodeBin, arg, args, i, command
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
root = fso.GetParentFolderName(WScript.ScriptFullName)
envPath = fso.BuildPath(root, ".env")
nodeBin = ""
If fso.FileExists(envPath) Then
  Dim stream, content, lines, line, p, key, value
  Set stream = CreateObject("ADODB.Stream")
  stream.Type = 2
  stream.Charset = "utf-8"
  stream.Open
  stream.LoadFromFile envPath
  content = stream.ReadText
  stream.Close
  lines = Split(Replace(content, vbCr, ""), vbLf)
  For Each line In lines
    line = Trim(line)
    If Left(line, 1) <> "#" Then
      p = InStr(line, "=")
      If p > 1 Then
        key = Trim(Left(line, p - 1))
        value = Trim(Mid(line, p + 1))
        If key = "METIS_NODE_BIN" Then
          If Len(value) >= 2 And Left(value, 1) = Chr(34) And Right(value, 1) = Chr(34) Then value = Mid(value, 2, Len(value) - 2)
          nodeBin = value
        End If
      End If
    End If
  Next
End If
If Len(nodeBin) = 0 Then
  nodeBin = shell.ExpandEnvironmentStrings("%ProgramFiles%\nodejs\node.exe")
  If Not fso.FileExists(nodeBin) Then nodeBin = shell.ExpandEnvironmentStrings("%LOCALAPPDATA%\Programs\nodejs\node.exe")
  If Not fso.FileExists(nodeBin) Then nodeBin = "node.exe"
End If
args = ""
For i = 0 To WScript.Arguments.Count - 1
  arg = WScript.Arguments(i)
  If arg <> "--open" And arg <> "--stop" Then
    WScript.Echo "Usage: install\windows-launcher.vbs [--open|--stop]"
    WScript.Quit 2
  End If
  args = args & " " & Quote(arg)
Next
command = Quote(nodeBin) & " " & Quote(fso.BuildPath(root, "windows-script-host.mjs")) & args
shell.CurrentDirectory = root
shell.Run command, 0, False

Function Quote(value)
  Quote = Chr(34) & Replace(value, Chr(34), Chr(34) & Chr(34)) & Chr(34)
End Function
'@ | Set-Content -LiteralPath (Join-Path $InstallDir 'windows-launcher.vbs') -Encoding Unicode
$hostTarget = $hostExe
$hostArguments = ""
$hostKind = "native"
try {
  if (-not $nativeHostReady) { throw "Native host is unavailable." }
  Start-Process -FilePath $hostExe -ErrorAction Stop
} catch {
  Write-Host "The native host is blocked or unavailable. Using the Windows script host without changing security policies."
  $hostTarget = Join-Path $env:SystemRoot "System32\wscript.exe"
  $hostArguments = '"' + (Join-Path $InstallDir "windows-launcher.vbs") + '"'
  $hostKind = "script"
  Start-Process -FilePath $hostTarget -ArgumentList $hostArguments -ErrorAction Stop
}
$runKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
New-Item -Path $runKey -Force | Out-Null
foreach ($suffix in @("app", "worker", "mcp")) {
  Remove-ItemProperty -LiteralPath $runKey -Name "$serviceName-$suffix" -ErrorAction SilentlyContinue
}
Set-ItemProperty -LiteralPath $runKey -Name "$serviceName-host" -Value ("`"" + $hostTarget + "`" " + $hostArguments)
$menuDir = Join-Path ([Environment]::GetFolderPath("Programs")) $serviceName
New-Item -ItemType Directory -Force -Path $menuDir | Out-Null
$shell = New-Object -ComObject WScript.Shell
$link = $shell.CreateShortcut((Join-Path $menuDir "Metis AI.lnk"))
$link.TargetPath = $hostTarget
$link.Arguments = ($hostArguments + " --open").Trim()
$link.WorkingDirectory = $InstallDir
$link.Description = "Start Metis AI in the background and open it in your browser"
$link.Save()
New-Item -Path $appKey -Force | Out-Null
Set-ItemProperty -Path $appKey -Name DisplayName -Value "Metis AI"
Set-ItemProperty -Path $appKey -Name Publisher -Value "Metis AI"
Set-ItemProperty -Path $appKey -Name InstallLocation -Value $InstallDir
Set-ItemProperty -Path $appKey -Name DisplayIcon -Value $hostExe
$uninstallCommand = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $InstallDir 'uninstall.ps1')`" -InstallDir `"$InstallDir`""
Set-ItemProperty -Path $appKey -Name UninstallString -Value $uninstallCommand
Remove-Item Env:METIS_AI_BOOTSTRAP_USERNAME,Env:METIS_AI_BOOTSTRAP_PASSWORD,Env:METIS_AI_BOOTSTRAP_OPTIONAL -ErrorAction SilentlyContinue
$manifest = @{
  installDir = $InstallDir
  dataDir = $dataDir
  agentCwd = $agentCwd
  serviceName = $serviceName
  host = $aiChatHost
  os = "windows"
  hostKind = $hostKind
  installMethod = $(if ($useDocker) { "docker" } else { "native" })
  createdAt = [DateTime]::UtcNow.ToString("o")
} | ConvertTo-Json -Compress
Set-Content -LiteralPath (Join-Path $InstallDir ".metis-ai-install.json") -Value $manifest -Encoding utf8
Copy-Item -LiteralPath (Join-Path $InstallDir "install/uninstall.ps1") -Destination (Join-Path $InstallDir "uninstall.ps1") -Force

for ($attempt = 0; $attempt -lt 45; $attempt++) {
  try {
    $status = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/status" -TimeoutSec 2
    if ($null -eq $status.authenticated -or -not $status.worker -or -not $status.mcp) { throw "The response is not a Metis status response." }
    if (-not $status.worker.ok -or -not $status.mcp.ok) { throw "Metis worker or MCP runtime is not ready." }
    break
  } catch {
    if ($attempt -eq 44) { throw "Metis did not become healthy on web port $port. Check $dataDir/app.log and $dataDir/host.log for startup errors or a port conflict." }
    Start-Sleep -Seconds 1
  }
}
for ($attempt = 0; $attempt -lt 30; $attempt++) {
  try {
    $html = (Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$port/" -TimeoutSec 5).Content
    $asset = [regex]::Match($html, '/_next/static/[^\s"<>]+\.js').Value
    if (-not $asset) { throw "No built browser JavaScript asset found." }
    $response = Invoke-WebRequest -UseBasicParsing -Uri ("http://127.0.0.1:$port" + $asset) -TimeoutSec 5
    if ($response.StatusCode -ne 200) { throw "Browser JavaScript asset is not available." }
    break
  } catch {
    if ($attempt -eq 29) { throw "Metis started, but its browser files are unavailable. Check $dataDir/app.log." }
    Start-Sleep -Seconds 1
  }
}
for ($attempt = 0; $attempt -lt 20; $attempt++) {
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$mcpPort/health" -TimeoutSec 2
    if (-not $health.ok -or $health.name -notlike '*Universal MCP Gateway' -or $health.endpoint -ne '/mcp') { throw "The response is not a Metis MCP gateway." }
    break
  } catch {
    if ($attempt -eq 19) { throw "Metis MCP gateway did not become healthy on port $mcpPort. Check $dataDir/mcp.log and $dataDir/host.log; another application may have taken this port." }
    Start-Sleep -Seconds 1
  }
}


if ($aiChatHost -eq "0.0.0.0") {
  Write-Host "Warning: the web application is reachable on the local network. Use strong credentials and a firewall or trusted TLS reverse proxy."
}
if (-not $useDocker) { [IO.File]::WriteAllText((Join-Path $InstallDir ".metis-package-updates-v1"), "1") }
Write-Host "`nMetis AI installed successfully."
Write-Host "Open: $publicUrl (or Metis AI in the Start menu)"
Write-Host "Host: background app, starts automatically at sign-in. Logs: $dataDir"
Write-Host "You can change this. Add: $(Join-Path $InstallDir '.env')"
if ($useDocker) {
  Write-Host "Apply: $(Join-Path $InstallDir 'reload.ps1')"
}
Write-Host "Uninstall: $(Join-Path $InstallDir 'uninstall.ps1') -InstallDir `"$InstallDir`" -KeepData"
