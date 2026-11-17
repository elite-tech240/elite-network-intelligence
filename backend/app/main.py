from __future__ import annotations

import hashlib
import hmac
import os
import secrets
from datetime import datetime, timezone
from typing import Literal

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, IPvAnyAddress
from supabase import Client, create_client

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
TOKEN_SECRET = os.getenv("ENROLLMENT_TOKEN_SECRET", "")
CORS_ORIGINS = [x.strip() for x in os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",") if x.strip()]

app = FastAPI(title="Elite Network Intelligence API", version="0.4.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


def db() -> Client:
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        raise HTTPException(status_code=503, detail="Server database is not configured")
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)


def digest_token(token: str) -> str:
    if not TOKEN_SECRET or len(TOKEN_SECRET) < 32:
        raise HTTPException(status_code=503, detail="ENROLLMENT_TOKEN_SECRET must be configured (32+ characters)")
    return hmac.new(TOKEN_SECRET.encode(), token.encode(), hashlib.sha256).hexdigest()


def bearer_value(authorization: str | None) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Bearer token required")
    return authorization.split(" ", 1)[1].strip()


def current_user(authorization: str | None = Header(default=None)):
    token = bearer_value(authorization)
    try:
        user_response = db().auth.get_user(token)
        user = user_response.user
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired user session")
    if not user:
        raise HTTPException(status_code=401, detail="Invalid user session")
    return user


class EnrollmentTokenRequest(BaseModel):
    organization_id: str
    site_id: str
    label: str = Field(default="Agent enrollment", min_length=1, max_length=100)
    expires_in_hours: int = Field(default=24, ge=1, le=720)


class EnrollmentPayload(BaseModel):
    enrollment_token: str = Field(min_length=24, max_length=512)
    hostname: str = Field(min_length=1, max_length=255)
    site_id: str
    device_type: str = Field(default="unknown", max_length=80)
    os_name: str | None = Field(default=None, max_length=120)
    os_version: str | None = Field(default=None, max_length=120)
    ip_address: IPvAnyAddress | None = None
    mac_addresses: list[str] = Field(default_factory=list, max_length=16)


class HeartbeatPayload(BaseModel):
    status: Literal["online", "degraded"] = "online"
    cpu_percent: float | None = Field(default=None, ge=0, le=100)
    memory_percent: float | None = Field(default=None, ge=0, le=100)
    disk_percent: float | None = Field(default=None, ge=0, le=100)
    bytes_sent: int | None = Field(default=None, ge=0)
    bytes_recv: int | None = Field(default=None, ge=0)


