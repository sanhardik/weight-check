from fastapi import FastAPI, APIRouter, HTTPException, Depends, UploadFile, File, Form, Query
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.responses import Response, StreamingResponse
from fastapi.concurrency import run_in_threadpool
import csv
import io
import tempfile
import re
import base64
import json
import httpx
from html import escape
from html.parser import HTMLParser
from urllib.parse import urlparse
import ipaddress
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import uuid
import jwt as pyjwt
import bcrypt
import requests
from pathlib import Path
from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional, Literal
from datetime import datetime, timezone, timedelta

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

STEEL_DENSITY_KG_PER_MM3 = 7.85e-6  # 7850 kg/m^3
WEIGHT_TOLERANCE_PCT = 0.2
APP_NAME = "steeltrack"

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
JWT_SECRET = os.environ["JWT_SECRET"]
JWT_ALGO = os.environ.get("JWT_ALGO", "HS256")
JWT_EXPIRE_HOURS = int(os.environ.get("JWT_EXPIRE_HOURS", "168"))
EMERGENT_KEY = os.environ.get("EMERGENT_LLM_KEY")
EMAIL_BASE_URL = "https://integrations.emergentagent.com"
EMAIL_KEY = os.environ.get("EMERGENT_EMAIL_KEY")
EMAIL_FROM_NAME = os.environ.get("EMAIL_FROM_NAME", "SteelTrack")
LOW_STOCK_DEFAULT_PCS = float(os.environ.get("LOW_STOCK_DEFAULT_PCS", "2"))

STORAGE_BASE = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip() or "https://integrations.emergentagent.com"
STORAGE_URL = STORAGE_BASE.rstrip("/") + "/objstore/api/v1/storage"
storage_key = None

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

app = FastAPI()
api_router = APIRouter(prefix="/api")
security = HTTPBearer(auto_error=False)

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)


# ---------- Models ----------
Role = Literal["admin", "office", "labour"]


class UserPublic(BaseModel):
    id: str
    email: str
    name: str
    role: Role
    language: str = "en"


class UserCreate(BaseModel):
    email: str
    password: str
    name: str
    role: Role


class LoginBody(BaseModel):
    email: str
    password: str


class AuthResponse(BaseModel):
    token: str
    user: UserPublic


class EntryBase(BaseModel):
    thickness_mm: float = Field(gt=0)
    width_mm: float = Field(gt=0)
    length_mm: float = Field(gt=0)
    pieces: float = Field(gt=0)
    grade: Optional[str] = None
    vehicle_number: str
    driver_name: Optional[str] = None
    driver_phone: Optional[str] = None
    actual_weight_kg: Optional[float] = None
    slip_photo_path: Optional[str] = None
    remarks: Optional[str] = None


class InwardCreate(EntryBase):
    pass


class OutwardCreate(EntryBase):
    broker_name: str
    source_entry_id: Optional[str] = None  # Reference to inward entry stock pulled from


class OfficeDetailsUpdate(BaseModel):
    invoice_no: Optional[str] = None
    party_name: Optional[str] = None
    rate: Optional[float] = None
    payment_terms: Optional[str] = None
    office_remarks: Optional[str] = None


class CorrectionUpdate(BaseModel):
    """Admin / office correction after original entry — tracks a variance trail."""
    actual_weight_kg: Optional[float] = None
    pieces: Optional[float] = Field(default=None, gt=0)
    vehicle_number: Optional[str] = None
    driver_name: Optional[str] = None
    driver_phone: Optional[str] = None


class EntryOut(BaseModel):
    id: str
    entry_number: str
    direction: Literal["inward", "outward"]
    thickness_mm: float
    width_mm: float
    length_mm: float
    pieces: float
    grade: Optional[str] = None
    vehicle_number: str
    driver_name: Optional[str] = None
    driver_phone: Optional[str] = None
    broker_name: Optional[str] = None
    theoretical_weight_kg: float
    actual_weight_kg: Optional[float] = None
    variance_pct: Optional[float] = None
    variance_flagged: Optional[bool] = None
    slip_photo_path: Optional[str] = None
    remarks: Optional[str] = None
    source_entry_id: Optional[str] = None
    invoice_no: Optional[str] = None
    party_name: Optional[str] = None
    rate: Optional[float] = None
    payment_terms: Optional[str] = None
    office_remarks: Optional[str] = None
    created_by: str
    created_by_name: Optional[str] = None
    created_at: datetime
    office_updated_by: Optional[str] = None
    office_updated_at: Optional[datetime] = None
    history: List[dict] = Field(default_factory=list)


class InventoryGroup(BaseModel):
    thickness_mm: float
    width_mm: float
    length_mm: float
    grade: Optional[str] = None
    pieces_in: float
    pieces_out: float
    pieces_available: float
    theoretical_weight_available_kg: float
    inward_entry_ids: List[str] = []


# ---------- Helpers ----------
def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def create_token(user_id: str, role: str) -> str:
    payload = {
        "sub": user_id,
        "role": role,
        "exp": now_utc() + timedelta(hours=JWT_EXPIRE_HOURS),
        "iat": now_utc(),
    }
    return pyjwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGO)


def decode_token(token: str) -> dict:
    try:
        return pyjwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {e}")


async def current_user(cred: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    if not cred:
        raise HTTPException(status_code=401, detail="Missing authorization")
    payload = decode_token(cred.credentials)
    user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


def require_role(*roles: str):
    async def dep(user: dict = Depends(current_user)):
        if user["role"] not in roles:
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return user
    return dep


def calc_theoretical_weight(thickness_mm, width_mm, length_mm, pieces) -> float:
    return round(thickness_mm * width_mm * length_mm * pieces * STEEL_DENSITY_KG_PER_MM3, 3)


def calc_variance(theoretical: float, actual: Optional[float]):
    if actual is None or theoretical <= 0:
        return None, None
    pct = round(abs(actual - theoretical) / theoretical * 100, 3)
    return pct, pct > WEIGHT_TOLERANCE_PCT


async def next_entry_number(direction: str) -> str:
    prefix = "INW" if direction == "inward" else "OUT"
    date_part = now_utc().strftime("%Y%m%d")
    key = f"{prefix}-{date_part}"
    counter = await db.counters.find_one_and_update(
        {"_id": key},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True,
    )
    seq = counter["seq"] if counter else 1
    return f"{prefix}-{date_part}-{seq:04d}"


# ---------- Storage ----------
def _sync_init_storage():
    global storage_key
    if storage_key:
        return storage_key
    resp = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": EMERGENT_KEY}, timeout=30)
    resp.raise_for_status()
    storage_key = resp.json()["storage_key"]
    return storage_key


def _sync_put_object(path: str, data: bytes, content_type: str) -> dict:
    key = _sync_init_storage()
    resp = requests.put(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key, "Content-Type": content_type},
        data=data,
        timeout=120,
    )
    if resp.status_code == 503:
        global storage_key
        storage_key = None
        key = _sync_init_storage()
        resp = requests.put(
            f"{STORAGE_URL}/objects/{path}",
            headers={"X-Storage-Key": key, "Content-Type": content_type},
            data=data,
            timeout=120,
        )
    resp.raise_for_status()
    return resp.json()


def _sync_get_object(path: str):
    key = _sync_init_storage()
    resp = requests.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key}, timeout=60)
    resp.raise_for_status()
    return resp.content, resp.headers.get("Content-Type", "application/octet-stream")


# ---------- Startup ----------
@app.on_event("startup")
async def startup():
    try:
        await run_in_threadpool(_sync_init_storage)
        logger.info("Storage initialized")
    except Exception as e:
        logger.warning(f"Storage init failed (will retry on first upload): {e}")
    await db.users.create_index("email", unique=True)
    await db.entries.create_index("entry_number", unique=True)
    await db.entries.create_index("created_at")
    # Seed default users
    seeds = [
        {"email": "admin@steeltrack.com", "password": "admin123", "name": "Admin User", "role": "admin"},
        {"email": "office@steeltrack.com", "password": "office123", "name": "Office User", "role": "office"},
        {"email": "labour@steeltrack.com", "password": "labour123", "name": "Labour User", "role": "labour"},
    ]
    for s in seeds:
        exists = await db.users.find_one({"email": s["email"]})
        if not exists:
            await db.users.insert_one({
                "id": str(uuid.uuid4()),
                "email": s["email"],
                "password_hash": hash_password(s["password"]),
                "name": s["name"],
                "role": s["role"],
                "language": "en",
                "created_at": now_utc(),
            })
            logger.info(f"Seeded user: {s['email']}")


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()


# ---------- Auth Routes ----------
@api_router.post("/auth/login", response_model=AuthResponse)
async def login(body: LoginBody):
    user = await db.users.find_one({"email": body.email.lower().strip()})
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = create_token(user["id"], user["role"])
    return AuthResponse(
        token=token,
        user=UserPublic(
            id=user["id"],
            email=user["email"],
            name=user["name"],
            role=user["role"],
            language=user.get("language", "en"),
        ),
    )


