-- Ensure trusted server-side collectors can write Phase 1 telemetry.
grant all on public.device_interfaces, public.interface_metrics, public.network_checks,
  public.ipam_addresses, public.vlans, public.discovery_jobs to service_role;
grant usage, select on sequence public.interface_metrics_id_seq,
  public.network_checks_id_seq to service_role;
