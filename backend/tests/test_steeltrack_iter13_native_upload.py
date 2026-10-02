"""
Iteration 13 — Native upload fix (expo/fetch "Unsupported FormData implementation").
Native clients bypass multipart FormData and send base64 JSON instead.

Coverage:
  - POST /api/upload/base64: happy path (PNG), file retrievable via /api/files,
    invalid base64 -> 400, empty file -> 400, no auth -> 401/403
  - POST /api/vision/weight/path: real OCR on synthetic PIL slip (weight+vehicle),
    labour reading another user's path -> 403, nonexistent path -> 404, no auth
  - POST /api/voice/transcribe/base64: tiny payload -> 400 "Audio too short",
    invalid base64 -> 400, valid WAV -> reaches STT (200 or 422, never 4xx-contract)
"""
import base64
import io
import os
import struct
import uuid
import wave

import pytest
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / "frontend" / ".env")
BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")

RUN = uuid.uuid4().hex[:6].upper()


def _h(auth):
    return {"Authorization": f"Bearer {auth['token']}", "Content-Type": "application/json"}


def _png_bytes() -> bytes:
    """Small valid PNG (PIL) > 500 bytes so vision 'image too small' guard passes."""
    from PIL import Image, ImageDraw
    img = Image.new("RGB", (200, 120), "white")
    d = ImageDraw.Draw(img)
    d.text((10, 40), f"TEST {RUN}", fill="black")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _make_slip_image() -> bytes:
    """Synthetic weighment slip (same pattern as iter9) — NET 10000 kg."""
    from PIL import Image, ImageDraw
    img = Image.new("RGB", (800, 480), "white")
    d = ImageDraw.Draw(img)
    d.rectangle([10, 10, 790, 470], outline="black", width=3)
    lines = [
        "HEMANT ENTERPRISE WEIGHBRIDGE",
        "SLIP NO: 4521        DATE: 10/01/2026",
        f"VEHICLE NO: MH{RUN[:2]}AB1234",
        "MATERIAL: STEEL PLATES",
        "GROSS WEIGHT: 24500 KG",
        "TARE WEIGHT:  14500 KG",
        "NET WEIGHT:   10000 KG",
    ]
    y = 40
    for ln in lines:
        d.text((40, y), ln, fill="black")
        y += 55
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _make_wav_tone(seconds: float = 1.5) -> bytes:
    """Valid WAV (440 Hz tone) — passes size/format guards; no speech content."""
    import math
    rate = 16000
    n = int(rate * seconds)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        frames = b"".join(
            struct.pack("<h", int(12000 * math.sin(2 * math.pi * 440 * i / rate)))
            for i in range(n)
        )
        w.writeframes(frames)
    return buf.getvalue()


# ========== /api/upload/base64 ==========
class TestUploadBase64:
    """POST /api/upload/base64 — native JSON upload path"""

    def test_valid_png_base64_returns_path(self, api_client, labour_auth):
        png = _png_bytes()
        payload = {
            "filename": f"TEST_it13_{RUN}.png",
            "content_base64": base64.b64encode(png).decode(),
        }
        r = api_client.post(f"{BASE_URL}/api/upload/base64", json=payload, headers=_h(labour_auth))
        assert r.status_code == 200, r.text
        data = r.json()
        assert "path" in data and data["path"].endswith(".png")
        assert data.get("size", 0) > 0

    def test_uploaded_file_retrievable_via_files_endpoint(self, api_client, labour_auth):
        png = _png_bytes()
        r = api_client.post(
            f"{BASE_URL}/api/upload/base64",
            json={"filename": f"TEST_it13_get_{RUN}.png", "content_base64": base64.b64encode(png).decode()},
            headers=_h(labour_auth),
        )
        assert r.status_code == 200, r.text
        path = r.json()["path"]
        # GET with ?token= (same pattern the app uses via fileUrl())
        r2 = api_client.get(f"{BASE_URL}/api/files/{path}?token={labour_auth['token']}", timeout=30)
        assert r2.status_code == 200, r2.text
        assert len(r2.content) == len(png)

    def test_invalid_base64_returns_400(self, api_client, labour_auth):
        r = api_client.post(
            f"{BASE_URL}/api/upload/base64",
            json={"filename": "TEST_bad.png", "content_base64": "not-valid-base64!!"},
            headers=_h(labour_auth),
        )
        assert r.status_code == 400, r.text

    def test_empty_file_returns_400(self, api_client, labour_auth):
        r = api_client.post(
            f"{BASE_URL}/api/upload/base64",
            json={"filename": "TEST_empty.png", "content_base64": ""},
            headers=_h(labour_auth),
        )
        assert r.status_code == 400, r.text
        assert "Empty" in r.json().get("detail", "")

    def test_no_auth_returns_401_or_403(self, api_client):
        r = api_client.post(
            f"{BASE_URL}/api/upload/base64",
            json={"filename": "x.png", "content_base64": base64.b64encode(b"123").decode()},
        )
        assert r.status_code in (401, 403), r.text


