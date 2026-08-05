; Extra NSIS steps for the Windows installer.
; Adds a "Docsie Capture Companion" shortcut that launches the app directly
; into the kiosk capture mode (--companion), alongside the normal shortcut.

!macro customInstall
  CreateShortCut "$DESKTOP\Docsie Capture Companion.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "--companion" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0
  CreateShortCut "$SMPROGRAMS\Docsie Capture Companion.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "--companion" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0
!macroend

!macro customUnInstall
  Delete "$DESKTOP\Docsie Capture Companion.lnk"
  Delete "$SMPROGRAMS\Docsie Capture Companion.lnk"
!macroend
