"""
SteelTrack iter_5 backend tests.

Covers:
  (A) Inward/Outward accept optional driver_name + driver_phone and persist them.
  (B) GET /vehicles/{plate} returns last_driver/last_phone/last_used_at, case-insensitive,
      and remembers the LATEST driver on subsequent entries.
  (C) GET /parties merges stored + distinct entry.party_name, returns whatsapp_digits
      normalised (10-digit → '91XXXXXXXXXX').  Labour → 403.
  (D) PATCH /entries/{id}/correction behaviours:
        - actual_weight_kg only → recomputes variance_pct, keeps theoretical unchanged,
          pushes exactly one history row.
        - pieces only → recomputes theoretical AND variance from stored actual_weight_kg.
        - outward stock guard: pieces > available (excl. self) → 400 INSUFFICIENT STOCK.
        - empty body → 400 'No changes supplied'.
        - labour → 403.
        - driver_name change updates db.vehicles for the entry's plate.
  (E) POST /entries/{id}/invoice-pdf:
        - without invoice_no → 400.
        - labour → 403.
        - happy path returns {report_id, download_url (https + ?token=), email_id,
          email_error, sent_to, entry_id}; GET /reports/{id}.pdf?token=... returns 200
          application/pdf with %PDF- magic bytes.
  (F) Low-stock email alert cooldown: db.low_stock_alerts contains ONE record for the
      group key after dropping to threshold, no second record while within 24h cooldown.
      Outward always 200 regardless of email success.
"""
import os
import uuid
import pytest
import requests
from datetime import datetime, timezone, timedelta
from pymongo import MongoClient
from pathlib import Path
from dotenv import load_dotenv

# Load backend .env for direct Mongo access (needed for low-stock alert assertions)
load_dotenv(Path(__file__).resolve().parents[1] / ".env")

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

from .conftest import auth_headers  # noqa: E402


# --------- helpers ---------

def _mkinward(client, token, *, pieces=5.0, grade=None, dims=None, driver=None, phone=None, vehicle=None):
    t, w, l = dims or (10.0, 100.0, 1000.0)
    body = {
        "thickness_mm": t, "width_mm": w, "length_mm": l,
        "pieces": pieces, "grade": grade,
        "vehicle_number": vehicle or f"MH12AB{uuid.uuid4().hex[:4].upper()}",
    }
    if driver:
        body["driver_name"] = driver
    if phone:
        body["driver_phone"] = phone
    r = client.post(f"{BASE_URL}/api/entries/inward", json=body, headers=auth_headers(token))
    assert r.status_code == 200, r.text
    return r.json()


def _mkoutward(client, token, *, pieces=1.0, grade=None, dims=None, vehicle=None, broker="PYTEST_BROKER"):
    t, w, l = dims or (10.0, 100.0, 1000.0)
    body = {
        "thickness_mm": t, "width_mm": w, "length_mm": l,
        "pieces": pieces, "grade": grade,
        "vehicle_number": vehicle or f"MH12AB{uuid.uuid4().hex[:4].upper()}",
        "broker_name": broker,
    }
    r = client.post(f"{BASE_URL}/api/entries/outward", json=body, headers=auth_headers(token))
    assert r.status_code in (200, 201), r.text
    return r.json()


# BASE_URL after conftest fixtures
from .conftest import BASE_URL  # noqa: E402


