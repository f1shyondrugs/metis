!macro customUnInstall
  ${ifNot} ${isUpdated}
    nsExec::ExecToLog 'schtasks.exe /Delete /TN "Metis AI Remote Client" /F'
    RMDir /r "$APPDATA\MetisAI\RemoteClient"
  ${endIf}
!macroend