@api_router.get("/auth/me", response_model=UserPublic)
async def me(user: dict = Depends(current_user)):
    return UserPublic(
        id=user["id"],
        email=user["email"],
        name=user["name"],
        role=user["role"],
        language=user.get("language", "en"),
    )


@api_router.post("/auth/register", response_model=UserPublic)
async def register_user(body: UserCreate, admin: dict = Depends(require_role("admin"))):
    email = body.email.lower().strip()
    exists = await db.users.find_one({"email": email})
    if exists:
        raise HTTPException(status_code=400, detail="Email already exists")
    uid = str(uuid.uuid4())
    await db.users.insert_one({
        "id": uid,
        "email": email,
        "password_hash": hash_password(body.password),
        "name": body.name,
        "role": body.role,
        "language": "en",
        "created_at": now_utc(),
    })
    return UserPublic(id=uid, email=email, name=body.name, role=body.role, language="en")


@api_router.get("/users", response_model=List[UserPublic])
async def list_users(admin: dict = Depends(require_role("admin"))):
    users = await db.users.find({}, {"_id": 0, "password_hash": 0}).to_list(1000)
    return [UserPublic(**u) for u in users]


# ---------- Upload ----------
@api_router.post("/upload")
async def upload_file(file: UploadFile = File(...), user: dict = Depends(current_user)):
    data = await file.read()
    if len(data) == 0:
        raise HTTPException(status_code=400, detail="Empty file")
    ext = (file.filename or "jpg").split(".")[-1].lower()
    if ext not in {"jpg", "jpeg", "png", "webp", "heic"}:
        ext = "jpg"
    path = f"{APP_NAME}/uploads/{user['id']}/{uuid.uuid4().hex}.{ext}"
    content_type = file.content_type or "image/jpeg"
    try:
        result = await run_in_threadpool(_sync_put_object, path, data, content_type)
    except requests.HTTPError as e:
        logger.error(f"Upload failed: {e}")
        raise HTTPException(status_code=502, detail=f"Upload failed: {e.response.status_code if e.response else 'unknown'}")
    await db.uploads.insert_one({
        "path": result["path"],
        "size": result.get("size"),
        "content_type": content_type,
        "owner_id": user["id"],
        "created_at": now_utc(),
    })
    return {"path": result["path"], "size": result.get("size")}