class AlertRulePayload(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    metric: Literal["cpu_percent", "memory_percent", "disk_percent"]
    operator: Literal["gt", "gte"] = "gt"
    threshold: float = Field(ge=1, le=100)
    enabled: bool = True


@app.get("/health")
def health():
    return {"status": "ok", "service": "elite-network-intelligence-api", "version": "0.4.0"}


@app.post("/api/v1/enrollment-tokens")
def create_enrollment_token(payload: EnrollmentTokenRequest, user=Depends(current_user)):
    client = db()
    membership = client.table("organization_members").select("role").eq(
        "organization_id", payload.organization_id
    ).eq("user_id", str(user.id)).limit(1).execute()
    if not membership.data or membership.data[0]["role"] not in ("owner", "admin", "operator"):
        raise HTTPException(status_code=403, detail="You do not have permission to enroll devices")
    site = client.table("sites").select("id").eq("id", payload.site_id).eq(
        "organization_id", payload.organization_id
    ).limit(1).execute()
    if not site.data:
        raise HTTPException(status_code=404, detail="Site not found in this workspace")
    raw_token = secrets.token_urlsafe(36)
    from datetime import timedelta
    expires_at = (datetime.now(timezone.utc) + timedelta(hours=payload.expires_in_hours)).isoformat()
    client.table("enrollment_tokens").insert({
        "organization_id": payload.organization_id,
        "site_id": payload.site_id,
        "token_hash": digest_token(raw_token),
        "label": payload.label,
        "expires_at": expires_at,
    }).execute()
    return {"token": raw_token, "expires_at": expires_at, "site_id": payload.site_id,
            "warning": "Copy this token now. It will not be shown again."}


@app.post("/api/v1/agents/enroll")
def enroll(payload: EnrollmentPayload):
    client = db()
    enrollment = client.table("enrollment_tokens").select(
        "id,organization_id,site_id,expires_at,revoked_at"
    ).eq("token_hash", digest_token(payload.enrollment_token)).limit(1).execute()
    if not enrollment.data:
        raise HTTPException(status_code=401, detail="Invalid enrollment token")
    token = enrollment.data[0]
    now = datetime.now(timezone.utc)
    if token.get("revoked_at") or (
        token.get("expires_at")
        and datetime.fromisoformat(token["expires_at"].replace("Z", "+00:00")) <= now
    ):
        raise HTTPException(status_code=401, detail="Enrollment token expired or revoked")
    if str(token["site_id"]) != payload.site_id:
        raise HTTPException(status_code=403, detail="Token is not authorized for this site")
    site = client.table("sites").select("id").eq("id", payload.site_id).eq(
        "organization_id", token["organization_id"]
    ).limit(1).execute()
    if not site.data:
        raise HTTPException(status_code=403, detail="Site does not belong to token organization")

    device_id = secrets.token_urlsafe(18)
    device_token = secrets.token_urlsafe(48)
    device_data = {
        "organization_id": token["organization_id"], "site_id": payload.site_id,
        "hostname": payload.hostname, "device_type": payload.device_type,
        "os_name": payload.os_name, "os_version": payload.os_version,
        "ip_address": str(payload.ip_address) if payload.ip_address else None,
        "mac_addresses": payload.mac_addresses, "status": "online",
        "last_seen_at": now.isoformat(),
    }
    inserted = client.table("devices").insert(device_data).execute()
    if not inserted.data:
        raise HTTPException(status_code=500, detail="Device registration failed")
    device = inserted.data[0]
    client.table("device_credentials").insert({
        "device_id": device["id"], "token_hash": digest_token(device_token)
    }).execute()
    return {
        "device": {"id": device["id"], "hostname": device["hostname"]},
        "device_token": device_token,
        "warning": "Store this device token securely. It is only returned once.",
    }


@app.post("/api/v1/agents/{device_id}/heartbeat")
def heartbeat(device_id: str, payload: HeartbeatPayload, authorization: str | None = Header(default=None)):
    device_token = bearer_value(authorization)
    client = db()
    credential = client.table("device_credentials").select(
        "device_id,revoked_at"
    ).eq("token_hash", digest_token(device_token)).eq("device_id", device_id).limit(1).execute()
    if not credential.data or credential.data[0].get("revoked_at"):
        raise HTTPException(status_code=401, detail="Invalid or revoked device credential")

    device_result = client.table("devices").select("id,organization_id,hostname").eq(
        "id", device_id
    ).limit(1).execute()
    if not device_result.data:
        raise HTTPException(status_code=404, detail="Device not found")
    device = device_result.data[0]
    now = datetime.now(timezone.utc).isoformat()

    client.table("device_credentials").update({"last_used_at": now}).eq("device_id", device_id).execute()
    client.table("devices").update({"status": payload.status, "last_seen_at": now}).eq("id", device_id).execute()
    metric = {
        "organization_id": device["organization_id"], "device_id": device_id,
        "cpu_percent": payload.cpu_percent, "memory_percent": payload.memory_percent,
        "disk_percent": payload.disk_percent, "bytes_sent": payload.bytes_sent,
        "bytes_recv": payload.bytes_recv, "recorded_at": now,
    }
    client.table("device_metrics").insert(metric).execute()

    rules = client.table("alert_rules").select("*").eq(
        "organization_id", device["organization_id"]
    ).eq("enabled", True).execute()
    values = {
        "cpu_percent": payload.cpu_percent,
        "memory_percent": payload.memory_percent,
        "disk_percent": payload.disk_percent,
    }
    for rule in rules.data or []:
        value = values.get(rule["metric"])
        threshold = rule.get("threshold")
        if value is None or threshold is None:
            continue
        breached = value >= threshold if rule.get("operator") == "gte" else value > threshold
        if not breached:
            continue
        existing = client.table("alert_events").select("id").eq(
            "device_id", device_id
        ).eq("rule_id", rule["id"]).eq("status", "open").limit(1).execute()
        if not existing.data:
            severity = "critical" if value >= min(100, threshold + 15) else "warning"
            client.table("alert_events").insert({
                "organization_id": device["organization_id"], "device_id": device_id,
                "rule_id": rule["id"], "severity": severity,
                "title": f"{rule['name']}: {device['hostname']}",
                "message": f"{rule['metric']} reached {value:.1f}% (threshold {threshold:.1f}%).",
            }).execute()

    return {"ok": True, "device_id": device_id, "recorded_at": now}


@app.post("/api/v1/alert-rules")
def create_alert_rule(payload: AlertRulePayload, authorization: str | None = Header(default=None)):
    user = current_user(authorization)
    client = db()
    memberships = client.table("organization_members").select("organization_id,role").eq(
        "user_id", str(user.id)
    ).execute()
    if not memberships.data:
        raise HTTPException(status_code=403, detail="No workspace membership")
    # The owner UI currently operates in one workspace; require an explicit unambiguous membership.
    if len(memberships.data) != 1:
        raise HTTPException(status_code=400, detail="Select a workspace before creating alert rules")
    membership = memberships.data[0]
    if membership["role"] not in ("owner", "admin", "operator"):
        raise HTTPException(status_code=403, detail="Insufficient role")
    created = client.table("alert_rules").insert({
        "organization_id": membership["organization_id"], **payload.model_dump()
    }).execute()
    return {"rule": created.data[0] if created.data else None}