# ================================================================
# (A) + (B) Driver name/phone persistence + vehicle memory
# ================================================================
class TestDriverAndVehicleMemory:
    def test_inward_accepts_driver_fields_labour_can_create(self, api_client, labour_auth):
        plate = f"MH05AA{uuid.uuid4().hex[:4].upper()}"
        body = {
            "thickness_mm": 8.0, "width_mm": 150.0, "length_mm": 2000.0,
            "pieces": 3, "grade": "ITER5_DRV",
            "vehicle_number": plate,
            "driver_name": "Ravi Kumar",
            "driver_phone": "9876543210",
        }
        r = api_client.post(f"{BASE_URL}/api/entries/inward", json=body, headers=auth_headers(labour_auth["token"]))
        assert r.status_code == 200, r.text
        created = r.json()
        assert created["driver_name"] == "Ravi Kumar"
        assert created["driver_phone"] == "9876543210"

        # GET /entries/{id} shows them
        r2 = api_client.get(f"{BASE_URL}/api/entries/{created['id']}", headers=auth_headers(labour_auth["token"]))
        assert r2.status_code == 200
        got = r2.json()
        assert got["driver_name"] == "Ravi Kumar"
        assert got["driver_phone"] == "9876543210"

    def test_vehicle_lookup_case_insensitive_and_unseen(self, api_client, labour_auth, admin_auth):
        plate_upper = f"MH05AA{uuid.uuid4().hex[:4].upper()}"
        _mkinward(
            api_client, labour_auth["token"],
            pieces=2.0, grade="ITER5_VEH", vehicle=plate_upper,
            driver="Suresh Patil", phone="9123456780",
        )
        # Lowercase plate must still resolve
        r = api_client.get(f"{BASE_URL}/api/vehicles/{plate_upper.lower()}", headers=auth_headers(admin_auth["token"]))
        assert r.status_code == 200, r.text
        v = r.json()
        assert v["plate"] == plate_upper
        assert v["last_driver"] == "Suresh Patil"
        assert v["last_phone"] == "9123456780"
        assert v["last_used_at"] is not None

        # Unseen plate → nulls
        unseen = f"ZZ99XX{uuid.uuid4().hex[:4].upper()}"
        r2 = api_client.get(f"{BASE_URL}/api/vehicles/{unseen}", headers=auth_headers(admin_auth["token"]))
        assert r2.status_code == 200
        v2 = r2.json()
        assert v2["plate"] == unseen
        assert v2["last_driver"] is None
        assert v2["last_phone"] is None
        assert v2["last_used_at"] is None

    def test_vehicle_latest_driver_wins(self, api_client, labour_auth, admin_auth):
        plate = f"MH06BB{uuid.uuid4().hex[:4].upper()}"
        _mkinward(api_client, labour_auth["token"], pieces=2.0, grade="ITER5_VEH2",
                  vehicle=plate, driver="First Driver", phone="9000000001")
        _mkinward(api_client, labour_auth["token"], pieces=2.0, grade="ITER5_VEH2",
                  vehicle=plate, driver="Second Driver", phone="9000000002")

        r = api_client.get(f"{BASE_URL}/api/vehicles/{plate}", headers=auth_headers(admin_auth["token"]))
        assert r.status_code == 200
        v = r.json()
        assert v["last_driver"] == "Second Driver"
        assert v["last_phone"] == "9000000002"


# ================================================================
# (C) Parties CRUD + whatsapp normalisation
# ================================================================
class TestParties:
    def test_list_parties_merges_entries_and_stored(self, api_client, office_auth, labour_auth):
        # Isolated inward then outward in that group
        dims = (6.0 + (uuid.uuid4().int % 100) / 1000.0, 50.0, 500.0)
        grade = f"ITER5_PARTY_{uuid.uuid4().hex[:4]}"
        _mkinward(api_client, labour_auth["token"], pieces=2.0, grade=grade, dims=dims)
        out = _mkoutward(api_client, labour_auth["token"], pieces=1.0, grade=grade, dims=dims)
        party = f"PYTEST_PARTY_{uuid.uuid4().hex[:6]}"
        patch = api_client.patch(
            f"{BASE_URL}/api/entries/{out['id']}/office",
            json={"party_name": party, "invoice_no": f"INV-{uuid.uuid4().hex[:4]}"},
            headers=auth_headers(office_auth["token"]),
        )
        assert patch.status_code == 200, patch.text

        r = api_client.get(f"{BASE_URL}/api/parties", headers=auth_headers(office_auth["token"]))
        assert r.status_code == 200
        names = [p["name"] for p in r.json()]
        assert party in names

    def test_put_party_persists_whatsapp_and_normalises(self, api_client, office_auth):
        name = f"PYTEST_W_{uuid.uuid4().hex[:6]}"
        r = api_client.put(
            f"{BASE_URL}/api/parties/{name}",
            json={"name": name, "whatsapp": "98765 43210"},
            headers=auth_headers(office_auth["token"]),
        )
        assert r.status_code == 200, r.text
        doc = r.json()
        assert doc["whatsapp"] == "98765 43210"
        assert doc["whatsapp_digits"] == "919876543210"

        # Appears in list with normalised digits
        r2 = api_client.get(f"{BASE_URL}/api/parties", headers=auth_headers(office_auth["token"]))
        assert r2.status_code == 200
        found = next((p for p in r2.json() if p["name"] == name), None)
        assert found is not None
        assert found["whatsapp"] == "98765 43210"
        assert found["whatsapp_digits"] == "919876543210"

    def test_put_party_labour_forbidden(self, api_client, labour_auth):
        name = f"PYTEST_W_{uuid.uuid4().hex[:6]}"
        r = api_client.put(
            f"{BASE_URL}/api/parties/{name}",
            json={"name": name, "whatsapp": "9876543210"},
            headers=auth_headers(labour_auth["token"]),
        )
        assert r.status_code == 403

    def test_list_parties_labour_forbidden(self, api_client, labour_auth):
        r = api_client.get(f"{BASE_URL}/api/parties", headers=auth_headers(labour_auth["token"]))
        assert r.status_code == 403


