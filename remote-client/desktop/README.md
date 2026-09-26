# Metis AI Remote Client for Windows

The Windows Remote Client is an Electron app packaged as a per-machine NSIS installer that requests administrator rights. Windows lists it under **Installed apps** and provides an uninstaller. The app shows only this PC's command history and stays available from the system tray when its window is closed. The app itself requests administrator rights on every launch.

## Pair a device

1. In Metis AI, open **Settings → Devices → Add client → Windows**.
2. Download and install the Windows app.
3. Open the app and enter the server URL and pairing code shown in Metis AI.

The code expires after 15 minutes. The app stores its credential with Windows credential encryption under `%APPDATA%\\MetisAI\\RemoteClient`. Uninstalling the app removes that local data. The remote connection runs inside the app and reconnects automatically. **Start at Windows login** is controlled in the app or tray menu and uses an elevated Windows scheduled task for the installing administrator account. On a standard Windows account, Windows may require the administrator to sign in before the interactive app can start.

## Build

On Windows with Node.js 22 or later:

```powershell
cd remote-client/desktop
npm ci
npm run build:win
```

The output is `dist/Metis-AI-Remote-Client-Setup.exe`. The GitHub Actions workflow builds the same installer on a Windows runner. Publishing a release attaches the installer and update metadata. Configure code signing in the release environment before distributing the app broadly; unsigned Windows builds may show a SmartScreen warning.

A Metis server can serve a locally built installer by placing it at `<CHAT_DATA_DIR>/remote-client-artifacts/Metis-AI-Remote-Client-Setup.exe`. If that file is absent, the download endpoint redirects to the latest GitHub release.

## Runtime

- This PC's identity and command history come from the authenticated Metis hub API. The API only returns records for the requesting client.
- A command with no confirmed response after timeout or disconnect appears as **Unclear**. Verify on the device before retrying.
- Command output in the server audit is redacted and shortened. `REMOTE_AUDIT_RETENTION_DAYS` sets its retention period (default 30, maximum 365).
- Updates are checked at startup and every six hours in packaged builds.
- The older PowerShell client remains available for existing installations until they are replaced through the Windows app.
