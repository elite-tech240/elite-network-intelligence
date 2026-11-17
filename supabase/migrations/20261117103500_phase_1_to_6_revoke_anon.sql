-- No Phase 1-6 table is exposed to the anonymous API role.
revoke all on
  public.device_interfaces, public.interface_metrics, public.network_checks,
  public.ipam_addresses, public.vlans, public.discovery_jobs,
  public.firewall_assets, public.firewall_policy_snapshots, public.firewall_security_events,
  public.integration_credentials, public.vpn_tunnels, public.vpn_session_metrics,
  public.voip_endpoints, public.voip_call_quality, public.voip_trunks,
  public.maintenance_windows, public.operation_requests, public.operation_approvals,
  public.audit_logs, public.msp_customer_access, public.ai_insights
from anon;