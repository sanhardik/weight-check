"""Iter 7 regression tests:
- Voice transcribe error paths and basic 200/422 path with tiny WAV
- Variance threshold tightened to 0.35%
- mukadam_name field passthrough on inward/outward
- Mukadams CRUD (seed + idempotent add + delete, role-gated)
- Brokers CRUD (seed + role-gated)
- Outward FIFO auto-match of source_entry_id
- Outward with explicit source_entry_id preserved
"""
import io
import os
import struct
import uuid
import math
import time
import pytest
import requests
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / "frontend" / ".env")
BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


def _build_wav(duration_sec=1.0, sample_rate=16000, freq=440.0, amplitude=0.1):
    n_samples = int(duration_sec * sample_rate)
    pcm = io.BytesIO()
    for i in range(n_samples):
        v = int(amplitude * 32767 * math.sin(2 * math.pi * freq * i / sample_rate))
        pcm.write(struct.pack("<h", v))
    data = pcm.getvalue()
    bits = 16
    channels = 1
    byte_rate = sample_rate * channels * bits // 8
    block_align = channels * bits // 8
    header = b"RIFF" + struct.pack("<I", 36 + len(data)) + b"WAVE"
    header += b"fmt " + struct.pack("<IHHIIHH", 16, 1, channels, sample_rate, byte_rate, block_align, bits)
    header += b"data" + struct.pack("<I", len(data))
    return header + data


# ========== Voice endpoint regression ==========
class TestVoiceEndpoint:
    def test_voice_requires_auth(self):
        r = requests.post(f"{BASE_URL}/api/voice/transcribe", timeout=15)
        assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}: {r.text[:200]}"

    def test_voice_no_file(self, labour_auth):
        r = requests.post(
            f"{BASE_URL}/api/voice/transcribe",
            headers=_h(labour_auth["token"]),
            timeout=15,
        )
        assert r.status_code in (400, 422), f"expected 400/422, got {r.status_code}: {r.text[:200]}"

    def test_voice_too_short(self, labour_auth):
        tiny = b"\x00" * 500
        r = requests.post(
            f"{BASE_URL}/api/voice/transcribe",
            headers=_h(labour_auth["token"]),
            files={"file": ("a.wav", tiny, "audio/wav")},
            timeout=15,
        )
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text[:200]}"
        assert "short" in r.json().get("detail", "").lower()

    def test_voice_too_large(self, labour_auth):
        big = b"\x00" * (26 * 1024 * 1024)
        r = requests.post(
            f"{BASE_URL}/api/voice/transcribe",
            headers=_h(labour_auth["token"]),
            files={"file": ("a.wav", big, "audio/wav")},
            timeout=60,
        )
        assert r.status_code == 413, f"expected 413, got {r.status_code}: {r.text[:200]}"

    def test_voice_valid_wav_returns_clean_response(self, labour_auth):
        """A tiny real WAV should produce 200 (with numbers list) OR 422 (no numbers detected)
        OR 502 with a readable detail — never a silent 500/empty response."""
        wav = _build_wav(duration_sec=1.5, freq=220.0)
        r = requests.post(
            f"{BASE_URL}/api/voice/transcribe",
            headers=_h(labour_auth["token"]),
            files={"file": ("a.wav", wav, "audio/wav")},
            timeout=60,
        )
        assert r.status_code in (200, 422, 502), f"unexpected {r.status_code}: {r.text[:300]}"
        body = r.json()
        assert "detail" in body or "text" in body, f"empty body: {body}"
        if r.status_code == 200:
            assert isinstance(body.get("text"), str)
            assert isinstance(body.get("numbers"), list)
        else:
            # Error path must have a readable detail (not just "Transcription failed:")
            detail = body.get("detail", "")
            assert isinstance(detail, str) and len(detail) > 5, f"vague detail: {detail!r}"


# ========== Variance threshold 0.35% ==========
class TestVarianceThreshold:
    def _make(self, token, actual):
        payload = {
            "thickness_mm": 10, "width_mm": 1250, "length_mm": 2500,
            "pieces": 1, "vehicle_number": "VAR-TST",
            "actual_weight_kg": actual,
        }
        r = requests.post(f"{BASE_URL}/api/entries/inward", headers=_h(token), json=payload, timeout=30)
        assert r.status_code == 200, r.text
        return r.json()

    def test_theoretical_weight(self, admin_auth):
        # 10*1250*2500*1*7.85e-6 = 245.3125 kg
        e = self._make(admin_auth["token"], 245.3125)
        assert abs(e["theoretical_weight_kg"] - 245.3125) < 0.01
        assert e["variance_flagged"] is False

    def test_below_threshold_not_flagged(self, admin_auth):
        # ~0.3% deviation
        actual = 245.3125 * (1 + 0.003)
        e = self._make(admin_auth["token"], round(actual, 3))
        assert e["variance_pct"] is not None and e["variance_pct"] < 0.35
        assert e["variance_flagged"] is False, f"should not flag at {e['variance_pct']}%"

    def test_above_threshold_flagged(self, admin_auth):
        # ~0.4%
        actual = 245.3125 * (1 + 0.004)
        e = self._make(admin_auth["token"], round(actual, 3))
        assert e["variance_pct"] is not None and e["variance_pct"] > 0.35
        assert e["variance_flagged"] is True

    def test_boundary_exactly_at_threshold_not_flagged(self, admin_auth):
        # strictly > threshold flags; equal must not flag
        th = 245.3125
        actual = round(th * (1 + 0.0035), 4)
        e = self._make(admin_auth["token"], actual)
        # Could be 0.35 due to rounding; verify logic: only flag if > 0.35
        if e["variance_pct"] == 0.35:
            assert e["variance_flagged"] is False
        else:
            # if slightly above or below due to rounding, correctness still holds
            assert e["variance_flagged"] is (e["variance_pct"] > 0.35)


