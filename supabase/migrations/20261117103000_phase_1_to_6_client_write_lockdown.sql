-- Explicitly remove inherited client write privileges from every new Phase 1-6 table.
-- Browser access is read-only where a tenant-scoped SELECT policy exists.
revoke insert, update, delete, truncate, references, trigger on
  public.device_interfaces, public.interface_metrics, public.network_checks,
  public.ipam_addresses, public.vlans, public.discovery_jobs,
  public.firewall_assets, public.firewall_policy_snapshots, public.firewall_security_events,
  public.integration_credentials, public.vpn_tunnels, public.vpn_session_metrics,
  public.voip_endpoints, public.voip_call_quality, public.voip_trunks,
  public.maintenance_windows, public.operation_requests, public.operation_approvals,
  public.audit_logs, public.msp_customer_access, public.ai_insights
from anon, authenticated;

-- Reassert read access only for tenant-scoped inventory and monitoring records.
grant select on
  public.device_interfaces, public.interface_metrics, public.network_checks,
  public.ipam_addresses, public.vlans, public.discovery_jobs,
  public.firewall_assets, public.firewall_policy_snapshots, public.firewall_security_events,
  public.vpn_tunnels, public.vpn_session_metrics,
  public.voip_endpoints, public.voip_call_quality, public.voip_trunks,
  public.maintenance_windows, public.operation_requests, public.operation_approvals,
  public.audit_logs, public.ai_insights
to authenticated;

-- MSP relationships and integration credentials remain backend-only.
revoke all on public.integration_credentials, public.msp_customer_access from anon, authenticated;