@api_router.get("/files/{path:path}")
async def get_file(path: str, token: Optional[str] = Query(None), cred: HTTPAuthorizationCredentials = Depends(security)):
    tok = cred.credentials if cred else token
    if not tok:
        raise HTTPException(status_code=401, detail="Missing token")
    payload = decode_token(tok)
    uid = payload["sub"]
    # Verify ownership or admin/office
    upload = await db.uploads.find_one({"path": path}, {"_id": 0})
    if not upload:
        raise HTTPException(status_code=404, detail="File not found")
    user = await db.users.find_one({"id": uid}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    if user["role"] == "labour" and upload["owner_id"] != uid:
        raise HTTPException(status_code=403, detail="Forbidden")
    try:
        content, ctype = await run_in_threadpool(_sync_get_object, path)
    except requests.HTTPError:
        raise HTTPException(status_code=404, detail="Object not found")
    return Response(content=content, media_type=ctype)


# ---------- Entries ----------
async def _enrich_entry(e: dict, viewer: Optional[dict] = None) -> dict:
    if "created_by" in e:
        u = await db.users.find_one({"id": e["created_by"]}, {"_id": 0, "name": 1})
        e["created_by_name"] = u["name"] if u else "Unknown"
    # Role-based rate visibility: labour never sees pricing
    if viewer and viewer.get("role") == "labour":
        e["rate"] = None
    return e


# Fields that office/admin can edit and that should be tracked in history
_OFFICE_HISTORY_FIELDS = ("invoice_no", "party_name", "rate", "payment_terms", "office_remarks")


async def _push_history(entry_id: str, changes: list) -> None:
    if not changes:
        return
    await db.entries.update_one({"id": entry_id}, {"$push": {"history": {"$each": changes}}})


async def _remember_vehicle(plate: str, driver_name: Optional[str], driver_phone: Optional[str]) -> None:
    plate = (plate or "").strip().upper()
    if not plate:
        return
    update: dict = {"last_used_at": now_utc(), "plate": plate}
    if driver_name:
        update["last_driver"] = driver_name.strip()
    if driver_phone:
        update["last_phone"] = driver_phone.strip()
    await db.vehicles.update_one({"_id": plate}, {"$set": update}, upsert=True)


async def _check_low_stock_and_alert(thickness_mm: float, width_mm: float, length_mm: float, grade: Optional[str]) -> None:
    """Called after outward entries. If this dimension dropped to <= threshold and
    we haven't alerted in the last 24h, send an email to all admins."""
    threshold = float(await _get_setting("low_stock_threshold_pcs", LOW_STOCK_DEFAULT_PCS))
    pipeline = [
        {"$match": {"thickness_mm": thickness_mm, "width_mm": width_mm, "length_mm": length_mm, "grade": grade}},
        {"$group": {
            "_id": None,
            "in": {"$sum": {"$cond": [{"$eq": ["$direction", "inward"]}, "$pieces", 0]}},
            "out": {"$sum": {"$cond": [{"$eq": ["$direction", "outward"]}, "$pieces", 0]}},
        }},
    ]
    avail = 0.0
    async for g in db.entries.aggregate(pipeline):
        avail = float(g["in"]) - float(g["out"])
    if not (0 < avail <= threshold):
        return

    group_key = f"{thickness_mm}|{width_mm}|{length_mm}|{grade or '-'}"
    cooldown_cutoff = now_utc() - timedelta(hours=24)
    recent = await db.low_stock_alerts.find_one({"_id": group_key, "last_sent_at": {"$gt": cooldown_cutoff}})
    if recent:
        return

    admins = await db.users.find({"role": "admin"}, {"_id": 0, "email": 1, "name": 1}).to_list(100)
    if not admins or not EMAIL_KEY:
        return

    dim = f"{thickness_mm}×{width_mm}×{length_mm}" + (f" ({grade})" if grade else "")
    subject = f"⚠ Low Stock Alert — {dim}"
    html = (
        f"<table role='presentation' width='100%' style='font-family:Arial,sans-serif;background:#ffffff'>"
        f"<tr><td style='padding:24px'>"
        f"<h2 style='margin:0 0 4px 0;color:#111111'>SteelTrack Low-Stock Alert</h2>"
        f"<p style='margin:16px 0;color:#111111'>Dimension <b>{escape(dim)}</b> has dropped to "
        f"<b style='color:#E50000;font-size:20px'>{avail}</b> pieces — at or below the alert threshold of {threshold}.</p>"
        f"<p style='margin:16px 0;color:#52525B;font-size:13px'>Open the SteelTrack dashboard to see consumption, "
        f"weeks-remaining and suggested reorder quantity.</p>"
        f"<p style='margin:16px 0 0 0;font-size:11px;color:#888'>Automatic alert from {escape(EMAIL_FROM_NAME)}. "
        f"We never ask for your password or card details by email.</p>"
        f"</td></tr></table>"
    )

    sent_count = 0
    for a in admins:
        em = a.get("email")
        if not em:
            continue
        try:
            await _send_email(to=em, subject=subject, html=html)
            sent_count += 1
        except Exception as e:
            logger.warning(f"Low-stock alert to {em} failed: {e}")

    await db.low_stock_alerts.update_one(
        {"_id": group_key},
        {"$set": {
            "last_sent_at": now_utc(),
            "thickness_mm": thickness_mm, "width_mm": width_mm,
            "length_mm": length_mm, "grade": grade,
            "pieces_available_at_alert": avail,
            "admins_notified": sent_count,
        }},
        upsert=True,
    )


@api_router.post("/entries/inward", response_model=EntryOut)
async def create_inward(body: InwardCreate, user: dict = Depends(require_role("admin", "labour", "office"))):
    tw = calc_theoretical_weight(body.thickness_mm, body.width_mm, body.length_mm, body.pieces)
    vpct, flagged = calc_variance(tw, body.actual_weight_kg)
    entry_number = await next_entry_number("inward")
    doc = {
        "id": str(uuid.uuid4()),
        "entry_number": entry_number,
        "direction": "inward",
        "thickness_mm": body.thickness_mm,
        "width_mm": body.width_mm,
        "length_mm": body.length_mm,
        "pieces": body.pieces,
        "grade": body.grade,
        "vehicle_number": body.vehicle_number,
        "driver_name": body.driver_name,
        "driver_phone": body.driver_phone,
        "theoretical_weight_kg": tw,
        "actual_weight_kg": body.actual_weight_kg,
        "variance_pct": vpct,
        "variance_flagged": flagged,
        "slip_photo_path": body.slip_photo_path,
        "remarks": body.remarks,
        "created_by": user["id"],
        "created_at": now_utc(),
    }
    await db.entries.insert_one(doc.copy())
    await _remember_vehicle(body.vehicle_number, body.driver_name, body.driver_phone)
    doc = await _enrich_entry(doc, user)
    return EntryOut(**doc)


@api_router.post("/entries/outward", response_model=EntryOut)
async def create_outward(body: OutwardCreate, user: dict = Depends(require_role("admin", "labour", "office"))):
    # Stock guardrail: compute available pieces for this T x W x L x grade
    match = {
        "thickness_mm": body.thickness_mm,
        "width_mm": body.width_mm,
        "length_mm": body.length_mm,
        "grade": body.grade,
    }
    pipeline = [
        {"$match": match},
        {"$group": {
            "_id": None,
            "in": {"$sum": {"$cond": [{"$eq": ["$direction", "inward"]}, "$pieces", 0]}},
            "out": {"$sum": {"$cond": [{"$eq": ["$direction", "outward"]}, "$pieces", 0]}},
        }},
    ]
    available = 0.0
    async for g in db.entries.aggregate(pipeline):
        available = float(g["in"]) - float(g["out"])
    if body.pieces > available + 1e-9:
        raise HTTPException(
            status_code=400,
            detail=f"INSUFFICIENT STOCK: only {available} pcs available for {body.thickness_mm}×{body.width_mm}×{body.length_mm}" + (f" ({body.grade})" if body.grade else ""),
        )

    tw = calc_theoretical_weight(body.thickness_mm, body.width_mm, body.length_mm, body.pieces)
    vpct, flagged = calc_variance(tw, body.actual_weight_kg)
    entry_number = await next_entry_number("outward")
    doc = {
        "id": str(uuid.uuid4()),
        "entry_number": entry_number,
        "direction": "outward",
        "thickness_mm": body.thickness_mm,
        "width_mm": body.width_mm,
        "length_mm": body.length_mm,
        "pieces": body.pieces,
        "grade": body.grade,
        "vehicle_number": body.vehicle_number,
        "driver_name": body.driver_name,
        "driver_phone": body.driver_phone,
        "broker_name": body.broker_name,
        "source_entry_id": body.source_entry_id,
        "theoretical_weight_kg": tw,
        "actual_weight_kg": body.actual_weight_kg,
        "variance_pct": vpct,
        "variance_flagged": flagged,
        "slip_photo_path": body.slip_photo_path,
        "remarks": body.remarks,
        "created_by": user["id"],
        "created_at": now_utc(),
    }
    await db.entries.insert_one(doc.copy())
    await _remember_vehicle(body.vehicle_number, body.driver_name, body.driver_phone)
    # Low-stock alert (non-blocking: swallow errors so entry save never fails)
    try:
        await _check_low_stock_and_alert(body.thickness_mm, body.width_mm, body.length_mm, body.grade)
    except Exception as e:
        logger.warning(f"Low-stock alert check failed: {e}")
    doc = await _enrich_entry(doc, user)
    return EntryOut(**doc)


@api_router.get("/entries", response_model=List[EntryOut])
async def list_entries(
    direction: Optional[str] = None,
    limit: int = 200,
    user: dict = Depends(current_user),
):
    q: dict = {}
    if direction in ("inward", "outward"):
        q["direction"] = direction
    cur = db.entries.find(q, {"_id": 0}).sort("created_at", -1).limit(limit)
    out = []
    async for e in cur:
        e = await _enrich_entry(e, user)
        out.append(EntryOut(**e))
    return out


@api_router.get("/entries/{entry_id}", response_model=EntryOut)
async def get_entry(entry_id: str, user: dict = Depends(current_user)):
    e = await db.entries.find_one({"id": entry_id}, {"_id": 0})
    if not e:
        raise HTTPException(status_code=404, detail="Entry not found")
    e = await _enrich_entry(e, user)
    return EntryOut(**e)


@api_router.patch("/entries/{entry_id}/office", response_model=EntryOut)
async def update_office_details(
    entry_id: str,
    body: OfficeDetailsUpdate,
    user: dict = Depends(require_role("admin", "office")),
):
    e = await db.entries.find_one({"id": entry_id}, {"_id": 0})
    if not e:
        raise HTTPException(status_code=404, detail="Entry not found")
    update = {k: v for k, v in body.dict().items() if v is not None}

    # Build history entries for every tracked field that actually changes
    changes = []
    for field in _OFFICE_HISTORY_FIELDS:
        if field in update:
            old_val = e.get(field)
            new_val = update[field]
            if old_val != new_val:
                changes.append({
                    "field": field,
                    "old": old_val,
                    "new": new_val,
                    "by": user["id"],
                    "by_name": user.get("name"),
                    "by_role": user.get("role"),
                    "at": now_utc(),
                })

    update["office_updated_by"] = user["id"]
    update["office_updated_at"] = now_utc()
    await db.entries.update_one({"id": entry_id}, {"$set": update})
    if changes:
        await _push_history(entry_id, changes)
    e = await db.entries.find_one({"id": entry_id}, {"_id": 0})
    e = await _enrich_entry(e, user)
    return EntryOut(**e)


_CORRECTION_FIELDS = ("actual_weight_kg", "pieces", "vehicle_number", "driver_name", "driver_phone")


@api_router.patch("/entries/{entry_id}/correction", response_model=EntryOut)
async def correct_entry(
    entry_id: str,
    body: CorrectionUpdate,
    user: dict = Depends(require_role("admin", "office")),
):
    """Correct the original entry (actual weight, pieces, vehicle, driver).
    Every changed field is pushed to the entry's history with user + role + timestamp."""
    e = await db.entries.find_one({"id": entry_id}, {"_id": 0})
    if not e:
        raise HTTPException(status_code=404, detail="Entry not found")
    patch = {k: v for k, v in body.dict().items() if v is not None}
    if not patch:
        raise HTTPException(status_code=400, detail="No changes supplied")

    # Stock guardrail: if pieces changes on an outward entry, make sure the new count
    # doesn't exceed inventory at this group (excluding this entry's own current pieces).
    if "pieces" in patch and e.get("direction") == "outward":
        pipeline = [
            {"$match": {
                "thickness_mm": e["thickness_mm"], "width_mm": e["width_mm"],
                "length_mm": e["length_mm"], "grade": e.get("grade"),
                "id": {"$ne": entry_id},
            }},
            {"$group": {
                "_id": None,
                "in": {"$sum": {"$cond": [{"$eq": ["$direction", "inward"]}, "$pieces", 0]}},
                "out": {"$sum": {"$cond": [{"$eq": ["$direction", "outward"]}, "$pieces", 0]}},
            }},
        ]
        others_avail = 0.0
        async for g in db.entries.aggregate(pipeline):
            others_avail = float(g["in"]) - float(g["out"])
        if float(patch["pieces"]) > others_avail + 1e-9:
            raise HTTPException(
                status_code=400,
                detail=f"INSUFFICIENT STOCK after correction: only {others_avail} pcs available",
            )

    changes = []
    for field in _CORRECTION_FIELDS:
        if field in patch and e.get(field) != patch[field]:
            changes.append({
                "field": field,
                "old": e.get(field),
                "new": patch[field],
                "by": user["id"],
                "by_name": user.get("name"),
                "by_role": user.get("role"),
                "at": now_utc(),
            })

    # Recompute theoretical weight if pieces changed, then re-evaluate variance.
    if "pieces" in patch:
        new_pieces = float(patch["pieces"])
        new_tw = calc_theoretical_weight(e["thickness_mm"], e["width_mm"], e["length_mm"], new_pieces)
        patch["theoretical_weight_kg"] = new_tw
        actual = patch.get("actual_weight_kg", e.get("actual_weight_kg"))
        vpct, flagged = calc_variance(new_tw, actual)
        patch["variance_pct"] = vpct
        patch["variance_flagged"] = flagged
    elif "actual_weight_kg" in patch:
        vpct, flagged = calc_variance(e["theoretical_weight_kg"], float(patch["actual_weight_kg"]))
        patch["variance_pct"] = vpct
        patch["variance_flagged"] = flagged

    await db.entries.update_one({"id": entry_id}, {"$set": patch})
    if changes:
        await _push_history(entry_id, changes)
    if "vehicle_number" in patch or "driver_name" in patch or "driver_phone" in patch:
        updated = await db.entries.find_one({"id": entry_id}, {"_id": 0, "vehicle_number": 1, "driver_name": 1, "driver_phone": 1})
        if updated:
            await _remember_vehicle(updated["vehicle_number"], updated.get("driver_name"), updated.get("driver_phone"))
    e = await db.entries.find_one({"id": entry_id}, {"_id": 0})
    e = await _enrich_entry(e, user)
    return EntryOut(**e)


# ---------- Vehicle memory ----------
@api_router.get("/vehicles/{plate}")
async def get_vehicle(plate: str, user: dict = Depends(current_user)):
    plate = (plate or "").strip().upper()
    if not plate:
        raise HTTPException(status_code=400, detail="plate required")
    v = await db.vehicles.find_one({"_id": plate}, {"_id": 0})
    if not v:
        return {"plate": plate, "last_driver": None, "last_phone": None, "last_used_at": None}
    return v


# ---------- Inventory ----------
@api_router.get("/inventory", response_model=List[InventoryGroup])
async def inventory(user: dict = Depends(current_user)):
    pipeline = [
        {
            "$group": {
                "_id": {
                    "t": "$thickness_mm",
                    "w": "$width_mm",
                    "l": "$length_mm",
                    "g": "$grade",
                },
                "in": {"$sum": {"$cond": [{"$eq": ["$direction", "inward"]}, "$pieces", 0]}},
                "out": {"$sum": {"$cond": [{"$eq": ["$direction", "outward"]}, "$pieces", 0]}},
                "inward_ids": {
                    "$push": {"$cond": [{"$eq": ["$direction", "inward"]}, "$id", "$$REMOVE"]}
                },
            }
        }
    ]
    results = []
    async for g in db.entries.aggregate(pipeline):
        t = g["_id"]["t"]
        w = g["_id"]["w"]
        l = g["_id"]["l"]
        grade = g["_id"].get("g")
        pin = float(g["in"])
        pout = float(g["out"])
        avail = pin - pout
        if avail <= 0:
            continue
        tw = calc_theoretical_weight(t, w, l, avail)
        results.append(InventoryGroup(
            thickness_mm=t, width_mm=w, length_mm=l, grade=grade,
            pieces_in=pin, pieces_out=pout, pieces_available=avail,
            theoretical_weight_available_kg=tw,
            inward_entry_ids=g.get("inward_ids", []),
        ))
    # Sort by thickness, width, length
    results.sort(key=lambda x: (x.thickness_mm, x.width_mm, x.length_mm))
    return results


# ---------- Utility ----------
@api_router.get("/")
async def root():
    return {"message": "SteelTrack API", "ok": True}


@api_router.get("/calc/weight")
async def calc_weight(thickness: float, width: float, length: float, pieces: float):
    return {"theoretical_weight_kg": calc_theoretical_weight(thickness, width, length, pieces)}


# ---------- Analytics ----------
@api_router.get("/analytics/summary")
async def analytics_summary(days: int = 7, user: dict = Depends(current_user)):
    """Daily totals for the last N days plus top parties/brokers (admin/office preferred,
    but any logged-in user may view since this is just rollups)."""
    today = now_utc().replace(hour=0, minute=0, second=0, microsecond=0)
    start = today - timedelta(days=days - 1)

    daily_pipe = [
        {"$match": {"created_at": {"$gte": start}}},
        {"$group": {
            "_id": {
                "day": {"$dateToString": {"format": "%Y-%m-%d", "date": "$created_at"}},
                "direction": "$direction",
            },
            "pieces": {"$sum": "$pieces"},
            "weight": {"$sum": "$theoretical_weight_kg"},
            "count": {"$sum": 1},
        }},
    ]
    buckets: dict = {}
    async for row in db.entries.aggregate(daily_pipe):
        day = row["_id"]["day"]
        direction = row["_id"]["direction"]
        if day not in buckets:
            buckets[day] = {"day": day, "inward_pcs": 0.0, "outward_pcs": 0.0,
                            "inward_kg": 0.0, "outward_kg": 0.0,
                            "inward_count": 0, "outward_count": 0}
        buckets[day][f"{direction}_pcs"] = round(float(row["pieces"]), 2)
        buckets[day][f"{direction}_kg"] = round(float(row["weight"]), 2)
        buckets[day][f"{direction}_count"] = int(row["count"])

    # Fill missing days
    daily = []
    for i in range(days):
        d = (start + timedelta(days=i)).strftime("%Y-%m-%d")
        daily.append(buckets.get(d, {
            "day": d, "inward_pcs": 0, "outward_pcs": 0,
            "inward_kg": 0, "outward_kg": 0,
            "inward_count": 0, "outward_count": 0,
        }))

    # Totals today & week
    today_str = today.strftime("%Y-%m-%d")
    today_row = buckets.get(today_str, {})
    totals_today = {
        "inward_pcs": today_row.get("inward_pcs", 0),
        "outward_pcs": today_row.get("outward_pcs", 0),
        "inward_kg": today_row.get("inward_kg", 0),
        "outward_kg": today_row.get("outward_kg", 0),
    }
    totals_window = {
        "inward_pcs": round(sum(b.get("inward_pcs", 0) for b in daily), 2),
        "outward_pcs": round(sum(b.get("outward_pcs", 0) for b in daily), 2),
        "inward_kg": round(sum(b.get("inward_kg", 0) for b in daily), 2),
        "outward_kg": round(sum(b.get("outward_kg", 0) for b in daily), 2),
    }

    # Top parties (outward with party_name)
    party_pipe = [
        {"$match": {"direction": "outward", "party_name": {"$ne": None}, "created_at": {"$gte": start}}},
        {"$group": {"_id": "$party_name", "pieces": {"$sum": "$pieces"},
                     "weight": {"$sum": "$theoretical_weight_kg"}, "count": {"$sum": 1}}},
        {"$sort": {"weight": -1}},
        {"$limit": 5},
    ]
    top_parties = []
    async for row in db.entries.aggregate(party_pipe):
        top_parties.append({
            "name": row["_id"],
            "pieces": round(float(row["pieces"]), 2),
            "weight": round(float(row["weight"]), 2),
            "count": int(row["count"]),
        })

    # Top brokers
    broker_pipe = [
        {"$match": {"direction": "outward", "broker_name": {"$ne": None}, "created_at": {"$gte": start}}},
        {"$group": {"_id": "$broker_name", "pieces": {"$sum": "$pieces"},
                     "weight": {"$sum": "$theoretical_weight_kg"}, "count": {"$sum": 1}}},
        {"$sort": {"weight": -1}},
        {"$limit": 5},
    ]
    top_brokers = []
    async for row in db.entries.aggregate(broker_pipe):
        top_brokers.append({
            "name": row["_id"],
            "pieces": round(float(row["pieces"]), 2),
            "weight": round(float(row["weight"]), 2),
            "count": int(row["count"]),
        })

    # Pending office count
    pending = await db.entries.count_documents({"invoice_no": {"$in": [None, ""]}})
    total_entries = await db.entries.count_documents({})

    # Low-stock groups (<= threshold, >0 available) + reorder suggestion
    threshold = float(await _get_setting("low_stock_threshold_pcs", LOW_STOCK_DEFAULT_PCS))
    stock_pipe = [
        {"$group": {
            "_id": {"t": "$thickness_mm", "w": "$width_mm", "l": "$length_mm", "g": "$grade"},
            "in": {"$sum": {"$cond": [{"$eq": ["$direction", "inward"]}, "$pieces", 0]}},
            "out": {"$sum": {"$cond": [{"$eq": ["$direction", "outward"]}, "$pieces", 0]}},
        }},
    ]

    # 28-day consumption for weekly average
    consumption_cutoff = now_utc() - timedelta(days=28)
    consumption_pipe = [
        {"$match": {"direction": "outward", "created_at": {"$gte": consumption_cutoff}}},
        {"$group": {
            "_id": {"t": "$thickness_mm", "w": "$width_mm", "l": "$length_mm", "g": "$grade"},
            "pcs": {"$sum": "$pieces"},
        }},
    ]
    consumption_map: dict = {}
    async for c in db.entries.aggregate(consumption_pipe):
        key = (c["_id"]["t"], c["_id"]["w"], c["_id"]["l"], c["_id"].get("g"))
        consumption_map[key] = float(c["pcs"]) / 4.0  # per week

    low_stock = []
    async for g in db.entries.aggregate(stock_pipe):
        avail = float(g["in"]) - float(g["out"])
        if 0 < avail <= threshold:
            t = g["_id"]["t"]; w = g["_id"]["w"]; l = g["_id"]["l"]; grade = g["_id"].get("g")
            weekly = round(consumption_map.get((t, w, l, grade), 0.0), 2)
            weeks_remaining: Optional[float] = round(avail / weekly, 1) if weekly > 0 else None
            reorder_qty = round(max(threshold * 2, weekly * 2) - avail, 2) if weekly > 0 else round(max(threshold * 2 - avail, 0.0), 2)
            low_stock.append({
                "thickness_mm": t, "width_mm": w, "length_mm": l, "grade": grade,
                "pieces_available": round(avail, 3),
                "theoretical_weight_available_kg": calc_theoretical_weight(t, w, l, avail),
                "avg_weekly_pcs": weekly,
                "weeks_remaining": weeks_remaining,
                "suggested_reorder_pcs": reorder_qty,
            })
    low_stock.sort(key=lambda x: (x.get("weeks_remaining") if x.get("weeks_remaining") is not None else 999, x["pieces_available"]))

    return {
        "window_days": days,
        "daily": daily,
        "totals_today": totals_today,
        "totals_window": totals_window,
        "top_parties": top_parties,
        "top_brokers": top_brokers,
        "pending_office": pending,
        "total_entries": total_entries,
        "low_stock_threshold_pcs": threshold,
        "low_stock": low_stock,
    }


# ---------- CSV Export ----------
@api_router.get("/entries.csv")
async def export_csv(
    direction: Optional[str] = None,
    token: Optional[str] = Query(None),
    cred: HTTPAuthorizationCredentials = Depends(security),
):
    tok = cred.credentials if cred else token
    if not tok:
        raise HTTPException(status_code=401, detail="Missing token")
    payload = decode_token(tok)
    u = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
    if not u or u["role"] not in ("admin", "office"):
        raise HTTPException(status_code=403, detail="Only admin/office may export")

    q: dict = {}
    if direction in ("inward", "outward"):
        q["direction"] = direction

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow([
        "Entry No.", "Direction", "Date", "Thickness (mm)", "Width (mm)", "Length (mm)",
        "Pieces", "Grade", "Vehicle No.", "Broker", "Theoretical Wt (kg)", "Actual Wt (kg)",
        "Variance %", "Flagged", "Invoice No.", "Party Name", "Rate (Rs)", "Payment Terms",
        "Remarks", "Office Remarks", "Created By",
    ])
    user_cache: dict = {}
    async for e in db.entries.find(q, {"_id": 0}).sort("created_at", -1):
        uid = e.get("created_by")
        if uid and uid not in user_cache:
            ux = await db.users.find_one({"id": uid}, {"_id": 0, "name": 1})
            user_cache[uid] = ux["name"] if ux else "Unknown"
        created_at = e.get("created_at")
        date_str = created_at.strftime("%Y-%m-%d %H:%M") if hasattr(created_at, "strftime") else str(created_at)
        writer.writerow([
            e.get("entry_number", ""),
            (e.get("direction") or "").upper(),
            date_str,
            e.get("thickness_mm", ""),
            e.get("width_mm", ""),
            e.get("length_mm", ""),
            e.get("pieces", ""),
            e.get("grade") or "",
            e.get("vehicle_number", ""),
            e.get("broker_name") or "",
            e.get("theoretical_weight_kg", ""),
            e.get("actual_weight_kg") or "",
            e.get("variance_pct") if e.get("variance_pct") is not None else "",
            "YES" if e.get("variance_flagged") else "NO" if e.get("actual_weight_kg") else "",
            e.get("invoice_no") or "",
            e.get("party_name") or "",
            e.get("rate") if e.get("rate") is not None else "",
            e.get("payment_terms") or "",
            e.get("remarks") or "",
            e.get("office_remarks") or "",
            user_cache.get(uid, "Unknown"),
        ])

    buf.seek(0)
    filename = f"steeltrack-entries-{now_utc().strftime('%Y%m%d-%H%M')}.csv"
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ---------- Voice Transcription ----------
_HINDI_WORD_TO_NUM = {
    "शून्य": 0, "सिफर": 0,
    "एक": 1, "दो": 2, "तीन": 3, "चार": 4, "पांच": 5, "पाँच": 5,
    "छह": 6, "छः": 6, "सात": 7, "आठ": 8, "नौ": 9, "दस": 10,
    "ग्यारह": 11, "बारह": 12, "तेरह": 13, "चौदह": 14, "पंद्रह": 15,
    "सोलह": 16, "सत्रह": 17, "अठारह": 18, "उन्नीस": 19, "बीस": 20,
    "सौ": 100, "हजार": 1000, "हज़ार": 1000, "लाख": 100000,
    "पच्चीस": 25, "पचास": 50, "पचहत्तर": 75,
    "आधा": 0.5, "डेढ़": 1.5,
}
_EN_WORD_TO_NUM = {
    "zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
    "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
    "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15,
    "sixteen": 16, "seventeen": 17, "eighteen": 18, "nineteen": 19,
    "twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60,
    "seventy": 70, "eighty": 80, "ninety": 90,
    "hundred": 100, "thousand": 1000, "lakh": 100000,
    "half": 0.5,
}


def _extract_numbers(text: str) -> list:
    """Extract numbers from mixed Hindi/English text in reading order.
    Finds explicit digit tokens first, then falls back to word combos like
    'twelve fifty' = 1250 and 'दस' = 10. Keeps it simple and safe."""
    if not text:
        return []
    nums: list = []

    # Direct digits (supports decimals like 0.5)
    for m in re.finditer(r"\d+(?:\.\d+)?", text):
        try:
            val = float(m.group(0))
            if val.is_integer():
                val = int(val)
            nums.append(val)
        except Exception:
            pass

    if nums:
        return nums

    # Word-based parsing (fallback) — handle Hindi + English combos.
    tokens = re.findall(r"\S+", text.lower())
    i = 0
    combos: list = []
    while i < len(tokens):
        tok = tokens[i].strip(",.?!;:'\"")
        base = _HINDI_WORD_TO_NUM.get(tok) or _EN_WORD_TO_NUM.get(tok)
        if base is not None:
            n = base
            # look-ahead for "hundred", "thousand", or two-word combo like "twelve fifty"
            if i + 1 < len(tokens):
                nxt = tokens[i + 1].strip(",.?!;:'\"")
                nxt_val = _HINDI_WORD_TO_NUM.get(nxt) or _EN_WORD_TO_NUM.get(nxt)
                if nxt_val in (100, 1000, 100000):
                    n = n * nxt_val
                    i += 1
                elif nxt_val and nxt_val < 100 and base >= 10 and base % 10 == 0 and base < 100:
                    # "twenty five" = 25
                    n = base + nxt_val
                    i += 1
                elif nxt_val and base in (10, 11, 12, 13, 14, 15, 16, 17, 18, 19) and nxt_val < 100:
                    # "twelve fifty" = 1250 (col width convention)
                    n = base * 100 + nxt_val
                    i += 1
            combos.append(n)
        i += 1
    return combos


@api_router.post("/voice/transcribe")
async def voice_transcribe(file: UploadFile = File(...), user: dict = Depends(current_user)):
    """Accept short audio, transcribe via Emergent-managed OpenAI STT
    (gpt-4o-mini-transcribe), and extract up to 3 numbers in reading order
    for Thickness / Width / Length."""
    data = await file.read()
    if len(data) < 1024:
        raise HTTPException(status_code=400, detail="Audio too short")
    if len(data) > 25 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Audio too large (max 25MB)")

    name = file.filename or "audio.m4a"
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else "m4a"
    if ext not in {"mp3", "mp4", "mpeg", "mpga", "m4a", "wav", "webm"}:
        ext = "m4a"

    text = ""
    try:
        from emergentintegrations.llm.openai import OpenAISpeechToText
        stt = OpenAISpeechToText(api_key=EMERGENT_KEY)
        with tempfile.NamedTemporaryFile(delete=False, suffix=f".{ext}") as tmp:
            tmp.write(data)
            tmp_path = tmp.name
        try:
            with open(tmp_path, "rb") as fh:
                resp = await stt.transcribe(
                    file=fh,
                    model="gpt-4o-mini-transcribe",
                    response_format="json",
                    temperature=0.0,
                    prompt="Steel plate dimensions in millimeters: thickness, width, length. मोटाई, चौड़ाई, लम्बाई मिलीमीटर में।",
                )
            text = (getattr(resp, "text", "") or "").strip()
        finally:
            try:
                os.unlink(tmp_path)
            except Exception:
                pass
    except Exception as e:
        logger.error(f"Voice transcription failed: {e}")
        raise HTTPException(status_code=502, detail=f"Transcription failed: {e}")

    numbers = _extract_numbers(text)
    return {
        "text": text,
        "numbers": numbers[:3],
    }


# ---------- Vision OCR: read weight from slip ----------
@api_router.post("/vision/weight")
async def vision_weight(
    file: Optional[UploadFile] = File(None),
    slip_photo_path: Optional[str] = Form(None),
    user: dict = Depends(current_user),
):
    """Read NET weight (kg) from a weighment slip photo using OpenAI vision via
    Emergent universal key. Caller may upload the image or reference an already
    uploaded `slip_photo_path`."""
    data: Optional[bytes] = None
    mime = "image/jpeg"
    if file is not None:
        data = await file.read()
        mime = file.content_type or "image/jpeg"
    elif slip_photo_path:
        upload = await db.uploads.find_one({"path": slip_photo_path}, {"_id": 0})
        if not upload:
            raise HTTPException(status_code=404, detail="Slip photo not found")
        if user["role"] == "labour" and upload.get("owner_id") != user["id"]:
            raise HTTPException(status_code=403, detail="Forbidden")
        try:
            data, mime = await run_in_threadpool(_sync_get_object, slip_photo_path)
        except requests.HTTPError:
            raise HTTPException(status_code=404, detail="Slip photo not accessible")
    else:
        raise HTTPException(status_code=400, detail="Provide file or slip_photo_path")

    if not data or len(data) < 500:
        raise HTTPException(status_code=400, detail="Image too small")

    # Normalise mime
    if mime not in ("image/jpeg", "image/png", "image/webp"):
        mime = "image/jpeg"

    img_b64 = base64.b64encode(data).decode("ascii")

    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent
        chat = LlmChat(
            api_key=EMERGENT_KEY,
            session_id=f"vision-{user['id']}-{uuid.uuid4().hex[:8]}",
            system_message=(
                "You are an OCR assistant for Indian steel weighment slips. "
                "Read numbers printed on the slip. The slip shows GROSS, TARE, and NET weights in kilograms. "
                "ALWAYS return the NET weight when present; if only one weight is shown, return that. "
                "Respond ONLY as compact JSON: {\"weight_kg\": <number or null>, \"unit\": \"kg\", \"confidence\": <0..1>, \"raw\": \"<short text seen>\"}. "
                "If no weight is clearly visible, use null and confidence 0."
            ),
        ).with_model("openai", "gpt-4o-mini")

        user_msg = UserMessage(
            text="Extract the NET weight in kilograms from this weighment slip. Return JSON only.",
            file_contents=[ImageContent(image_base64=img_b64)],
        )

        # Prefer non-streaming for a short JSON response
        response = await chat.send_message(user_msg)
        text_out = str(response) if response is not None else ""
    except Exception as e:
        logger.error(f"Vision OCR failed: {e}")
        raise HTTPException(status_code=502, detail=f"Vision read failed: {e}")

    # Extract JSON from response
    weight_kg: Optional[float] = None
    confidence: float = 0.0
    raw_text = ""
    try:
        # Find a JSON object in the response (model may wrap in ```)
        m = re.search(r"\{.*\}", text_out, re.S)
        if m:
            parsed = json.loads(m.group(0))
            w = parsed.get("weight_kg")
            if isinstance(w, (int, float)):
                weight_kg = float(w)
            confidence = float(parsed.get("confidence", 0.0))
            raw_text = str(parsed.get("raw", ""))[:200]
    except Exception:
        pass

    # Fallback: regex a plausible kg number
    if weight_kg is None:
        for m in re.finditer(r"(\d{2,6}(?:\.\d{1,3})?)\s*(?:kg|KG|kilo)?", text_out):
            try:
                val = float(m.group(1))
                if 1 <= val <= 100000:
                    weight_kg = val
                    confidence = max(confidence, 0.4)
                    break
            except Exception:
                pass

    return {
        "weight_kg": weight_kg,
        "confidence": confidence,
        "raw": raw_text or (text_out[:160] if text_out else ""),
    }


# ---------- Settings (low-stock threshold etc.) ----------
async def _get_setting(key: str, default):
    doc = await db.settings.find_one({"_id": key})
    return doc.get("value", default) if doc else default


@api_router.get("/settings/low-stock")
async def get_low_stock_setting(user: dict = Depends(current_user)):
    v = await _get_setting("low_stock_threshold_pcs", LOW_STOCK_DEFAULT_PCS)
    return {"low_stock_threshold_pcs": float(v)}


class LowStockUpdate(BaseModel):
    low_stock_threshold_pcs: float = Field(ge=0)


@api_router.patch("/settings/low-stock")
async def set_low_stock_setting(body: LowStockUpdate, admin: dict = Depends(require_role("admin"))):
    await db.settings.update_one(
        {"_id": "low_stock_threshold_pcs"},
        {"$set": {"value": float(body.low_stock_threshold_pcs), "updated_by": admin["id"], "updated_at": now_utc()}},
        upsert=True,
    )
    return {"low_stock_threshold_pcs": float(body.low_stock_threshold_pcs)}


# ---------- Email helpers (Resend via Emergent proxy) ----------
_SHORTENERS = ("bit.ly", "tinyurl.com", "t.co", "is.gd", "cutt.ly", "goo.gl", "rebrand.ly")
_CRED_ASK = ("reply with your password", "reply with the code", "send your password", "cvv",
             "send us your password", "enter your password below", "confirm your card number",
             "your full card number", "seed phrase", "recovery phrase", "verify your card",
             "social security number", "confirm your bank details")
_HOSTISH = re.compile(r"\b(?:https?://)?((?:[a-z0-9-]+\.)+[a-z]{2,})", re.I)


def _host_ok(host: str) -> bool:
    if not host or "xn--" in host:
        return False
    try:
        ipaddress.ip_address(host)
        return False
    except ValueError:
        pass
    return not any(host == s or host.endswith("." + s) for s in _SHORTENERS)


def _same_site(shown: str, real: str) -> bool:
    return shown == real or real.endswith("." + shown) or shown.endswith("." + real)


class _EmailScan(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tags, self.urls, self.anchors = set(), [], []
        self._href, self._text = None, []

    def handle_starttag(self, tag, attrs):
        self.tags.add(tag.lower())
        self.urls += [v for k, v in attrs if k.lower() in ("href", "src") and v]
        if tag.lower() == "a":
            self._href = dict((k.lower(), v) for k, v in attrs).get("href")
            self._text = []

    def handle_data(self, data):
        if self._href is not None:
            self._text.append(data)

    def handle_endtag(self, tag):
        if tag.lower() == "a" and self._href is not None:
            self.anchors.append((self._href, "".join(self._text)))
            self._href, self._text = None, []


def _assert_safe_email(subject: str, html: str) -> None:
    scan = _EmailScan()
    scan.feed(html)
    if scan.tags & {"form", "input", "textarea", "select"}:
        raise ValueError("No forms or input fields in email (G2)")
    body = f"{subject}\n{html}".lower()
    for p in _CRED_ASK:
        if p in body:
            raise ValueError(f"Email asks the recipient for credentials: {p!r} (G2)")
    for url in scan.urls:
        low = url.strip().lower()
        if low.startswith(("mailto:", "tel:", "cid:", "#")):
            continue
        if not low.startswith("https://"):
            raise ValueError(f"Email links/assets must be absolute https: {url!r} (G3)")
        host = urlparse(low).hostname or ""
        if not _host_ok(host) or urlparse(low).username is not None:
            raise ValueError(f"Shortened, numeric-host or credential-bearing URL: {url!r} (G3)")
    for href, text in scan.anchors:
        real = urlparse(href.strip().lower()).hostname or ""
        if not real:
            continue
        for m in _HOSTISH.finditer(text):
            if not _same_site(m.group(1).lower(), real):
                raise ValueError(f"Anchor text {m.group(1)!r} ≠ real link host {real!r} (G3)")


async def _send_email(*, to: str, subject: str, html: str) -> Optional[str]:
    if not EMAIL_KEY:
        raise HTTPException(status_code=503, detail="Email not configured")
    _assert_safe_email(subject, html)
    payload = {"to": [to], "subject": subject, "html": html, "from_name": EMAIL_FROM_NAME}
    try:
        async with httpx.AsyncClient(timeout=30) as c:
            resp = await c.post(
                f"{EMAIL_BASE_URL}/api/v1/email/send",
                headers={"X-Email-Key": EMAIL_KEY},
                json=payload,
            )
        resp.raise_for_status()
        return resp.json().get("id")
    except httpx.HTTPStatusError as e:
        logger.error(f"Email send failed: {e.response.status_code} {e.response.text}")
        raise HTTPException(status_code=502, detail="Failed to send email")


# ---------- PDF Report ----------
def _build_party_pdf(party: str, entries: list, start: datetime, end: datetime) -> bytes:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib import colors as rl_colors
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=15 * mm, rightMargin=15 * mm,
                            topMargin=15 * mm, bottomMargin=15 * mm, title=f"SteelTrack {party} Statement")
    styles = getSampleStyleSheet()
    story: list = []

    hdr = ParagraphStyle("hdr", parent=styles["Heading1"], fontSize=20, textColor=rl_colors.HexColor("#111111"), spaceAfter=4)
    sub = ParagraphStyle("sub", parent=styles["Normal"], fontSize=10, textColor=rl_colors.HexColor("#52525B"), spaceAfter=12)
    bar = ParagraphStyle("bar", parent=styles["Normal"], fontSize=11, textColor=rl_colors.HexColor("#FFFFFF"),
                         backColor=rl_colors.HexColor("#FF4500"), leftIndent=0, borderPadding=8, spaceAfter=10)

    story.append(Paragraph("STEEL<font color='#FF4500'>TRACK</font>", hdr))
    story.append(Paragraph(f"Statement for {escape(party)}", sub))
    story.append(Paragraph(f"Period: {start.strftime('%d %b %Y')} to {end.strftime('%d %b %Y')} &nbsp;&nbsp;·&nbsp;&nbsp; Generated: {now_utc().strftime('%d %b %Y %H:%M UTC')}", sub))
    story.append(Spacer(1, 6))

    rows = [["Date", "Entry No.", "Dir.", "Dimensions (mm)", "Pcs", "Grade", "Vehicle", "Wt (kg)", "Invoice", "Rate"]]
    total_pcs = 0.0
    total_wt = 0.0
    total_rate_value = 0.0
    for e in entries:
        dt = e.get("created_at")
        date_str = dt.strftime("%d-%m-%Y") if hasattr(dt, "strftime") else str(dt)[:10]
        rows.append([
            date_str,
            e.get("entry_number", ""),
            (e.get("direction") or "").upper()[:3],
            f"{e.get('thickness_mm')}×{e.get('width_mm')}×{e.get('length_mm')}",
            str(e.get("pieces", "")),
            e.get("grade") or "-",
            e.get("vehicle_number", ""),
            f"{float(e.get('theoretical_weight_kg', 0) or 0):.1f}",
            e.get("invoice_no") or "-",
            f"{e.get('rate'):.2f}" if e.get("rate") else "-",
        ])
        total_pcs += float(e.get("pieces", 0) or 0)
        total_wt += float(e.get("theoretical_weight_kg", 0) or 0)
        if e.get("rate") and e.get("theoretical_weight_kg"):
            total_rate_value += float(e["rate"]) * float(e["theoretical_weight_kg"])

    rows.append(["", "", "", "TOTAL", f"{total_pcs:.2f}", "", "", f"{total_wt:.2f}", "", f"{total_rate_value:,.2f}"])

    tbl = Table(rows, repeatRows=1, colWidths=[60, 80, 32, 90, 36, 46, 60, 50, 54, 44])
    tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), rl_colors.HexColor("#111111")),
        ("TEXTCOLOR", (0, 0), (-1, 0), rl_colors.white),
        ("FONTSIZE", (0, 0), (-1, 0), 9),
        ("FONTSIZE", (0, 1), (-1, -1), 8),
        ("GRID", (0, 0), (-1, -1), 0.5, rl_colors.HexColor("#E4E4E7")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("BACKGROUND", (0, -1), (-1, -1), rl_colors.HexColor("#F4F4F5")),
        ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
    ]))
    story.append(tbl)
    story.append(Spacer(1, 20))
    story.append(Paragraph(
        f"<b>{len(entries)}</b> entries &nbsp;·&nbsp; <b>{total_pcs:.2f}</b> pieces &nbsp;·&nbsp; <b>{total_wt:,.2f} kg</b> theoretical weight",
        styles["Normal"]))
    doc.build(story)
    return buf.getvalue()