# ========== /api/vision/weight/path ==========
class TestVisionWeightPath:
    """POST /api/vision/weight/path — JSON variant of vision OCR"""

    def _upload_slip(self, api_client, auth) -> str:
        img = _make_slip_image()
        r = api_client.post(
            f"{BASE_URL}/api/upload/base64",
            json={"filename": f"TEST_slip_it13_{RUN}.png", "content_base64": base64.b64encode(img).decode()},
            headers=_h(auth),
        )
        assert r.status_code == 200, r.text
        return r.json()["path"]

    def test_valid_slip_path_returns_weight_and_vehicle(self, api_client, labour_auth):
        path = self._upload_slip(api_client, labour_auth)
        r = api_client.post(
            f"{BASE_URL}/api/vision/weight/path",
            json={"slip_photo_path": path},
            headers=_h(labour_auth),
            timeout=180,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        for f in ("weight_kg", "vehicle_number", "confidence", "raw"):
            assert f in data, f"missing {f}"
        assert data["weight_kg"] is not None, f"OCR missed weight: {data}"
        assert abs(float(data["weight_kg"]) - 10000) <= 500, f"OCR weight off: {data}"
        got = (data.get("vehicle_number") or "").replace(" ", "").replace("-", "").upper()
        assert got.startswith("MH") and "AB1234" in got, f"OCR vehicle mismatch: {data}"

    def test_labour_reading_other_users_path_403(self, api_client, labour_auth, office_auth):
        # Office uploads a slip; labour tries to OCR it by path -> 403
        path = self._upload_slip(api_client, office_auth)
        r = api_client.post(
            f"{BASE_URL}/api/vision/weight/path",
            json={"slip_photo_path": path},
            headers=_h(labour_auth),
        )
        assert r.status_code == 403, r.text

    def test_nonexistent_path_404(self, api_client, labour_auth):
        r = api_client.post(
            f"{BASE_URL}/api/vision/weight/path",
            json={"slip_photo_path": f"/nonexistent/TEST_it13_{RUN}.jpg"},
            headers=_h(labour_auth),
        )
        assert r.status_code == 404, r.text

    def test_no_auth_401_or_403(self, api_client):
        r = api_client.post(
            f"{BASE_URL}/api/vision/weight/path",
            json={"slip_photo_path": "/x/y.png"},
        )
        assert r.status_code in (401, 403), r.text


# ========== /api/voice/transcribe/base64 ==========
class TestVoiceTranscribeBase64:
    """POST /api/voice/transcribe/base64 — JSON variant of voice transcription"""

    def test_tiny_payload_400_audio_too_short(self, api_client, labour_auth):
        r = api_client.post(
            f"{BASE_URL}/api/voice/transcribe/base64",
            json={"filename": "t.m4a", "content_base64": base64.b64encode(b"tiny").decode()},
            headers=_h(labour_auth),
        )
        assert r.status_code == 400, r.text
        assert "too short" in r.json().get("detail", "").lower()

    def test_invalid_base64_400(self, api_client, labour_auth):
        r = api_client.post(
            f"{BASE_URL}/api/voice/transcribe/base64",
            json={"filename": "t.m4a", "content_base64": "!!not-base64!!"},
            headers=_h(labour_auth),
        )
        assert r.status_code == 400, r.text

    def test_valid_audio_reaches_stt(self, api_client, labour_auth):
        """Valid WAV (tone, no speech): 200 with numbers, or 422 'no speech'.
        Either proves base64 decode + STT pipeline executed end-to-end."""
        wav = _make_wav_tone()
        r = api_client.post(
            f"{BASE_URL}/api/voice/transcribe/base64",
            json={"filename": f"TEST_tone_{RUN}.wav", "content_base64": base64.b64encode(wav).decode()},
            headers=_h(labour_auth),
            timeout=120,
        )
        assert r.status_code in (200, 422), f"unexpected status: {r.status_code} {r.text}"
        if r.status_code == 200:
            data = r.json()
            assert "text" in data and "numbers" in data
        else:
            assert "No audible" in r.json().get("detail", "")

    def test_no_auth_401_or_403(self, api_client):
        r = api_client.post(
            f"{BASE_URL}/api/voice/transcribe/base64",
            json={"filename": "t.m4a", "content_base64": base64.b64encode(b"1234").decode()},
        )
        assert r.status_code in (401, 403), r.text
