# Windows installer

The Windows x64 installer is built by GitHub Actions from `.github/workflows/build-windows-agent-installer.yml`.

## Dashboard-generated configuration

The installer expects an `agent-config.json` file beside the setup executable. Generate a fresh, single-use enrollment token in the authenticated dashboard and create this file locally in the downloaded package:

```json
{
  "ELITE_API_URL": "https://YOUR-PROJECT.supabase.co/functions/v1/monitoring-api",
  "ELITE_ENROLLMENT_TOKEN": "ONE_TIME_TOKEN",
  "ELITE_SITE_ID": "SITE_UUID",
  "ELITE_INTERVAL_SECONDS": "30",
  "ELITE_AGENT_STATE": "C:\\\\ProgramData\\\\EliteNetworkIntelligence\\\\Agent\\\\device-state.json"
}
```

Keep the token private. It is single-use and expires according to the server's enrollment-token policy. Do not reuse a config file for another device. The service stores its own device credential in ProgramData after successful enrollment.

Keep `agent-config.json` in the same directory as `EliteNetworkAgent-Setup.exe`, then run the installer as Administrator. The installer registers and starts the Windows service **Elite Network Intelligence Agent**. It is configured to restart after failures.

Uninstalling the software removes the Windows service. Review and remove the device credential/state file from ProgramData separately if the endpoint is being retired.

## Build validation

A successful GitHub Actions run publishes both a workflow artifact and the release asset. The installer is not considered ready until the Windows workflow completes successfully and the installer has been tested on a Windows endpoint.