class PartyReportRequest(BaseModel):
    party_name: str
    from_date: Optional[str] = None  # YYYY-MM-DD
    to_date: Optional[str] = None


@api_router.post("/reports/party-statement")
async def generate_party_statement(
    body: PartyReportRequest,
    user: dict = Depends(require_role("admin", "office")),
):
    """Generate PDF statement for a party and email a signed download link to the
    logged-in user's own email. Recipient is server-side (G4)."""
    if not user.get("email"):
        raise HTTPException(status_code=400, detail="User has no email on file")
    party = body.party_name.strip()
    if not party:
        raise HTTPException(status_code=400, detail="party_name required")

    today = now_utc()
    if body.from_date and body.to_date:
        try:
            start = datetime.strptime(body.from_date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
            end = datetime.strptime(body.to_date, "%Y-%m-%d").replace(hour=23, minute=59, second=59, tzinfo=timezone.utc)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date format (YYYY-MM-DD)")
    else:
        # Default to current calendar month
        start = today.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        end = today

    entries = []
    async for e in db.entries.find(
        {"party_name": party, "created_at": {"$gte": start, "$lte": end}},
        {"_id": 0},
    ).sort("created_at", 1):
        entries.append(e)

    if not entries:
        raise HTTPException(status_code=404, detail=f"No entries for party '{party}' in that period")

    pdf_bytes = await run_in_threadpool(_build_party_pdf, party, entries, start, end)

    report_id = uuid.uuid4().hex
    path = f"{APP_NAME}/reports/{user['id']}/{report_id}.pdf"
    await run_in_threadpool(_sync_put_object, path, pdf_bytes, "application/pdf")
    await db.reports.insert_one({
        "id": report_id,
        "path": path,
        "owner_id": user["id"],
        "party_name": party,
        "from": start,
        "to": end,
        "entries_count": len(entries),
        "created_at": now_utc(),
    })

    public_base = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "").strip()
    if not public_base.startswith("https://"):
        # Fallback for local dev: still produce a URL even if backend URL missing
        public_base = "https://weight-check-30.preview.emergentagent.com"
    # Short-lived token (24h) scoped to download this report
    dl_token = pyjwt.encode(
        {"sub": user["id"], "report_id": report_id, "exp": now_utc() + timedelta(hours=24)},
        JWT_SECRET, algorithm=JWT_ALGO,
    )
    download_url = f"{public_base}/api/reports/{report_id}.pdf?token={dl_token}"

    period_label = f"{start.strftime('%d %b %Y')} – {end.strftime('%d %b %Y')}"
    subject = f"Statement for {party} ({period_label}) — {EMAIL_FROM_NAME}"
    safe_party = escape(party)
    safe_name = escape(user.get("name") or user.get("email") or "")
    html = (
        f"<table role='presentation' width='100%' style='font-family:Arial,sans-serif;background:#ffffff'>"
        f"<tr><td style='padding:24px'>"
        f"<h2 style='margin:0 0 4px 0;color:#111111'>SteelTrack Statement</h2>"
        f"<p style='margin:0 0 16px 0;color:#52525B;font-size:13px'>Party: <b>{safe_party}</b></p>"
        f"<p style='margin:0 0 8px 0;color:#111111'>Hi {safe_name},</p>"
        f"<p style='margin:0 0 12px 0;color:#111111'>Your requested statement for <b>{safe_party}</b> covering {escape(period_label)} is ready. "
        f"It contains <b>{len(entries)}</b> entries. Tap the button below to download the PDF.</p>"
        f"<p style='margin:16px 0'><a href='{escape(download_url)}' "
        f"style='background:#FF4500;color:#ffffff;padding:12px 20px;text-decoration:none;font-weight:bold;letter-spacing:1px;display:inline-block'>DOWNLOAD PDF</a></p>"
        f"<p style='margin:16px 0 0 0;font-size:11px;color:#888'>Download link expires in 24 hours. Sent by {escape(EMAIL_FROM_NAME)}. "
        f"We never ask for your password or card details by email.</p>"
        f"</td></tr></table>"
    )

    email_id: Optional[str] = None
    email_error: Optional[str] = None
    try:
        email_id = await _send_email(to=user["email"], subject=subject, html=html)
    except HTTPException as he:
        email_error = str(he.detail)
        logger.warning(f"Party statement email failed to {user['email']}: {email_error}")

    return {
        "report_id": report_id,
        "download_url": download_url,
        "email_id": email_id,
        "email_error": email_error,
        "sent_to": user["email"],
        "entries_count": len(entries),
        "party_name": party,
        "from": start.date().isoformat(),
        "to": end.date().isoformat(),
    }


