; Deinstallation unter Windows: Zertifikat und Start beim Anmelden wieder entfernen (nicht bei einem Update).
!macro customUnInstall
  ${ifNot} ${isUpdated}
    nsExec::Exec 'certutil -user -delstore Root "Chetti Helfer"'
    nsExec::Exec 'reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v ChettiHelper /f'
  ${endIf}
!macroend
