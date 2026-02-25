!macro NSIS_HOOK_PREINSTALL
  nsExec::Exec 'taskkill /F /IM ragepad-server.exe'
  nsExec::Exec 'taskkill /F /IM Ragepad.exe'
!macroend
