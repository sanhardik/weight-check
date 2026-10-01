"""
Iteration 9 feature tests — SteelTrack / Hemant Enterprise
Coverage:
  - POST /api/vision/weight contract (400 no-input, 404 missing path) + vehicle_number in response
  - Real vision OCR on a generated weighment slip image (weight + vehicle extraction)
  - Inward entry slip cross-check: match -> no flag; mismatch (vehicle + weight >0.35%) -> flagged
  - Vehicle plate normalization (spaces/case ignored)
  - PATCH /api/entries/{id}/correction recomputes + clears slip_mismatch_flag, history logged
  - Outward entry slip mismatch flow
  - GET /api/entries and /api/entries/{id} expose slip_* fields

NOTE: pytest runs with xdist (--dist loadscope) — every test class is fully
self-contained (creates its own entries); no cross-class state sharing.
"""
import io
import os
import uuid

import pytest
import requests
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / "frontend" / ".env")
BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")

RUN = uuid.uuid4().hex[:6].upper()


def _h(auth):
    return {"Authorization": f"Bearer {auth['token']}", "Content-Type": "application/json"}


def _line_items():
    return [{"thickness_mm": 10, "width_mm": 1250, "length_mm": 2500, "pieces": 5,
             "grade": f"TEST_IT9-{RUN}"}]


def _inward_payload(**over):
    body = {
        "line_items": _line_items(),
        "vehicle_number": f"MH{RUN[:2]}AB1234",
        "driver_name": "TEST Driver",
        "mukadam_name": "TEST Mukadam",
        "actual_weight_kg": 10000,
        "remarks": f"TEST_IT9 {RUN}",
    }
    body.update(over)
    return body


def _create_mismatched_inward(api_client, auth):
    body = _inward_payload(
        vehicle_number=f"MH{RUN[:2]}XY9999",          # entered
        slip_ocr_vehicle_number=f"MH{RUN[:2]}AB1234",  # on slip
        actual_weight_kg=10500,                        # 5% off
        slip_ocr_weight_kg=10000,
    )
    r = api_client.post(f"{BASE_URL}/api/entries/inward", json=body, headers=_h(auth))
    assert r.status_code in (200, 201), r.text
    return r.json()


def _make_slip_image() -> bytes:
    """Generate a realistic-looking weighment slip image (PNG)."""
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


