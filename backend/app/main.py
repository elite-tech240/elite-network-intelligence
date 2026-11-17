from __future__ import annotations

import hashlib
import hmac
import os
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

app = FastAPI(title="Elite Network Intelligence API", version="0.2.0")
app.add_middleware(CORSMiddleware, allow_origins=CORS_ORIGINS, allow_credentials=True, allow_methods=["GET", "POST"], allow_headers=["Authorization", "Content-Type"])


def db() -> Client:
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        raise HTTPException(status_code=503, detail="Server database is not configured")
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)


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


def token_digest(token: str) -> str:
    if not TOKEN_SECRET:
        raise HTTPException(status_code=503, detail="Enrollment token validation is not configured")
    return hmac.new(TOKEN_SECRET.encode(), token.encode(), hashlib.sha256).hexdigest()


@app.get("/health")
def health():
    return {"status": "ok", "service": "elite-network-intelligence-api", "version": "0.2.0"}


@app.post("/api/v1/agents/enroll")
def enroll(payload: EnrollmentPayload):
    client = db()
    digest = token_digest(payload.enrollment_token)
    result = client.table("enrollment_tokens").select("id,organization_id,site_id,expires_at,revoked_at").eq("token_hash", digest).limit(1).execute()
    if not result.data:
        raise HTTPException(status_code=401, detail="Invalid enrollment token")
    token = result.data[0]
    now = datetime.now(timezone.utc)
    if token.get("revoked_at") or (token.get("expires_at") and datetime.fromisoformat(token["expires_at"].replace("Z", "+00:00")) <= now):
        raise HTTPException(status_code=401, detail="Enrollment token expired or revoked")
    if str(token["site_id"]) != payload.site_id:
        raise HTTPException(status_code=403, detail="Token is not authorized for this site")
    site = client.table("sites").select("id,organization_id").eq("id", payload.site_id).eq("organization_id", token["organization_id"]).limit(1).execute()
    if not site.data:
        raise HTTPException(status_code=403, detail="Site does not belong to token organization")
    device_data = {"organization_id": token["organization_id"], "site_id": payload.site_id, "hostname": payload.hostname, "device_type": payload.device_type, "os_name": payload.os_name, "os_version": payload.os_version, "ip_address": str(payload.ip_address) if payload.ip_address else None, "mac_addresses": payload.mac_addresses, "status": "online", "last_seen_at": now.isoformat()}
    inserted = client.table("devices").insert(device_data).execute()
    return {"device": inserted.data[0] if inserted.data else None}


@app.post("/api/v1/agents/{device_id}/heartbeat")
def heartbeat(device_id: str, payload: HeartbeatPayload, authorization: str | None = Header(default=None)):
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Bearer device token required")
    # MVP note: per-device token verification is intentionally not implemented yet.
    # Do not expose this endpoint publicly until device credential storage/verification is added.
    raise HTTPException(status_code=501, detail="Device credential verification is not enabled in this MVP")
