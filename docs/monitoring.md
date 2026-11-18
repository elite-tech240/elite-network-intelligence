# Monitoring, logs and usage (v0.4)

## What runs where
- **Edge function `monitoring-api`** (Supabase) is the production API. `/jobs/tick` runs every minute from pg_cron (job `monitoring-tick`) and does offline detection, uptime checks, notifications and the Monday weekly report. A second job `monitoring-rollup` rolls raw metrics into hourly rows and prunes old data.
- **Retention:** raw metrics 7 days, hourly rollups 400 days, device logs 30 days.
- **Cron auth:** a Vault secret `monitoring_cron_secret` is checked through the RPC `check_cron_secret`; no env secret needed.

## Server secrets (Supabase > Edge Functions > Secrets)
| Secret | Used for |
|---|---|
| `RESEND_API_KEY`, `MAIL_FROM` | Email alerts and weekly report |
| `TELEGRAM_BOT_TOKEN` | Telegram alerts (chat id is set per channel) |
| `APP_URL` | Links inside notifications (defaults to the Vercel URL) |

Without them, deliveries are recorded as `skipped`; nothing breaks.

## Agent 0.4.0
Adds uptime, network rates, top processes (names only), OS warning/error logs (Windows Event Log via `wevtutil`, Linux `journalctl`) and passive ARP discovery. Still read-only: no remote shell, no active scanning, no auto-update. Windows devices need the new installer built and installed to get these.

## Not included by design
ICMP ping and SSL-expiry checks (not possible from edge functions), Vercel usage, dark/light toggle and RTL.