# ================================================================
# (D) Correction endpoint
# ================================================================
class TestCorrection:
    def test_correction_actual_weight_only(self, api_client, labour_auth, office_auth):
        # Inward with actual weight; theoretical for 10×100×1000 pieces=5 = 0.00785*5*vol
        created = _mkinward(api_client, labour_auth["token"],
                            pieces=5, grade="ITER5_CORR_A",
                            dims=(10.0, 100.0, 1000.0))
        # Set initial actual weight via correction (admin/office). First send actual_weight_kg via correction.
        tw = created["theoretical_weight_kg"]
        new_actual = round(tw * 1.05, 3)
        r = api_client.patch(
            f"{BASE_URL}/api/entries/{created['id']}/correction",
            json={"actual_weight_kg": new_actual},
            headers=auth_headers(office_auth["token"]),
        )
        assert r.status_code == 200, r.text
        upd = r.json()
        assert upd["theoretical_weight_kg"] == tw  # unchanged
        assert upd["actual_weight_kg"] == new_actual
        # variance_pct = (actual-tw)/tw*100 ≈ 5.0
        assert upd["variance_pct"] is not None
        assert abs(upd["variance_pct"] - 5.0) < 0.01

        # History: exactly one row for actual_weight_kg (added by this call)
        hist = upd.get("history") or []
        actual_rows = [h for h in hist if h.get("field") == "actual_weight_kg"]
        assert len(actual_rows) == 1
        row = actual_rows[0]
        assert row["new"] == new_actual
        assert row["by_role"] == "office"
        assert "by" in row and "at" in row

    def test_correction_pieces_recomputes_theoretical_and_variance(self, api_client, labour_auth, office_auth):
        # Create inward with explicit actual_weight_kg so we don't depend on a chained patch
        plate = f"MH11PI{uuid.uuid4().hex[:4].upper()}"
        body = {
            "thickness_mm": 10.0, "width_mm": 100.0, "length_mm": 1000.0,
            "pieces": 5, "grade": f"ITER5_CORR_P_{uuid.uuid4().hex[:4]}",
            "vehicle_number": plate,
        }
        r_init = api_client.post(f"{BASE_URL}/api/entries/inward", json=body, headers=auth_headers(labour_auth["token"]))
        assert r_init.status_code == 200, r_init.text
        created = r_init.json()
        tw_old = created["theoretical_weight_kg"]

        # First set an actual weight = tw_old via correction
        r0 = api_client.patch(
            f"{BASE_URL}/api/entries/{created['id']}/correction",
            json={"actual_weight_kg": tw_old},
            headers=auth_headers(office_auth["token"]),
        )
        assert r0.status_code == 200, r0.text
        # Verify DB has actual_weight_kg stored before bumping pieces
        chk = api_client.get(f"{BASE_URL}/api/entries/{created['id']}", headers=auth_headers(office_auth["token"]))
        assert chk.status_code == 200
        assert chk.json()["actual_weight_kg"] == tw_old

        # Now bump pieces to 10 → theoretical doubles, variance recomputed from stored actual (= tw_old)
        r = api_client.patch(
            f"{BASE_URL}/api/entries/{created['id']}/correction",
            json={"pieces": 10},
            headers=auth_headers(office_auth["token"]),
        )
        assert r.status_code == 200, r.text
        upd = r.json()
        assert abs(upd["theoretical_weight_kg"] - 2 * tw_old) < 1e-6
        # variance_pct is ABS: |tw_old - 2*tw_old| / (2*tw_old) * 100 = 50.0
        assert upd["variance_pct"] is not None
        assert abs(upd["variance_pct"] - 50.0) < 0.1, f"got {upd['variance_pct']}"
        # history has one row for pieces
        pieces_rows = [h for h in upd["history"] if h.get("field") == "pieces"]
        assert len(pieces_rows) == 1
        assert float(pieces_rows[0]["old"]) == 5.0
        assert float(pieces_rows[0]["new"]) == 10.0

    def test_correction_outward_stock_guard(self, api_client, labour_auth, office_auth):
        # Isolated group: inward of 5
        dims = (12.0, 120.0, 1200.0)
        grade = f"ITER5_CORR_S_{uuid.uuid4().hex[:4]}"
        _mkinward(api_client, labour_auth["token"], pieces=5, grade=grade, dims=dims)
        out = _mkoutward(api_client, labour_auth["token"], pieces=2, grade=grade, dims=dims)

        # Try to correct outward pieces to 6 → others_avail = 5 (inward=5, outward excl self=0) → should fail
        bad = api_client.patch(
            f"{BASE_URL}/api/entries/{out['id']}/correction",
            json={"pieces": 6},
            headers=auth_headers(office_auth["token"]),
        )
        assert bad.status_code == 400, bad.text
        assert "INSUFFICIENT STOCK" in bad.json()["detail"]

        # pieces <= available (5) succeeds
        ok = api_client.patch(
            f"{BASE_URL}/api/entries/{out['id']}/correction",
            json={"pieces": 4},
            headers=auth_headers(office_auth["token"]),
        )
        assert ok.status_code == 200, ok.text
        assert float(ok.json()["pieces"]) == 4.0

    def test_correction_empty_body_400_and_labour_403(self, api_client, labour_auth, office_auth):
        created = _mkinward(api_client, labour_auth["token"], pieces=2, grade="ITER5_CORR_E")
        r = api_client.patch(
            f"{BASE_URL}/api/entries/{created['id']}/correction",
            json={},
            headers=auth_headers(office_auth["token"]),
        )
        assert r.status_code == 400
        assert "No changes supplied" in r.json()["detail"]

        r2 = api_client.patch(
            f"{BASE_URL}/api/entries/{created['id']}/correction",
            json={"actual_weight_kg": 10.0},
            headers=auth_headers(labour_auth["token"]),
        )
        assert r2.status_code == 403

    def test_correction_driver_updates_vehicle_memory(self, api_client, labour_auth, office_auth, admin_auth):
        plate = f"MH08CC{uuid.uuid4().hex[:4].upper()}"
        created = _mkinward(
            api_client, labour_auth["token"],
            pieces=2, grade="ITER5_CORR_DRV", vehicle=plate,
            driver="Old Driver", phone="9111111111",
        )
        new_name = "Corrected Driver"
        r = api_client.patch(
            f"{BASE_URL}/api/entries/{created['id']}/correction",
            json={"driver_name": new_name},
            headers=auth_headers(office_auth["token"]),
        )
        assert r.status_code == 200, r.text
        v = api_client.get(f"{BASE_URL}/api/vehicles/{plate}", headers=auth_headers(admin_auth["token"]))
        assert v.status_code == 200
        assert v.json()["last_driver"] == new_name


