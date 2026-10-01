from fastapi import FastAPI, APIRouter, HTTPException, Depends, UploadFile, File, Form, Query
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.responses import Response
from fastapi.concurrency import run_in_threadpool
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
async def _enrich_entry(e: dict) -> dict:
    if "created_by" in e:
        u = await db.users.find_one({"id": e["created_by"]}, {"_id": 0, "name": 1})
        e["created_by_name"] = u["name"] if u else "Unknown"
    return e


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
    doc = await _enrich_entry(doc)
    return EntryOut(**doc)


@api_router.post("/entries/outward", response_model=EntryOut)
async def create_outward(body: OutwardCreate, user: dict = Depends(require_role("admin", "labour", "office"))):
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
    doc = await _enrich_entry(doc)
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
        e = await _enrich_entry(e)
        out.append(EntryOut(**e))
    return out


@api_router.get("/entries/{entry_id}", response_model=EntryOut)
async def get_entry(entry_id: str, user: dict = Depends(current_user)):
    e = await db.entries.find_one({"id": entry_id}, {"_id": 0})
    if not e:
        raise HTTPException(status_code=404, detail="Entry not found")
    e = await _enrich_entry(e)
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
    update["office_updated_by"] = user["id"]
    update["office_updated_at"] = now_utc()
    await db.entries.update_one({"id": entry_id}, {"$set": update})
    e = await db.entries.find_one({"id": entry_id}, {"_id": 0})
    e = await _enrich_entry(e)
    return EntryOut(**e)


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


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
