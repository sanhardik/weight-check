"""
Iteration 12 feature tests — SteelTrack / Hemant Enterprise
Coverage: POST /api/entries/{id}/slip — post-hoc weighment slip attach
  - Happy path: labour creates entry w/o slip, uploads slip image, attaches -> 200,
    slip_photo_path set, OCR fields populated, history logs slip_photo_path
  - Mismatch recompute: OCR weight/vehicle differ from entry -> flag=True (+details);
    matching values -> flag=False
  - Labour re-attach to entry WITH slip -> 400; office/admin replace -> 200
  - Labour attaching ANOTHER user's upload -> 403; nonexistent upload -> 404;
    nonexistent entry -> 404; no auth -> 401/403
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


def _bearer(auth):
    return {"Authorization": f"Bearer {auth['token']}"}


def _make_slip_image(weight_kg: int, vehicle: str) -> bytes:
    """Generate a realistic weighment slip image (PNG) readable by vision OCR."""
    from PIL import Image, ImageDraw
    img = Image.new("RGB", (800, 480), "white")
    d = ImageDraw.Draw(img)
    d.rectangle([10, 10, 790, 470], outline="black", width=3)
    lines = [
        "HEMANT ENTERPRISE WEIGHBRIDGE",
        "SLIP NO: 4521        DATE: 10/01/2026",
        f"VEHICLE NO: {vehicle}",
        "MATERIAL: STEEL PLATES",
        f"GROSS WEIGHT: {weight_kg + 14500} KG",
        "TARE WEIGHT:  14500 KG",
        f"NET WEIGHT:   {weight_kg} KG",
    ]
    y = 40
    for ln in lines:
        d.text((40, y), ln, fill="black")
        y += 55
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _upload(auth, img: bytes, name: str) -> str:
    r = requests.post(
        f"{BASE_URL}/api/upload",
        files={"file": (name, img, "image/png")},
        headers=_bearer(auth),
        timeout=60,
    )
    assert r.status_code == 200, r.text
    return r.json()["path"]


def _create_inward(api_client, auth, **over):
    body = {
        "line_items": [{"thickness_mm": 10, "width_mm": 1250, "length_mm": 2500,
                        "pieces": 5, "grade": f"TEST_IT12-{RUN}"}],
        "vehicle_number": f"MH{RUN[:2]}AB1234",
        "driver_name": "TEST Driver",
        "mukadam_name": "TEST Mukadam",
        "actual_weight_kg": 10000,
        "remarks": f"TEST_IT12 {RUN}",
    }
    body.update(over)
    r = api_client.post(f"{BASE_URL}/api/entries/inward", json=body, headers=_h(auth))
    assert r.status_code in (200, 201), r.text
    return r.json()


def _attach(api_client, auth, entry_id, path):
    return api_client.post(
        f"{BASE_URL}/api/entries/{entry_id}/slip",
        json={"slip_photo_path": path},
        headers=_h(auth),
        timeout=180,
    )


# ========== HAPPY PATH ==========
class TestSlipAttachHappyPath:
    """Labour attaches slip to own slip-less entry -> 200, OCR read, history logged"""

    def test_labour_attach_success_ocr_and_history(self, api_client, labour_auth):
        vehicle = f"MH{RUN[:2]}AB1234"
        e = _create_inward(api_client, labour_auth, vehicle_number=vehicle, actual_weight_kg=10000)
        assert e["slip_photo_path"] in (None, ""), "entry must start without slip"

        path = _upload(labour_auth, _make_slip_image(10000, vehicle), f"TEST_slip12_{RUN}.png")
        r = _attach(api_client, labour_auth, e["id"], path)
        assert r.status_code == 200, r.text
        out = r.json()
        assert out["slip_photo_path"] == path
        # OCR populated (synthetic slip is crisp — should read; tolerate inconclusive per spec)
        if out["slip_ocr_weight_kg"] is not None:
            assert abs(float(out["slip_ocr_weight_kg"]) - 10000) <= 500, out["slip_ocr_weight_kg"]
        # Matching values -> not flagged
        assert out["slip_mismatch_flag"] is False
        assert out["slip_mismatch_details"] == []
        # History logs slip_photo_path change
        hist = out.get("history", [])
        slip_changes = [c for c in hist if c.get("field") == "slip_photo_path"]
        assert slip_changes, f"no slip_photo_path history entry: {hist}"
        assert slip_changes[-1]["new"] == path
        assert slip_changes[-1]["by_role"] == "labour"

    def test_attach_persists_on_get(self, api_client, labour_auth, admin_auth):
        vehicle = f"MH{RUN[:2]}AB1234"
        e = _create_inward(api_client, labour_auth, vehicle_number=vehicle, actual_weight_kg=10000)
        path = _upload(labour_auth, _make_slip_image(10000, vehicle), f"TEST_slip12g_{RUN}.png")
        r = _attach(api_client, labour_auth, e["id"], path)
        assert r.status_code == 200, r.text
        g = api_client.get(f"{BASE_URL}/api/entries/{e['id']}", headers=_h(admin_auth))
        assert g.status_code == 200, g.text
        assert g.json()["slip_photo_path"] == path


# ========== MISMATCH RECOMPUTE ==========
class TestSlipAttachMismatch:
    """Attaching a slip whose OCR values differ from the entry re-flags it"""

    def test_mismatch_flag_recomputed(self, api_client, labour_auth):
        vehicle_slip = f"MH{RUN[:2]}AB1234"
        # Entry: weight 11000 vs slip 10000 (~10% > 0.35% tol), vehicle differs too
        e = _create_inward(
            api_client, labour_auth,
            vehicle_number=f"MH{RUN[:2]}ZZ9999",
            actual_weight_kg=11000,
        )
        assert e["slip_mismatch_flag"] is False
        path = _upload(labour_auth, _make_slip_image(10000, vehicle_slip), f"TEST_slip12m_{RUN}.png")
        r = _attach(api_client, labour_auth, e["id"], path)
        assert r.status_code == 200, r.text
        out = r.json()
        assert out["slip_ocr_weight_kg"] is not None, "OCR should read synthetic slip"
        assert out["slip_mismatch_flag"] is True, out
        joined = " | ".join(out["slip_mismatch_details"])
        assert "Weight differs from slip" in joined, joined
        assert "Vehicle differs from slip" in joined, joined


# ========== ROLE GUARDS / ERROR CONTRACT ==========
class TestSlipAttachGuards:
    """Labour add-only, office/admin replace, ownership + existence checks"""

    def test_labour_reattach_blocked_400(self, api_client, labour_auth):
        vehicle = f"MH{RUN[:2]}AB1234"
        e = _create_inward(api_client, labour_auth, vehicle_number=vehicle, actual_weight_kg=10000)
        p1 = _upload(labour_auth, _make_slip_image(10000, vehicle), f"TEST_slip12a_{RUN}.png")
        r1 = _attach(api_client, labour_auth, e["id"], p1)
        assert r1.status_code == 200, r1.text
        # Second attach by labour -> 400
        p2 = _upload(labour_auth, _make_slip_image(10000, vehicle), f"TEST_slip12b_{RUN}.png")
        r2 = _attach(api_client, labour_auth, e["id"], p2)
        assert r2.status_code == 400, r2.text
        assert "already attached" in r2.json().get("detail", "").lower(), r2.text
        # Original path still in place
        g = api_client.get(f"{BASE_URL}/api/entries/{e['id']}", headers=_h(labour_auth))
        assert g.json()["slip_photo_path"] == p1

    def test_office_replace_allowed_200(self, api_client, labour_auth, office_auth):
        vehicle = f"MH{RUN[:2]}AB1234"
        e = _create_inward(api_client, labour_auth, vehicle_number=vehicle, actual_weight_kg=10000)
        p1 = _upload(labour_auth, _make_slip_image(10000, vehicle), f"TEST_slip12c_{RUN}.png")
        r1 = _attach(api_client, labour_auth, e["id"], p1)
        assert r1.status_code == 200, r1.text
        # Office replaces with a new slip (office's own upload)
        p2 = _upload(office_auth, _make_slip_image(10000, vehicle), f"TEST_slip12d_{RUN}.png")
        r2 = _attach(api_client, office_auth, e["id"], p2)
        assert r2.status_code == 200, r2.text
        out = r2.json()
        assert out["slip_photo_path"] == p2
        hist = [c for c in out.get("history", []) if c.get("field") == "slip_photo_path"]
        assert len(hist) >= 2, hist
        assert hist[-1]["old"] == p1 and hist[-1]["new"] == p2
        assert hist[-1]["by_role"] == "office"

    def test_labour_cannot_attach_other_users_upload_403(self, api_client, labour_auth, office_auth):
        vehicle = f"MH{RUN[:2]}AB1234"
        e = _create_inward(api_client, labour_auth, vehicle_number=vehicle, actual_weight_kg=10000)
        # Upload belongs to OFFICE user
        p_other = _upload(office_auth, _make_slip_image(10000, vehicle), f"TEST_slip12o_{RUN}.png")
        r = _attach(api_client, labour_auth, e["id"], p_other)
        assert r.status_code == 403, r.text
        # Entry untouched
        g = api_client.get(f"{BASE_URL}/api/entries/{e['id']}", headers=_h(labour_auth))
        assert g.json()["slip_photo_path"] in (None, "")

    def test_nonexistent_upload_404(self, api_client, labour_auth):
        e = _create_inward(api_client, labour_auth)
        r = _attach(api_client, labour_auth, e["id"], f"/nonexistent/TEST_{RUN}.png")
        assert r.status_code == 404, r.text

    def test_nonexistent_entry_404(self, api_client, labour_auth):
        vehicle = f"MH{RUN[:2]}AB1234"
        p = _upload(labour_auth, _make_slip_image(10000, vehicle), f"TEST_slip12e_{RUN}.png")
        r = _attach(api_client, labour_auth, uuid.uuid4().hex, p)
        assert r.status_code == 404, r.text

    def test_no_auth_401(self, api_client):
        r = api_client.post(
            f"{BASE_URL}/api/entries/{uuid.uuid4().hex}/slip",
            json={"slip_photo_path": "/x.png"},
        )
        assert r.status_code in (401, 403), r.text