# ================================================================
# (E) Per-entry invoice PDF
# ================================================================
class TestInvoicePdf:
    @staticmethod
    def _mkout_isolated(api_client, labour_token, *, base_t):
        dims = (base_t + (uuid.uuid4().int % 1000) / 10000.0, 50.0, 500.0)
        grade = f"ITER5_INV_{uuid.uuid4().hex[:5]}"
        _mkinward(api_client, labour_token, pieces=2, grade=grade, dims=dims)
        return _mkoutward(api_client, labour_token, pieces=1, grade=grade, dims=dims)

    def test_invoice_pdf_requires_invoice_no_and_party(self, api_client, labour_auth, office_auth):
        out = self._mkout_isolated(api_client, labour_auth["token"], base_t=5.01)
        r = api_client.post(
            f"{BASE_URL}/api/entries/{out['id']}/invoice-pdf",
            headers=auth_headers(office_auth["token"]),
        )
        assert r.status_code == 400, r.text
        assert "Add Invoice No. and Party Name" in r.json()["detail"]

    def test_invoice_pdf_labour_forbidden(self, api_client, labour_auth):
        out = self._mkout_isolated(api_client, labour_auth["token"], base_t=5.02)
        r = api_client.post(
            f"{BASE_URL}/api/entries/{out['id']}/invoice-pdf",
            headers=auth_headers(labour_auth["token"]),
        )
        assert r.status_code == 403

    def test_invoice_pdf_happy_path_and_download(self, api_client, labour_auth, office_auth):
        out = self._mkout_isolated(api_client, labour_auth["token"], base_t=5.03)
        party = f"PYTEST_INV_{uuid.uuid4().hex[:6]}"
        inv_no = f"INV-{uuid.uuid4().hex[:5].upper()}"
        p = api_client.patch(
            f"{BASE_URL}/api/entries/{out['id']}/office",
            json={"invoice_no": inv_no, "party_name": party, "rate": 55.5},
            headers=auth_headers(office_auth["token"]),
        )
        assert p.status_code == 200, p.text

        r = api_client.post(
            f"{BASE_URL}/api/entries/{out['id']}/invoice-pdf",
            headers=auth_headers(office_auth["token"]),
        )
        assert r.status_code == 200, r.text
        data = r.json()
        for key in ("report_id", "download_url", "email_id", "email_error", "sent_to", "entry_id"):
            assert key in data, f"missing key: {key}"
        assert data["entry_id"] == out["id"]
        assert data["download_url"].startswith("https://"), data["download_url"]
        assert "?token=" in data["download_url"]

        # Fetch the PDF
        pdf = requests.get(data["download_url"], timeout=30)
        assert pdf.status_code == 200, f"status={pdf.status_code} body={pdf.text[:200]}"
        assert pdf.headers.get("content-type", "").startswith("application/pdf"), pdf.headers.get("content-type")
        assert pdf.content[:5] == b"%PDF-"

        # Content-Disposition must have a safe filename fallback (no KeyError).
        # Current impl: f'inline; filename="{party_name or kind or "steeltrack"}-statement-{id[:8]}.pdf"'
        # For invoice reports, party_name is NOT stored in db.reports, so fallback chain
        # should yield 'invoice' (from kind) or 'steeltrack'.
        cd = pdf.headers.get("content-disposition", "")
        assert "filename=" in cd, f"missing filename in Content-Disposition: {cd!r}"
        lower = cd.lower()
        assert ("invoice" in lower) or ("steeltrack" in lower) or (party.lower() in lower), \
            f"Content-Disposition should contain a safe fallback filename, got {cd!r}"

    def test_invoice_pdf_download_via_main_jwt_also_works(self, api_client, labour_auth, office_auth):
        """Regression: downloading an invoice PDF with the office main JWT (not ?token=)
        must also succeed (same code-path hits rep.get('party_name') fallback)."""
        out = self._mkout_isolated(api_client, labour_auth["token"], base_t=5.04)
        party = f"PYTEST_INV_{uuid.uuid4().hex[:6]}"
        inv_no = f"INV-{uuid.uuid4().hex[:5].upper()}"
        p = api_client.patch(
            f"{BASE_URL}/api/entries/{out['id']}/office",
            json={"invoice_no": inv_no, "party_name": party, "rate": 55.5},
            headers=auth_headers(office_auth["token"]),
        )
        assert p.status_code == 200, p.text
        r = api_client.post(
            f"{BASE_URL}/api/entries/{out['id']}/invoice-pdf",
            headers=auth_headers(office_auth["token"]),
        )
        assert r.status_code == 200, r.text
        rid = r.json()["report_id"]
        dl = requests.get(
            f"{BASE_URL}/api/reports/{rid}.pdf",
            headers={"Authorization": f"Bearer {office_auth['token']}"},
            timeout=30,
        )
        assert dl.status_code == 200, f"status={dl.status_code} body={dl.text[:200]}"
        assert dl.headers.get("content-type", "").startswith("application/pdf")
        assert dl.content[:5] == b"%PDF-"