@api_router.get("/reports/{report_id}.pdf")
async def download_report(
    report_id: str,
    token: Optional[str] = Query(None),
    cred: HTTPAuthorizationCredentials = Depends(security),
):
    tok = cred.credentials if cred else token
    if not tok:
        raise HTTPException(status_code=401, detail="Missing token")
    payload = decode_token(tok)
    rep = await db.reports.find_one({"id": report_id}, {"_id": 0})
    if not rep:
        raise HTTPException(status_code=404, detail="Report not found")
    # Allow owner, or any admin/office user with full token
    uid = payload["sub"]
    rep_id_scope = payload.get("report_id")
    is_owner = rep["owner_id"] == uid and (rep_id_scope is None or rep_id_scope == report_id)
    if not is_owner:
        u = await db.users.find_one({"id": uid}, {"_id": 0, "password_hash": 0})
        if not u or u["role"] not in ("admin", "office"):
            raise HTTPException(status_code=403, detail="Forbidden")
    try:
        content, ctype = await run_in_threadpool(_sync_get_object, rep["path"])
    except requests.HTTPError:
        raise HTTPException(status_code=404, detail="PDF not accessible")
    kind = rep.get("kind") or "statement"
    label = rep.get("party_name") or rep.get("invoice_no") or "steeltrack"
    return Response(
        content=content, media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{label}-{kind}-{report_id[:8]}.pdf"'},
    )


