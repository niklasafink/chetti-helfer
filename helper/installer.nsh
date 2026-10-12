; Deinstallation unter Windows: Zertifikat, Start beim Anmelden und das Schema chetti-helfer: wieder entfernen (nicht bei einem Update).
!macro customUnInstall
  ${ifNot} ${isUpdated}
    nsExec::Exec 'certutil -user -delstore Root "Chetti Helfer"'
    nsExec::Exec 'reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v ChettiHelper /f'
    nsExec::Exec 'reg delete "HKCU\Software\Classes\chetti-helfer" /f'
  ${endIf}
!macroend
