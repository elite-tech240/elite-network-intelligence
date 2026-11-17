#define AppName "Elite Network Intelligence Agent"
#define AppVersion "0.1.0"
[Setup]
AppId={{A1D3D4B1-93F1-4C86-9F15-8B91E84E1A20}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=Elite Network Intelligence
DefaultDirName={autopf}\Elite Network Intelligence\Agent
DefaultGroupName=Elite Network Intelligence
OutputDir=..\dist
OutputBaseFilename=EliteNetworkAgent-Setup
ArchitecturesInstallIn64BitMode=x64
PrivilegesRequired=admin
UninstallDisplayIcon={app}\EliteNetworkAgent.exe
Compression=lzma2
SolidCompression=yes
WizardStyle=modern

[Files]
Source: "..\build\EliteNetworkAgent.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\build\EliteNetworkAgentService.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\EliteNetworkAgentService.xml"; DestDir: "{app}"; Flags: ignoreversion

[Dirs]
Name: "{commonappdata}\EliteNetworkIntelligence\Agent"; Permissions: users-modify

[Code]
function InitializeSetup(): Boolean;
var
  ConfigPath: String;
begin
  ConfigPath := ExpandConstant('{src}\agent-config.json');
  if not FileExists(ConfigPath) then
  begin
    MsgBox('agent-config.json was not found. Keep it in the same folder as this installer and run Setup again.', mbError, MB_OK);
    Result := False;
    exit;
  end;
  Result := True;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  SourceConfig, TargetConfig: String;
  ResultCode: Integer;
begin
  if CurStep = ssPostInstall then
  begin
    SourceConfig := ExpandConstant('{src}\agent-config.json');
    TargetConfig := ExpandConstant('{commonappdata}\EliteNetworkIntelligence\Agent\agent-config.json');
    if not FileCopy(SourceConfig, TargetConfig, False) then
      RaiseException('Could not install agent configuration.');
    Exec(ExpandConstant('{app}\EliteNetworkAgentService.exe'), 'install', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
    if ResultCode <> 0 then RaiseException('Could not register the monitoring service.');
    Exec(ExpandConstant('{app}\EliteNetworkAgentService.exe'), 'start', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
    if ResultCode <> 0 then RaiseException('The agent service could not be started. Check the Windows service manager.');
  end;
end;

[UninstallRun]
Filename: "{app}\EliteNetworkAgentService.exe"; Parameters: "stop"; Flags: runhidden waituntilterminated; RunOnceId: "StopEliteAgent"
Filename: "{app}\EliteNetworkAgentService.exe"; Parameters: "uninstall"; Flags: runhidden waituntilterminated; RunOnceId: "RemoveEliteAgent"