# ========== VISION CONTRACT ==========
class TestVisionContract:
    """POST /api/vision/weight — error contract + response shape incl. vehicle_number"""

    def test_no_file_no_path_returns_400(self, api_client, labour_auth):
        r = api_client.post(f"{BASE_URL}/api/vision/weight", headers=_h(labour_auth))
        assert r.status_code == 400, r.text
        assert "Provide file" in r.json().get("detail", "")

    def test_missing_slip_photo_path_returns_404(self, labour_auth):
        # plain requests (no JSON content-type) so multipart form parses
        r = requests.post(
            f"{BASE_URL}/api/vision/weight",
            data={"slip_photo_path": f"/nonexistent/TEST_{RUN}.jpg"},
            headers={"Authorization": f"Bearer {labour_auth['token']}"},
            timeout=30,
        )
        assert r.status_code == 404, r.text

    def test_vision_requires_auth(self, api_client):
        r = api_client.post(f"{BASE_URL}/api/vision/weight")
        assert r.status_code in (401, 403), r.text

    def test_real_slip_image_extracts_weight_and_vehicle(self, labour_auth):
        """End-to-end: real OpenAI vision reads NET weight + vehicle from generated slip."""
        img = _make_slip_image()
        assert len(img) > 500
        r = requests.post(
            f"{BASE_URL}/api/vision/weight",
            files={"file": (f"TEST_slip_{RUN}.png", img, "image/png")},
            headers={"Authorization": f"Bearer {labour_auth['token']}"},
            timeout=180,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        # Contract: response includes vehicle_number field
        assert "vehicle_number" in data
        assert "weight_kg" in data
        assert "confidence" in data
        # OCR quality assertions (slip text is crisp, model should read it)
        assert data["weight_kg"] is not None, f"OCR missed weight: {data}"
        assert abs(float(data["weight_kg"]) - 10000) <= 500, f"OCR weight off: {data}"
        expected_plate = f"MH{RUN[:2]}AB1234"
        got = (data.get("vehicle_number") or "").replace(" ", "").replace("-", "").upper()
        assert got == expected_plate, f"OCR vehicle mismatch: {data}"


# ========== INWARD SLIP MISMATCH ==========
class TestInwardSlipMatch:
    """Inward entry where OCR slip values match entered values -> not flagged"""

    def test_match_creates_clean_entry(self, api_client, labour_auth):
        body = _inward_payload(
            slip_ocr_weight_kg=10010,  # 0.1% diff < 0.35% tolerance
            slip_ocr_vehicle_number=f"MH {RUN[:2]} AB 1234",  # spaced — should normalise
        )
        r = api_client.post(f"{BASE_URL}/api/entries/inward", json=body, headers=_h(labour_auth))
        assert r.status_code in (200, 201), r.text
        e = r.json()
        assert e["slip_mismatch_flag"] is False
        assert e["slip_mismatch_details"] == []
        assert e["slip_ocr_weight_kg"] == 10010
        assert e["slip_ocr_vehicle_number"] == f"MH {RUN[:2]} AB 1234"

    def test_lowercase_plate_normalises(self, api_client, labour_auth):
        body = _inward_payload(
            vehicle_number=f"mh{RUN[:2]}ab1234",
            slip_ocr_vehicle_number=f"MH{RUN[:2]}AB1234",
            slip_ocr_weight_kg=10000,
        )
        r = api_client.post(f"{BASE_URL}/api/entries/inward", json=body, headers=_h(labour_auth))
        assert r.status_code in (200, 201), r.text
        assert r.json()["slip_mismatch_flag"] is False

    def test_no_ocr_values_not_flagged(self, api_client, labour_auth):
        r = api_client.post(f"{BASE_URL}/api/entries/inward", json=_inward_payload(), headers=_h(labour_auth))
        assert r.status_code in (200, 201), r.text
        assert r.json()["slip_mismatch_flag"] is False


class TestInwardSlipMismatch:
    """Inward entry where OCR slip values disagree with entered values -> auto-flagged"""

    def test_vehicle_and_weight_mismatch_flagged_with_two_details(self, api_client, labour_auth):
        e = _create_mismatched_inward(api_client, labour_auth)
        assert e["slip_mismatch_flag"] is True
        details = e["slip_mismatch_details"]
        assert isinstance(details, list) and len(details) == 2, details
        joined = " | ".join(details)
        assert "Vehicle differs from slip" in joined
        assert "Weight differs from slip" in joined
        assert f"MH{RUN[:2]}AB1234" in joined and f"MH{RUN[:2]}XY9999" in joined

    def test_fields_present_in_get_entry(self, api_client, labour_auth):
        entry_id = _create_mismatched_inward(api_client, labour_auth)["id"]
        r = api_client.get(f"{BASE_URL}/api/entries/{entry_id}", headers=_h(labour_auth))
        assert r.status_code == 200, r.text
        e = r.json()
        for f in ("slip_ocr_weight_kg", "slip_ocr_vehicle_number", "slip_mismatch_flag", "slip_mismatch_details"):
            assert f in e, f"missing {f}"
        assert e["slip_mismatch_flag"] is True
        assert e["slip_ocr_weight_kg"] == 10000

    def test_fields_present_in_entries_list(self, api_client, labour_auth, admin_auth):
        entry_id = _create_mismatched_inward(api_client, labour_auth)["id"]
        r = api_client.get(f"{BASE_URL}/api/entries", headers=_h(admin_auth))
        assert r.status_code == 200, r.text
        entries = r.json()
        assert isinstance(entries, list)
        match = [x for x in entries if x["id"] == entry_id]
        assert match, "flagged entry not in list"
        e = match[0]
        for f in ("slip_ocr_weight_kg", "slip_ocr_vehicle_number", "slip_mismatch_flag", "slip_mismatch_details"):
            assert f in e, f"missing {f} in list payload"
        assert e["slip_mismatch_flag"] is True

    def test_weight_only_mismatch_single_detail(self, api_client, labour_auth):
        body = _inward_payload(slip_ocr_weight_kg=10300, slip_ocr_vehicle_number=f"MH{RUN[:2]}AB1234")
        r = api_client.post(f"{BASE_URL}/api/entries/inward", json=body, headers=_h(labour_auth))
        assert r.status_code in (200, 201), r.text
        e = r.json()
        assert e["slip_mismatch_flag"] is True
        assert len(e["slip_mismatch_details"]) == 1
        assert "Weight differs" in e["slip_mismatch_details"][0]


# ========== CORRECTION CLEARS FLAG ==========
class TestSlipCorrection:
    """Office/admin PATCH correction recomputes slip mismatch; fixing values clears flag"""

    def test_labour_cannot_correct(self, api_client, labour_auth):
        entry_id = _create_mismatched_inward(api_client, labour_auth)["id"]
        r = api_client.patch(
            f"{BASE_URL}/api/entries/{entry_id}/correction",
            json={"actual_weight_kg": 10000},
            headers=_h(labour_auth),
        )
        assert r.status_code in (401, 403), r.text

    def test_correction_clears_flag_and_logs_history(self, api_client, labour_auth, office_auth):
        entry_id = _create_mismatched_inward(api_client, labour_auth)["id"]
        r = api_client.patch(
            f"{BASE_URL}/api/entries/{entry_id}/correction",
            json={"actual_weight_kg": 10000, "vehicle_number": f"MH {RUN[:2]} AB 1234"},
            headers=_h(office_auth),
        )
        assert r.status_code == 200, r.text
        e = r.json()
        assert e["slip_mismatch_flag"] is False
        assert e["slip_mismatch_details"] == []
        # History logs the correction with role + fields
        hist = e.get("history", [])
        fields_changed = {c.get("field") for c in hist}
        assert "actual_weight_kg" in fields_changed and "vehicle_number" in fields_changed
        corr = [c for c in hist if c.get("field") == "vehicle_number"][-1]
        assert corr.get("by_role") == "office"
        assert corr.get("by_name")

    def test_flag_persists_cleared_in_get(self, api_client, labour_auth, office_auth, admin_auth):
        entry_id = _create_mismatched_inward(api_client, labour_auth)["id"]
        api_client.patch(
            f"{BASE_URL}/api/entries/{entry_id}/correction",
            json={"actual_weight_kg": 10000, "vehicle_number": f"MH{RUN[:2]}AB1234"},
            headers=_h(office_auth),
        )
        r = api_client.get(f"{BASE_URL}/api/entries/{entry_id}", headers=_h(admin_auth))
        assert r.status_code == 200, r.text
        e = r.json()
        assert e["slip_mismatch_flag"] is False
        assert e["slip_mismatch_details"] == []

    def test_correction_still_mismatched_keeps_flag(self, api_client, labour_auth, office_auth):
        body = _inward_payload(
            vehicle_number=f"GJ{RUN[:2]}ZZ0001",
            slip_ocr_vehicle_number=f"MH{RUN[:2]}AB1234",
            slip_ocr_weight_kg=10000,
        )
        r = api_client.post(f"{BASE_URL}/api/entries/inward", json=body, headers=_h(labour_auth))
        assert r.status_code in (200, 201), r.text
        entry_id = r.json()["id"]
        assert r.json()["slip_mismatch_flag"] is True
        # Fix weight only — vehicle still wrong -> flag stays
        r2 = api_client.patch(
            f"{BASE_URL}/api/entries/{entry_id}/correction",
            json={"actual_weight_kg": 10005},
            headers=_h(office_auth),
        )
        assert r2.status_code == 200, r2.text
        assert r2.json()["slip_mismatch_flag"] is True
        assert any("Vehicle differs" in d for d in r2.json()["slip_mismatch_details"])


# ========== OUTWARD SLIP MISMATCH ==========
class TestOutwardSlipMismatch:
    """Same mismatch cross-check applies on outward entries"""

    def test_outward_mismatch_flagged(self, api_client, labour_auth):
        # Seed stock first (inward, clean)
        inv = api_client.post(
            f"{BASE_URL}/api/entries/inward",
            json=_inward_payload(actual_weight_kg=None),
            headers=_h(labour_auth),
        )
        assert inv.status_code in (200, 201), inv.text
        out_body = {
            "line_items": [{"thickness_mm": 10, "width_mm": 1250, "length_mm": 2500, "pieces": 2,
                            "grade": f"TEST_IT9-{RUN}"}],
            "vehicle_number": f"KA{RUN[:2]}CD7777",          # entered
            "broker_name": f"TEST_BROKER_{RUN}",
            "actual_weight_kg": 4000,
            "slip_ocr_weight_kg": 3900,                        # ~2.6% diff
            "slip_ocr_vehicle_number": f"KA {RUN[:2]} CD 7777",  # normalised match
            "remarks": f"TEST_IT9 outward {RUN}",
        }
        r = api_client.post(f"{BASE_URL}/api/entries/outward", json=out_body, headers=_h(labour_auth))
        assert r.status_code in (200, 201), r.text
        e = r.json()
        assert e["slip_mismatch_flag"] is True
        assert len(e["slip_mismatch_details"]) == 1
        assert "Weight differs" in e["slip_mismatch_details"][0]

    def test_outward_match_clean(self, api_client, labour_auth):
        # Seed stock first
        inv = api_client.post(
            f"{BASE_URL}/api/entries/inward",
            json=_inward_payload(actual_weight_kg=None),
            headers=_h(labour_auth),
        )
        assert inv.status_code in (200, 201), inv.text
        out_body = {
            "line_items": [{"thickness_mm": 10, "width_mm": 1250, "length_mm": 2500, "pieces": 1,
                            "grade": f"TEST_IT9-{RUN}"}],
            "vehicle_number": f"KA{RUN[:2]}CD7777",
            "broker_name": f"TEST_BROKER_{RUN}",
            "actual_weight_kg": 2000,
            "slip_ocr_weight_kg": 2005,
            "slip_ocr_vehicle_number": f"KA{RUN[:2]}CD7777",
            "remarks": f"TEST_IT9 outward clean {RUN}",
        }
        r = api_client.post(f"{BASE_URL}/api/entries/outward", json=out_body, headers=_h(labour_auth))
        assert r.status_code in (200, 201), r.text
        e = r.json()
        assert e["slip_mismatch_flag"] is False
        assert e["slip_mismatch_details"] == []
