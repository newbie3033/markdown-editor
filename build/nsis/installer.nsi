Var newStartMenuLink
Var oldStartMenuLink
Var newDesktopLink
Var oldDesktopLink
Var oldShortcutName
Var oldMenuDirectory

!include "${BUILD_RESOURCES_DIR}/nsis/common.nsh"
!include "MUI2.nsh"
!include "${BUILD_RESOURCES_DIR}/nsis/multiUser.nsh"
!include "${BUILD_RESOURCES_DIR}/nsis/include/allowOnlyOneInstallerInstance.nsh"

!ifdef BUILD_UNINSTALLER
  !ifmacrodef customUnInstallSection
    !define MUI_COMPONENTSPAGE_NODESC
    !insertmacro MUI_UNPAGE_COMPONENTS
  !endif
!endif

!ifdef INSTALL_MODE_PER_ALL_USERS
  !ifdef BUILD_UNINSTALLER
    RequestExecutionLevel user
  !else
    RequestExecutionLevel admin
  !endif
!else
  RequestExecutionLevel user
!endif

!ifdef BUILD_UNINSTALLER
  SilentInstall silent
!else
  Var appExe
  Var launchLink
!endif

!ifdef ONE_CLICK
  !include "${BUILD_RESOURCES_DIR}/nsis/oneClick.nsh"
!else
  !include "${BUILD_RESOURCES_DIR}/nsis/assistedInstaller.nsh"
!endif

!insertmacro addLangs

!ifmacrodef customHeader
  !insertmacro customHeader
!endif

Function .onInit
  Call setInstallSectionSpaceRequired

  SetOutPath $INSTDIR
  ${LogSet} on

  !ifmacrodef preInit
    !insertmacro preInit
  !endif

  !ifdef DISPLAY_LANG_SELECTOR
    !insertmacro MUI_LANGDLL_DISPLAY
  !endif

  !ifdef BUILD_UNINSTALLER
    WriteUninstaller "${UNINSTALLER_OUT_FILE}"
    !insertmacro quitSuccess
  !else
    !insertmacro check64BitAndSetRegView

    !ifdef ONE_CLICK
      !insertmacro ALLOW_ONLY_ONE_INSTALLER_INSTANCE
    !else
      ${IfNot} ${UAC_IsInnerInstance}
        !insertmacro ALLOW_ONLY_ONE_INSTALLER_INSTANCE
      ${EndIf}
    !endif

    !insertmacro initMultiUser

    !ifmacrodef customInit
      !insertmacro customInit
    !endif

    !ifmacrodef addLicenseFiles
      InitPluginsDir
      !insertmacro addLicenseFiles
    !endif
  !endif
FunctionEnd

!ifndef BUILD_UNINSTALLER
  !include "${BUILD_RESOURCES_DIR}/nsis/include/installUtil.nsh"
!endif

Section "install" INSTALL_SECTION_ID
  !ifndef BUILD_UNINSTALLER
    # If we're running a silent upgrade of a per-machine installation, elevate so extracting the new app will succeed.
    # For a non-silent install, the elevation will be triggered when the install mode is selected in the UI,
    # but that won't be executed when silent.
    !ifndef INSTALL_MODE_PER_ALL_USERS
      !ifndef ONE_CLICK
          ${if} $hasPerMachineInstallation == "1" # set in onInit by initMultiUser
          ${andIf} ${Silent}
            ${ifNot} ${UAC_IsAdmin}
              ShowWindow $HWNDPARENT ${SW_HIDE}
              !insertmacro UAC_RunElevated
              ${Switch} $0
                ${Case} 0
                  ${Break}
                ${Case} 1223 ;user aborted
                  ${Break}
                ${Default}
                  MessageBox mb_IconStop|mb_TopMost|mb_SetForeground "Unable to elevate, error $0"
                  ${Break}
              ${EndSwitch}
              Quit
            ${else}
              !insertmacro setInstallModePerAllUsers
            ${endIf}
          ${endIf}
      !endif
    !endif
    !include "${BUILD_RESOURCES_DIR}/nsis/installSection.nsh"
  !endif
SectionEnd

Function setInstallSectionSpaceRequired
  !insertmacro setSpaceRequired ${INSTALL_SECTION_ID}
FunctionEnd

# Always include the uninstall section: the default flow only needs it for the
# pre-extracted uninstaller stub (BUILD_UNINSTALLER), but the custom-script
# flow writes the uninstaller at install time via WriteUninstaller.
# BUILD_UNINSTALLER is defined around the include so that macros expanded from
# the uninstaller side (e.g. GetProcessInfo's Call un.*) take the same code
# paths they take in electron-builder's separate uninstaller pass.
!define BUILD_UNINSTALLER
!include "${BUILD_RESOURCES_DIR}/nsis/uninstaller.nsh"
!undef BUILD_UNINSTALLER