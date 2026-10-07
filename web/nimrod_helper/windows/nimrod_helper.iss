; The Nimrod helper's setup.exe (Inno Setup 6, free: jrsoftware.org). build_windows.py compiles it:
;   ISCC /DPayload=<build\payload> /O<build> nimrod_helper.iss
;
; KEPT THIN ON PURPOSE. Inno copies the files and owns the Apps-list entry and its Uninstall; everything
; else (start with Windows, the Start menu shortcuts, starting it, stopping it, the data folder) is done by
; the helper's own `register` / `unregister` (install_windows.py), which the tests cover. One place for
; that logic, whether the helper arrives through this setup.exe or `python -m nimrod_helper install`.
;
; Per user, no administrator: PrivilegesRequired=lowest, installed under %LOCALAPPDATA%\Programs.
; NOT SIGNED YET: signing is a decision for Mike (cost, and an EV certificate needs a registered business);
; until then Windows SmartScreen says "Windows protected your PC" on first run.

#ifndef Payload
  #define Payload "..\build\payload"
#endif

[Setup]
AppId={{6B0E8F2C-4E61-4C3B-9A4D-2F7C1D9E5A10}
AppName=Nimrod helper
AppVersion=0.1.0
AppPublisher=Nimrod
DefaultDirName={localappdata}\Programs\Nimrod Helper
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputBaseFilename=NimrodHelperSetup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayName=Nimrod helper
CloseApplications=no

[Files]
Source: "{#Payload}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Run]
; Start with Windows, the Start menu shortcuts, and start it now.
Filename: "{app}\python\pythonw.exe"; Parameters: """{app}\app\start_helper.pyw"" register --quiet"; WorkingDir: "{app}\app"; Flags: runhidden waituntilterminated; StatusMsg: "Starting the Nimrod helper..."

[UninstallRun]
; Stop it, and remove start-with-Windows, the shortcuts, the settings, the logs and the downloaded model.
Filename: "{app}\python\pythonw.exe"; Parameters: """{app}\app\start_helper.pyw"" unregister --quiet"; WorkingDir: "{app}\app"; Flags: runhidden waituntilterminated; RunOnceId: "NimrodHelperUnregister"

[UninstallDelete]
; What the program made inside its own folder after it was installed (Python's compiled-code caches).
Type: filesandordirs; Name: "{app}"