# ---------- Party & Grade helpers ----------
def _norm_phone(phone: Optional[str]) -> Optional[str]:
    """Normalise an Indian/International phone for wa.me (digits only)."""
    if not phone:
        return None
    digits = re.sub(r"\D", "", phone)
    if not digits:
        return None
    # If a 10-digit number is given, assume Indian number (+91)
    if len(digits) == 10:
        digits = "91" + digits
    return digits


class PartyUpsert(BaseModel):
    name: str
    whatsapp: Optional[str] = None
    email: Optional[str] = None


@api_router.get("/parties")
async def list_parties(user: dict = Depends(require_role("admin", "office"))):
    """Distinct party names (from entries + stored party records) with WhatsApp phone."""
    stored = {}
    async for p in db.parties.find({}, {"_id": 0}):
        stored[p["name"]] = p

    names = set(stored.keys())
    for p in await db.entries.distinct("party_name"):
        if p:
            names.add(p)

    out = []
    for name in sorted(names, key=lambda s: s.lower()):
        rec = stored.get(name, {})
        out.append({
            "name": name,
            "whatsapp": rec.get("whatsapp"),
            "whatsapp_digits": _norm_phone(rec.get("whatsapp")),
            "email": rec.get("email"),
        })
    return out


@api_router.put("/parties/{name}")
async def upsert_party(name: str, body: PartyUpsert, user: dict = Depends(require_role("admin", "office"))):
    norm = _norm_phone(body.whatsapp)
    doc = {
        "name": name.strip(),
        "whatsapp": body.whatsapp.strip() if body.whatsapp else None,
        "whatsapp_digits": norm,
        "email": body.email.strip() if body.email else None,
        "updated_by": user["id"],
        "updated_at": now_utc(),
    }
    await db.parties.update_one({"name": doc["name"]}, {"$set": doc}, upsert=True)
    return doc