# ========== Mukadam field passthrough ==========
class TestMukadamField:
    def test_mukadam_name_on_inward(self, labour_auth):
        payload = {
            "thickness_mm": 8, "width_mm": 1000, "length_mm": 2000,
            "pieces": 2, "vehicle_number": "MK-IN",
            "mukadam_name": "Ravi Patil",
        }
        r = requests.post(f"{BASE_URL}/api/entries/inward", headers=_h(labour_auth["token"]), json=payload, timeout=30)
        assert r.status_code == 200, r.text
        e = r.json()
        assert e["mukadam_name"] == "Ravi Patil"
        # Verify persistence
        g = requests.get(f"{BASE_URL}/api/entries/{e['id']}", headers=_h(labour_auth["token"]), timeout=15)
        assert g.status_code == 200 and g.json()["mukadam_name"] == "Ravi Patil"

    def test_mukadam_name_on_outward(self, labour_auth):
        # Seed inward
        inw = requests.post(
            f"{BASE_URL}/api/entries/inward", headers=_h(labour_auth["token"]),
            json={"thickness_mm": 8, "width_mm": 1000, "length_mm": 2000, "pieces": 5, "vehicle_number": "MK-SEED"},
            timeout=30,
        )
        assert inw.status_code == 200
        out = requests.post(
            f"{BASE_URL}/api/entries/outward", headers=_h(labour_auth["token"]),
            json={
                "thickness_mm": 8, "width_mm": 1000, "length_mm": 2000, "pieces": 1,
                "vehicle_number": "MK-OUT", "broker_name": "Shah Brothers",
                "mukadam_name": "Suresh Kadam",
            },
            timeout=30,
        )
        assert out.status_code == 200, out.text
        assert out.json()["mukadam_name"] == "Suresh Kadam"


# ========== Mukadams CRUD ==========
class TestMukadamsCRUD:
    def test_list_seeded(self, labour_auth):
        r = requests.get(f"{BASE_URL}/api/mukadams", headers=_h(labour_auth["token"]), timeout=15)
        assert r.status_code == 200, r.text
        names = [m["name"] for m in r.json()]
        for n in ["Ravi Patil", "Suresh Kadam", "Kiran Mane", "Mahesh Jadhav"]:
            assert n in names, f"missing seeded mukadam: {n}"
        # Order of first 4 should match
        assert names[:4] == ["Ravi Patil", "Suresh Kadam", "Kiran Mane", "Mahesh Jadhav"]

    def test_add_mukadam_admin(self, admin_auth):
        r = requests.post(
            f"{BASE_URL}/api/mukadams", headers=_h(admin_auth["token"]),
            json={"name": "TEST_Mukadam_Iter7"}, timeout=15,
        )
        assert r.status_code == 200
        assert r.json()["name"] == "TEST_Mukadam_Iter7"
        # Idempotent — second call does not error
        r2 = requests.post(
            f"{BASE_URL}/api/mukadams", headers=_h(admin_auth["token"]),
            json={"name": "TEST_Mukadam_Iter7"}, timeout=15,
        )
        assert r2.status_code == 200

    def test_add_mukadam_labour_forbidden(self, labour_auth):
        r = requests.post(
            f"{BASE_URL}/api/mukadams", headers=_h(labour_auth["token"]),
            json={"name": "TEST_Hack"}, timeout=15,
        )
        assert r.status_code == 403

    def test_delete_mukadam(self, admin_auth, labour_auth):
        # Clean up prior test (works even if independent order)
        requests.post(
            f"{BASE_URL}/api/mukadams", headers=_h(admin_auth["token"]),
            json={"name": "TEST_Delete_Me"}, timeout=15,
        )
        # labour forbidden
        rf = requests.delete(f"{BASE_URL}/api/mukadams/TEST_Delete_Me", headers=_h(labour_auth["token"]), timeout=15)
        assert rf.status_code == 403
        # admin ok
        r = requests.delete(f"{BASE_URL}/api/mukadams/TEST_Delete_Me", headers=_h(admin_auth["token"]), timeout=15)
        assert r.status_code == 200
        # Verify removed
        g = requests.get(f"{BASE_URL}/api/mukadams", headers=_h(admin_auth["token"]), timeout=15)
        assert "TEST_Delete_Me" not in [m["name"] for m in g.json()]
        # Also clean up TEST_Mukadam_Iter7
        requests.delete(f"{BASE_URL}/api/mukadams/TEST_Mukadam_Iter7", headers=_h(admin_auth["token"]), timeout=15)


