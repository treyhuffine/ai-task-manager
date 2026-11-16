!include "WinVer.nsh"

!macro customInit
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_OK|MB_ICONSTOP "Ri needs 64-bit Windows 10 version 1809 or newer. Check your Windows version in Settings, System, About."
    Abort
  ${EndIf}
  ReadRegStr $R0 HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion" "CurrentBuildNumber"
  ${If} $R0 < 17763
    MessageBox MB_OK|MB_ICONSTOP "Ri needs Windows 10 version 1809 or newer. Update Windows before installing Ri."
    Abort
  ${EndIf}
!macroend