# ---------- Invoice PDF per entry ----------
def _build_invoice_pdf(entry: dict) -> bytes:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib import colors as rl_colors
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm,
                            topMargin=18 * mm, bottomMargin=18 * mm, title=f"Invoice {entry.get('invoice_no') or entry['entry_number']}")
    styles = getSampleStyleSheet()
    hdr = ParagraphStyle("hdr", parent=styles["Heading1"], fontSize=22, textColor=rl_colors.HexColor("#111111"), spaceAfter=0)
    sub = ParagraphStyle("sub", parent=styles["Normal"], fontSize=10, textColor=rl_colors.HexColor("#52525B"), spaceAfter=12)

    story = []
    story.append(Paragraph("STEEL<font color='#FF4500'>TRACK</font>", hdr))
    story.append(Paragraph("Delivery Invoice", sub))

    inv_rows = [
        ["Invoice No.", entry.get("invoice_no") or "-"],
        ["Entry No.", entry.get("entry_number", "")],
        ["Date", entry["created_at"].strftime("%d %b %Y, %H:%M") if hasattr(entry.get("created_at"), "strftime") else str(entry.get("created_at"))],
        ["Party", entry.get("party_name") or "-"],
        ["Vehicle", entry.get("vehicle_number", "")],
        ["Broker", entry.get("broker_name") or "-"],
    ]
    meta = Table(inv_rows, colWidths=[90, 320])
    meta.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("TEXTCOLOR", (0, 0), (0, -1), rl_colors.HexColor("#52525B")),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(meta)
    story.append(Spacer(1, 10))

    rate = float(entry.get("rate") or 0)
    wt = float(entry.get("theoretical_weight_kg") or 0)
    amount = round(rate * wt, 2)

    data = [
        ["Description", "Dimensions (mm)", "Grade", "Pieces", "Weight (kg)", "Rate (Rs/kg)", "Amount (Rs)"],
        [
            f"{(entry.get('direction') or '').title()} Steel Plates",
            f"{entry['thickness_mm']}×{entry['width_mm']}×{entry['length_mm']}",
            entry.get("grade") or "-",
            str(entry.get("pieces", "")),
            f"{wt:,.2f}",
            f"{rate:,.2f}" if rate else "-",
            f"{amount:,.2f}" if rate else "-",
        ],
    ]
    tbl = Table(data, colWidths=[112, 86, 46, 42, 54, 52, 68])
    tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), rl_colors.HexColor("#111111")),
        ("TEXTCOLOR", (0, 0), (-1, 0), rl_colors.white),
        ("FONTSIZE", (0, 0), (-1, 0), 9),
        ("FONTSIZE", (0, 1), (-1, -1), 10),
        ("GRID", (0, 0), (-1, -1), 0.5, rl_colors.HexColor("#E4E4E7")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    story.append(tbl)
    story.append(Spacer(1, 14))

    totals = Table([
        ["Payment Terms", entry.get("payment_terms") or "-"],
        ["Theoretical Weight (kg)", f"{wt:,.2f}"],
        ["Actual Weight (kg)", f"{float(entry['actual_weight_kg']):,.2f}" if entry.get("actual_weight_kg") is not None else "-"],
        ["Variance (%)", f"{entry.get('variance_pct')}%" if entry.get("variance_pct") is not None else "-"],
        ["TOTAL AMOUNT (Rs)", f"{amount:,.2f}" if rate else "-"],
    ], colWidths=[260, 200])
    totals.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("GRID", (0, 0), (-1, -1), 0.5, rl_colors.HexColor("#E4E4E7")),
        ("BACKGROUND", (0, -1), (-1, -1), rl_colors.HexColor("#FF4500")),
        ("TEXTCOLOR", (0, -1), (-1, -1), rl_colors.white),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
    ]))
    story.append(totals)
    story.append(Spacer(1, 24))
    story.append(Paragraph("<font size=9 color='#52525B'>Generated by SteelTrack. Theoretical weight is calculated at 7850 kg/m^3.</font>", styles["Normal"]))
    doc.build(story)
    return buf.getvalue()


