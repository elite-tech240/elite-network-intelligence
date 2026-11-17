#define AppName "Elite Network Intelligence Agent"
#define AppVersion "0.3.0"
[Setup]
AppId={{A1D3D4B1-93F1-4C86-9F15-8B91E84E1A20}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=Elite Network Intelligence
DefaultDirName={autopf}\Elite Network Intelligence\Agent
DefaultGroupName=Elite Network Intelligence
OutputDir=..\dist
OutputBaseFilename=EliteNetworkAgent-Setup
SetupIconFile=elite-network-icon.ico
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
Name: "{commonappdata}\EliteNetworkIntelligence\Agent"; Permissions: system-full admins-full

[Code]
var
  EnrollmentPage: TInputQueryWizardPage;

procedure InitializeWizard();
begin
  EnrollmentPage := CreateInputQueryPage(wpSelectDir,
    'Connect this computer to Elite Network Intelligence',
    'Enter the one-time enrollment details generated in your workspace.',
    'Use a unique token for each computer. This installer can be reused.');
  EnrollmentPage.Add('Monitoring API URL:', False);
  EnrollmentPage.Add('One-time enrollment token:', True);
  EnrollmentPage.Add('Site ID:', False);
  EnrollmentPage.Values[0] := 'https://pkaihrushsdxebfoyiis.supabase.co/functions/v1/monitoring-api';
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if CurPageID = EnrollmentPage.ID then
    if (Trim(EnrollmentPage.Values[0]) = '') or (Trim(EnrollmentPage.Values[1]) = '') or (Trim(EnrollmentPage.Values[2]) = '') then
    begin
      MsgBox('API URL, enrollment token, and site ID are required.', mbError, MB_OK);
      Result := False;
    end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ConfigPath, ConfigText: String;
  ResultCode: Integer;
begin
  if CurStep = ssPostInstall then
  begin
    ConfigPath := ExpandConstant('{commonappdata}\EliteNetworkIntelligence\Agent\agent-config.json');
    ConfigText := '{' + #13#10 +
      '  "ELITE_API_URL": "' + Trim(EnrollmentPage.Values[0]) + '",' + #13#10 +
      '  "ELITE_ENROLLMENT_TOKEN": "' + Trim(EnrollmentPage.Values[1]) + '",' + #13#10 +
      '  "ELITE_SITE_ID": "' + Trim(EnrollmentPage.Values[2]) + '",' + #13#10 +
      '  "ELITE_INTERVAL_SECONDS": "30",' + #13#10 +
      '  "ELITE_AGENT_STATE": "C:\\ProgramData\\EliteNetworkIntelligence\\Agent\\device-state.json"' + #13#10 +
      '}';
    if not SaveStringToFile(ConfigPath, ConfigText, False) then RaiseException('Could not write agent configuration.');
    Exec(ExpandConstant('{app}\EliteNetworkAgentService.exe'), 'install', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
    if ResultCode <> 0 then RaiseException('Could not register the monitoring service.');
    Exec(ExpandConstant('{app}\EliteNetworkAgentService.exe'), 'start', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
    if ResultCode <> 0 then RaiseException('The agent service could not be started.');
  end;
end;

[UninstallRun]
Filename: "{app}\EliteNetworkAgentService.exe"; Parameters: "stop"; Flags: runhidden waituntilterminated; RunOnceId: "StopEliteAgent"
Filename: "{app}\EliteNetworkAgentService.exe"; Parameters: "uninstall"; Flags: runhidden waituntilterminated; RunOnceId: "RemoveEliteAgent"