# ========== Brokers CRUD ==========
class TestBrokersCRUD:
    def test_list_seeded(self, labour_auth):
        r = requests.get(f"{BASE_URL}/api/brokers", headers=_h(labour_auth["token"]), timeout=15)
        assert r.status_code == 200
        names = [b["name"] for b in r.json()]
        for n in ["Shah Brothers", "Patel Trading Co.", "Metro Steel Agency", "Mehta & Sons"]:
            assert n in names, f"missing seeded broker: {n}"

    def test_add_broker_labour_forbidden(self, labour_auth):
        r = requests.post(
            f"{BASE_URL}/api/brokers", headers=_h(labour_auth["token"]),
            json={"name": "TEST_Broker_Hack"}, timeout=15,
        )
        assert r.status_code == 403

    def test_add_delete_broker_admin(self, admin_auth):
        r = requests.post(
            f"{BASE_URL}/api/brokers", headers=_h(admin_auth["token"]),
            json={"name": "TEST_Broker_Iter7"}, timeout=15,
        )
        assert r.status_code == 200
        d = requests.delete(f"{BASE_URL}/api/brokers/TEST_Broker_Iter7", headers=_h(admin_auth["token"]), timeout=15)
        assert d.status_code == 200


# ========== Outward FIFO auto-match ==========
class TestOutwardFIFO:
    # Unique grade per run so inwards from prior runs cannot win the FIFO race
    DIM = {"thickness_mm": 12.0, "width_mm": 1234.0, "length_mm": 3456.0, "grade": f"FIFO-GRD-{uuid.uuid4().hex[:8]}"}

    def _inward(self, token, pieces=3):
        body = {**self.DIM, "pieces": pieces, "vehicle_number": "FIFO-IN"}
        r = requests.post(f"{BASE_URL}/api/entries/inward", headers=_h(token), json=body, timeout=30)
        assert r.status_code == 200, r.text
        return r.json()

    def test_fifo_matches_oldest(self, admin_auth):
        a = self._inward(admin_auth["token"], 3)
        time.sleep(1.2)
        b = self._inward(admin_auth["token"], 3)
        assert a["id"] != b["id"]
        # Outward WITHOUT source_entry_id
        out = requests.post(
            f"{BASE_URL}/api/entries/outward", headers=_h(admin_auth["token"]),
            json={**self.DIM, "pieces": 1, "vehicle_number": "FIFO-OUT", "broker_name": "Shah Brothers"},
            timeout=30,
        )
        assert out.status_code == 200, out.text
        assert out.json()["source_entry_id"] == a["id"], (
            f"FIFO should match oldest {a['id']}, got {out.json()['source_entry_id']}"
        )

    def test_explicit_source_entry_id_preserved(self, admin_auth):
        # Grade different to avoid interference
        dim = {"thickness_mm": 14.0, "width_mm": 999.0, "length_mm": 2222.0, "grade": f"FIFO-GRD-{uuid.uuid4().hex[:8]}"}
        a = requests.post(
            f"{BASE_URL}/api/entries/inward", headers=_h(admin_auth["token"]),
            json={**dim, "pieces": 5, "vehicle_number": "SRC-A"}, timeout=30,
        ).json()
        time.sleep(1.1)
        b = requests.post(
            f"{BASE_URL}/api/entries/inward", headers=_h(admin_auth["token"]),
            json={**dim, "pieces": 5, "vehicle_number": "SRC-B"}, timeout=30,
        ).json()
        out = requests.post(
            f"{BASE_URL}/api/entries/outward", headers=_h(admin_auth["token"]),
            json={**dim, "pieces": 1, "vehicle_number": "SRC-OUT",
                  "broker_name": "Shah Brothers", "source_entry_id": b["id"]},
            timeout=30,
        )
        assert out.status_code == 200, out.text
        assert out.json()["source_entry_id"] == b["id"], (
            f"explicit source must be preserved, got {out.json()['source_entry_id']} expected {b['id']}"
        )


# ========== Auth still works (app rename regression) ==========
class TestAuthStillWorks:
    def test_login_admin(self, admin_auth):
        assert "token" in admin_auth and admin_auth["user"]["role"] == "admin"

    def test_me(self, admin_auth):
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=_h(admin_auth["token"]), timeout=15)
        assert r.status_code == 200
        assert r.json()["email"] == "admin@steeltrack.com"