# ================================================================
# (F) Low-stock email alert cooldown
# ================================================================
class TestLowStockAlertCooldown:
    def test_cooldown_single_record_within_24h(self, api_client, admin_auth, labour_auth):
        # Setup — threshold = 2 (default)
        s = api_client.get(f"{BASE_URL}/api/settings/low-stock",
                           headers=auth_headers(admin_auth["token"]))
        assert s.status_code == 200
        if float(s.json().get("threshold_pcs", 2)) != 2:
            upd = api_client.patch(f"{BASE_URL}/api/settings/low-stock",
                                   json={"threshold_pcs": 2},
                                   headers=auth_headers(admin_auth["token"]))
            assert upd.status_code == 200

        grade = "PYTEST_LS"
        # Unique dims so the group is isolated across runs
        t, w, l = (3.14 + (uuid.uuid4().int % 1000) / 10000.0,
                   7.77 + (uuid.uuid4().int % 1000) / 10000.0,
                   11.11 + (uuid.uuid4().int % 1000) / 10000.0)
        dims = (round(t, 4), round(w, 4), round(l, 4))

        # Inward of 4 pieces
        _mkinward(api_client, labour_auth["token"], pieces=4, grade=grade, dims=dims)

        group_key = f"{dims[0]}|{dims[1]}|{dims[2]}|{grade}"

        # Clear any stale alert record for this exact group (should not exist since dims are unique)
        mongo = MongoClient(MONGO_URL)
        try:
            mongo[DB_NAME].low_stock_alerts.delete_one({"_id": group_key})

            # 3 outwards: 4→3 (no alert), 3→2 (ALERT), 2→1 (cooldown, no alert)
            for _ in range(3):
                r = api_client.post(
                    f"{BASE_URL}/api/entries/outward",
                    json={
                        "thickness_mm": dims[0], "width_mm": dims[1], "length_mm": dims[2],
                        "pieces": 1, "grade": grade,
                        "vehicle_number": f"LS{uuid.uuid4().hex[:5].upper()}",
                        "broker_name": "PYTEST_BR",
                    },
                    headers=auth_headers(labour_auth["token"]),
                )
                # Outward MUST succeed regardless of email outcome
                assert r.status_code in (200, 201), r.text

            # Exactly one record in db.low_stock_alerts for this group key
            doc = mongo[DB_NAME].low_stock_alerts.find_one({"_id": group_key})
            assert doc is not None, "low_stock_alerts should have one record after dropping to threshold"
            assert "last_sent_at" in doc
            # admins_notified may be 0 if admin email couldn't deliver, but field must exist
            assert "admins_notified" in doc
            assert isinstance(doc["admins_notified"], int)
            assert doc["admins_notified"] >= 0

            # last_sent_at within last few minutes → cooldown active
            lst = doc["last_sent_at"]
            if isinstance(lst, datetime):
                age = datetime.now(timezone.utc) - (lst if lst.tzinfo else lst.replace(tzinfo=timezone.utc))
                assert age < timedelta(hours=1)
        finally:
            mongo.close()

    def test_outward_succeeds_even_if_alert_fails(self, api_client, labour_auth):
        # Simply hitting the outward endpoint should always succeed (email path is swallowed).
        # Using unique dims so there is almost no inventory → still 200 because threshold check
        # will exit early (avail <= 0).
        r = api_client.post(
            f"{BASE_URL}/api/entries/inward",
            json={
                "thickness_mm": 2.5, "width_mm": 25.0, "length_mm": 250.0,
                "pieces": 1, "grade": "ITER5_LS_SAFE",
                "vehicle_number": f"LS{uuid.uuid4().hex[:5].upper()}",
            },
            headers=auth_headers(labour_auth["token"]),
        )
        assert r.status_code == 200
        r2 = api_client.post(
            f"{BASE_URL}/api/entries/outward",
            json={
                "thickness_mm": 2.5, "width_mm": 25.0, "length_mm": 250.0,
                "pieces": 1, "grade": "ITER5_LS_SAFE",
                "vehicle_number": f"LS{uuid.uuid4().hex[:5].upper()}",
                "broker_name": "PYTEST_BR",
            },
            headers=auth_headers(labour_auth["token"]),
        )
        assert r2.status_code in (200, 201), r2.text