@api_router.post("/entries/{entry_id}/invoice-pdf")
async def generate_entry_invoice(entry_id: str, user: dict = Depends(require_role("admin", "office"))):
    """Generate a single-entry invoice PDF, store it, and email the download link to the office user."""
    e = await db.entries.find_one({"id": entry_id}, {"_id": 0})
    if not e:
        raise HTTPException(status_code=404, detail="Entry not found")
    if not e.get("invoice_no") or not e.get("party_name"):
        raise HTTPException(status_code=400, detail="Add Invoice No. and Party Name before generating the PDF")
    if not user.get("email"):
        raise HTTPException(status_code=400, detail="User has no email on file")

    pdf_bytes = await run_in_threadpool(_build_invoice_pdf, e)
    report_id = uuid.uuid4().hex
    path = f"{APP_NAME}/invoices/{user['id']}/{report_id}.pdf"
    await run_in_threadpool(_sync_put_object, path, pdf_bytes, "application/pdf")
    await db.reports.insert_one({
        "id": report_id,
        "path": path,
        "owner_id": user["id"],
        "entry_id": entry_id,
        "kind": "invoice",
        "invoice_no": e.get("invoice_no"),
        "party_name": e.get("party_name"),
        "created_at": now_utc(),
    })

    public_base = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "").strip()
    if not public_base.startswith("https://"):
        public_base = "https://weight-check-30.preview.emergentagent.com"
    dl_token = pyjwt.encode(
        {"sub": user["id"], "report_id": report_id, "exp": now_utc() + timedelta(hours=48)},
        JWT_SECRET, algorithm=JWT_ALGO,
    )
    download_url = f"{public_base}/api/reports/{report_id}.pdf?token={dl_token}"

    safe_name = escape(user.get("name") or user.get("email") or "")
    safe_party = escape(e.get("party_name") or "")
    safe_invoice = escape(e.get("invoice_no") or "")
    subject = f"Invoice {e.get('invoice_no')} — {e.get('party_name')} — {EMAIL_FROM_NAME}"
    html = (
        f"<table role='presentation' width='100%' style='font-family:Arial,sans-serif;background:#ffffff'>"
        f"<tr><td style='padding:24px'>"
        f"<h2 style='margin:0 0 4px 0;color:#111111'>SteelTrack Invoice</h2>"
        f"<p style='margin:0 0 16px 0;color:#52525B;font-size:13px'>Invoice: <b>{safe_invoice}</b> · Party: <b>{safe_party}</b></p>"
        f"<p style='margin:0 0 12px 0;color:#111111'>Hi {safe_name}, your invoice PDF is ready. Tap below to download.</p>"
        f"<p style='margin:16px 0'><a href='{escape(download_url)}' "
        f"style='background:#FF4500;color:#ffffff;padding:12px 20px;text-decoration:none;font-weight:bold;letter-spacing:1px;display:inline-block'>DOWNLOAD INVOICE PDF</a></p>"
        f"<p style='margin:16px 0 0 0;font-size:11px;color:#888'>Link expires in 48 hours. Sent by {escape(EMAIL_FROM_NAME)}. "
        f"We never ask for your password or card details by email.</p>"
        f"</td></tr></table>"
    )
    email_id: Optional[str] = None
    email_error: Optional[str] = None
    try:
        email_id = await _send_email(to=user["email"], subject=subject, html=html)
    except HTTPException as he:
        email_error = str(he.detail)
        logger.warning(f"Invoice email failed to {user['email']}: {email_error}")
    return {
        "report_id": report_id,
        "download_url": download_url,
        "email_id": email_id,
        "email_error": email_error,
        "sent_to": user["email"],
        "entry_id": entry_id,
    }


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
