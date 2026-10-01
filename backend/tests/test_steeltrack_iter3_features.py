"""
Iteration-3 feature tests for SteelTrack backend.

Covers:
  1. Low-stock in analytics summary + GET/PATCH /api/settings/low-stock
  2. GET /api/parties (admin/office only, sorted & deduplicated)
  3. POST /api/vision/weight (contract: 400 no input, 404 missing path, 400 tiny image)
  4. POST /api/reports/party-statement + GET /api/reports/{id}.pdf (JWT scope + role auth)
  5. Regression on existing endpoints (login, inward, outward, inventory, entries,
     CSV export, voice transcribe)
"""
import io
import time
import uuid
import pytest
import requests

from tests.conftest import auth_headers, BASE_URL

TIMEOUT = 60


# ---------- Low-stock in analytics summary ----------
class TestAnalyticsLowStock:
    def test_analytics_has_low_stock_fields(self, api_client, admin_auth):
        r = api_client.get(
            f"{BASE_URL}/api/analytics/summary",
            params={"days": 7},
            headers=auth_headers(admin_auth["token"]),
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert "low_stock_threshold_pcs" in data
        assert "low_stock" in data
        assert isinstance(data["low_stock_threshold_pcs"], (int, float))
        assert isinstance(data["low_stock"], list)

    def test_low_stock_item_shape_and_bounds(self, api_client, labour_auth, admin_auth):
        # Create a fresh grade with exactly 1 piece inward so it is <= default threshold (2.0) and >0
        suffix = uuid.uuid4().hex[:8]
        grade = f"TEST_LS_{suffix}"
        r_in = api_client.post(
            f"{BASE_URL}/api/entries/inward",
            json={
                "thickness_mm": 3, "width_mm": 150, "length_mm": 300,
                "pieces": 1, "grade": grade, "vehicle_number": "MH00LS0001",
            },
            headers=auth_headers(labour_auth["token"]),
            timeout=TIMEOUT,
        )
        assert r_in.status_code == 200, r_in.text

        r = api_client.get(
            f"{BASE_URL}/api/analytics/summary",
            params={"days": 7},
            headers=auth_headers(admin_auth["token"]),
            timeout=TIMEOUT,
        )
        assert r.status_code == 200
        data = r.json()
        threshold = float(data["low_stock_threshold_pcs"])

        found = None
        for item in data["low_stock"]:
            if item.get("grade") == grade:
                found = item
                break
        assert found is not None, f"newly inwarded grade {grade} should be in low_stock"

        for k in ("thickness_mm", "width_mm", "length_mm", "grade",
                  "pieces_available", "theoretical_weight_available_kg"):
            assert k in found, f"missing field {k} in low_stock item"

        avail = float(found["pieces_available"])
        assert 0 < avail <= threshold, f"pieces_available {avail} not in (0, {threshold}]"
        assert isinstance(found["theoretical_weight_available_kg"], (int, float))


# ---------- Settings: low-stock threshold ----------
class TestLowStockSetting:
    def test_get_setting_any_user(self, api_client, admin_auth, office_auth, labour_auth):
        for a in (admin_auth, office_auth, labour_auth):
            r = api_client.get(
                f"{BASE_URL}/api/settings/low-stock",
                headers=auth_headers(a["token"]),
                timeout=TIMEOUT,
            )
            assert r.status_code == 200, r.text
            body = r.json()
            assert "low_stock_threshold_pcs" in body
            assert isinstance(body["low_stock_threshold_pcs"], (int, float))

    def test_patch_rbac_and_persistence(self, api_client, admin_auth, office_auth, labour_auth):
        # office forbidden
        r_o = api_client.patch(
            f"{BASE_URL}/api/settings/low-stock",
            json={"low_stock_threshold_pcs": 9.9},
            headers=auth_headers(office_auth["token"]),
            timeout=TIMEOUT,
        )
        assert r_o.status_code == 403, r_o.text

        # labour forbidden
        r_l = api_client.patch(
            f"{BASE_URL}/api/settings/low-stock",
            json={"low_stock_threshold_pcs": 9.9},
            headers=auth_headers(labour_auth["token"]),
            timeout=TIMEOUT,
        )
        assert r_l.status_code == 403, r_l.text

        # admin OK -> 5.5
        r_a = api_client.patch(
            f"{BASE_URL}/api/settings/low-stock",
            json={"low_stock_threshold_pcs": 5.5},
            headers=auth_headers(admin_auth["token"]),
            timeout=TIMEOUT,
        )
        assert r_a.status_code == 200, r_a.text
        assert abs(float(r_a.json()["low_stock_threshold_pcs"]) - 5.5) < 1e-6

        # Persistence check
        r_g = api_client.get(
            f"{BASE_URL}/api/settings/low-stock",
            headers=auth_headers(admin_auth["token"]),
            timeout=TIMEOUT,
        )
        assert r_g.status_code == 200
        assert abs(float(r_g.json()["low_stock_threshold_pcs"]) - 5.5) < 1e-6

        # Reset to 2.0 so we don't pollute other tests
        r_r = api_client.patch(
            f"{BASE_URL}/api/settings/low-stock",
            json={"low_stock_threshold_pcs": 2.0},
            headers=auth_headers(admin_auth["token"]),
            timeout=TIMEOUT,
        )
        assert r_r.status_code == 200, r_r.text
        assert abs(float(r_r.json()["low_stock_threshold_pcs"]) - 2.0) < 1e-6


# ---------- Parties ----------
class TestParties:
    def test_parties_sorted_deduplicated(self, api_client, admin_auth, office_auth, labour_auth):
        # labour forbidden
        r_l = api_client.get(
            f"{BASE_URL}/api/parties",
            headers=auth_headers(labour_auth["token"]),
            timeout=TIMEOUT,
        )
        assert r_l.status_code == 403, r_l.text

        # admin OK
        r_a = api_client.get(
            f"{BASE_URL}/api/parties",
            headers=auth_headers(admin_auth["token"]),
            timeout=TIMEOUT,
        )
        assert r_a.status_code == 200, r_a.text
        parties = r_a.json()
        assert isinstance(parties, list)
        # Endpoint returns dicts {name, whatsapp, ...} since iter4
        names = [p["name"] if isinstance(p, dict) else p for p in parties]
        assert all(isinstance(n, str) for n in names)
        # Dedup
        assert len(names) == len(set(names)), "parties contain duplicates"
        # Case-insensitive sort
        assert names == sorted(names, key=lambda s: s.lower()), \
            "parties list not sorted case-insensitively"
        # None/empty filtered
        assert all(n for n in names), "empty/null party leaked"

        # office OK too
        r_o = api_client.get(
            f"{BASE_URL}/api/parties",
            headers=auth_headers(office_auth["token"]),
            timeout=TIMEOUT,
        )
        assert r_o.status_code == 200, r_o.text


# ---------- Vision OCR (contract-level) ----------
class TestVisionWeight:
    def test_no_file_no_slip_path(self, labour_auth):
        headers = {"Authorization": f"Bearer {labour_auth['token']}"}
        # Must be multipart; send empty form fields
        r = requests.post(
            f"{BASE_URL}/api/vision/weight",
            data={},  # no file, no slip_photo_path
            headers=headers,
            timeout=TIMEOUT,
        )
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text}"
        assert "Provide file or slip_photo_path" in r.json().get("detail", "")

    def test_slip_photo_path_missing(self, labour_auth):
        headers = {"Authorization": f"Bearer {labour_auth['token']}"}
        r = requests.post(
            f"{BASE_URL}/api/vision/weight",
            data={"slip_photo_path": f"nonexistent/{uuid.uuid4().hex}/not_there.jpg"},
            headers=headers,
            timeout=TIMEOUT,
        )
        assert r.status_code == 404, f"expected 404, got {r.status_code}: {r.text}"
        assert "Slip photo not found" in r.json().get("detail", "")

    def test_tiny_image_rejected(self, labour_auth):
        tiny = b"\xff\xd8\xff" + b"\x00" * 50  # ~53 bytes, well under 500
        files = {"file": ("tiny.jpg", io.BytesIO(tiny), "image/jpeg")}
        headers = {"Authorization": f"Bearer {labour_auth['token']}"}
        r = requests.post(
            f"{BASE_URL}/api/vision/weight",
            files=files,
            headers=headers,
            timeout=TIMEOUT,
        )
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text}"
        assert "Image too small" in r.json().get("detail", "")


# ---------- Reports: party-statement ----------
PARTY_NAME = "PYTEST Party One"


class TestReportsStatement:
    def test_no_entries_for_party_404(self, api_client, office_auth):
        # Use a party that certainly has no entries
        unique_party = f"PYTEST_NONEXISTENT_{uuid.uuid4().hex[:8]}"
        r = api_client.post(
            f"{BASE_URL}/api/reports/party-statement",
            json={"party_name": unique_party},
            headers=auth_headers(office_auth["token"]),
            timeout=TIMEOUT,
        )
        assert r.status_code == 404, r.text
        assert f"No entries for party '{unique_party}'" in r.json().get("detail", "")

    def test_labour_forbidden(self, api_client, labour_auth):
        r = api_client.post(
            f"{BASE_URL}/api/reports/party-statement",
            json={"party_name": PARTY_NAME},
            headers=auth_headers(labour_auth["token"]),
            timeout=TIMEOUT,
        )
        assert r.status_code == 403, r.text

    def test_full_flow_generate_and_download(self, api_client, labour_auth,
                                             office_auth, admin_auth):
        # NOTE: Resend blocks the seeded office@steeltrack.com address as
        # "Undeliverable recipient". For the end-to-end flow we register an
        # office user whose email is Resend's always-deliverable test inbox
        # (delivered@resend.dev) and log in as that user. This still fully
        # exercises the real Resend send + signed-token download pipeline.
        test_office_email = "delivered@resend.dev"
        test_office_pw = "DeliveredPytest123!"
        reg = api_client.post(
            f"{BASE_URL}/api/auth/register",
            json={"email": test_office_email, "password": test_office_pw,
                  "name": "PYTEST Delivered Office", "role": "office"},
            headers=auth_headers(admin_auth["token"]),
            timeout=TIMEOUT,
        )
        # 200 if newly created, 400 if already exists from previous run
        assert reg.status_code in (200, 400), reg.text
        lg = api_client.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": test_office_email, "password": test_office_pw},
            timeout=TIMEOUT,
        )
        assert lg.status_code == 200, lg.text
        office_token = lg.json()["token"]

        # 1) Seed one inward entry
        suffix = uuid.uuid4().hex[:6]
        r_in = api_client.post(
            f"{BASE_URL}/api/entries/inward",
            json={
                "thickness_mm": 4, "width_mm": 500, "length_mm": 1000,
                "pieces": 1, "grade": f"TEST_RPT_{suffix}",
                "vehicle_number": "MH00RPT0001",
            },
            headers=auth_headers(labour_auth["token"]),
            timeout=TIMEOUT,
        )
        assert r_in.status_code == 200, r_in.text
        entry_id = r_in.json()["id"]

        # 2) Office patches party_name
        r_p = api_client.patch(
            f"{BASE_URL}/api/entries/{entry_id}/office",
            json={"party_name": PARTY_NAME},
            headers=auth_headers(office_token),
            timeout=TIMEOUT,
        )
        assert r_p.status_code == 200, r_p.text
        assert r_p.json().get("party_name") == PARTY_NAME

        # 3) Office posts party-statement for that party
        r = api_client.post(
            f"{BASE_URL}/api/reports/party-statement",
            json={"party_name": PARTY_NAME},
            headers=auth_headers(office_token),
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        for k in ("report_id", "download_url", "email_id", "sent_to", "entries_count"):
            assert k in body, f"missing {k} in response"
        assert isinstance(body["report_id"], str) and body["report_id"]
        assert body["download_url"].startswith("https://"), body["download_url"]
        assert "?token=" in body["download_url"]
        assert isinstance(body["email_id"], str) and body["email_id"]
        assert body["sent_to"] == test_office_email
        assert int(body["entries_count"]) >= 1

        # Stash for subsequent download tests
        pytest.STEELTRACK_REPORT_ID = body["report_id"]
        pytest.STEELTRACK_DOWNLOAD_URL = body["download_url"]

        # 4) Download with signed token from download_url
        s = requests.Session()
        dl = s.get(body["download_url"], timeout=TIMEOUT)
        assert dl.status_code == 200, f"download failed: {dl.status_code} {dl.text[:200]}"
        assert dl.headers.get("Content-Type", "").startswith("application/pdf")
        assert dl.content[:5] == b"%PDF-", f"not a PDF: {dl.content[:16]!r}"

    def test_download_without_token_401(self, api_client):
        rid = getattr(pytest, "STEELTRACK_REPORT_ID", None)
        if not rid:
            pytest.skip("no report created in prior test")
        s = requests.Session()
        r = s.get(f"{BASE_URL}/api/reports/{rid}.pdf", timeout=TIMEOUT)
        assert r.status_code == 401, f"expected 401, got {r.status_code}: {r.text}"

    def test_download_with_bogus_token_401(self):
        rid = getattr(pytest, "STEELTRACK_REPORT_ID", None)
        if not rid:
            pytest.skip("no report created in prior test")
        s = requests.Session()
        r = s.get(
            f"{BASE_URL}/api/reports/{rid}.pdf",
            params={"token": "not.a.valid.jwt"},
            timeout=TIMEOUT,
        )
        assert r.status_code == 401, f"expected 401, got {r.status_code}: {r.text}"

    def test_download_with_office_main_jwt_200(self, office_auth):
        rid = getattr(pytest, "STEELTRACK_REPORT_ID", None)
        if not rid:
            pytest.skip("no report created in prior test")
        # Pass office user's main login JWT as Authorization header (not the ?token=)
        r = requests.get(
            f"{BASE_URL}/api/reports/{rid}.pdf",
            headers={"Authorization": f"Bearer {office_auth['token']}"},
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, f"status={r.status_code}, body={r.text[:200]}"
        assert r.headers.get("Content-Type", "").startswith("application/pdf")
        assert r.content[:5] == b"%PDF-"


# ---------- Regression ----------
class TestRegression:
    def test_login_still_works(self, api_client):
        r = api_client.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": "admin@steeltrack.com", "password": "admin123"},
            timeout=TIMEOUT,
        )
        assert r.status_code == 200
        assert "token" in r.json()
        assert r.json()["user"]["role"] == "admin"

    def test_inward_still_works(self, api_client, labour_auth):
        r = api_client.post(
            f"{BASE_URL}/api/entries/inward",
            json={"thickness_mm": 2, "width_mm": 100, "length_mm": 500,
                  "pieces": 1, "vehicle_number": "MH00REG0001"},
            headers=auth_headers(labour_auth["token"]),
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        assert r.json()["direction"] == "inward"

    def test_outward_still_works(self, api_client, labour_auth):
        # Create inward then outward on same dims+grade
        g = f"TEST_REG_{uuid.uuid4().hex[:6]}"
        api_client.post(
            f"{BASE_URL}/api/entries/inward",
            json={"thickness_mm": 2, "width_mm": 100, "length_mm": 500,
                  "pieces": 2, "grade": g, "vehicle_number": "MH00REG0002"},
            headers=auth_headers(labour_auth["token"]),
            timeout=TIMEOUT,
        )
        r = api_client.post(
            f"{BASE_URL}/api/entries/outward",
            json={"thickness_mm": 2, "width_mm": 100, "length_mm": 500,
                  "pieces": 1, "grade": g, "broker_name": "TEST_BRK",
                  "vehicle_number": "MH00REG0003"},
            headers=auth_headers(labour_auth["token"]),
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        assert r.json()["direction"] == "outward"

    def test_inventory_still_works(self, api_client, admin_auth):
        r = api_client.get(
            f"{BASE_URL}/api/inventory",
            headers=auth_headers(admin_auth["token"]),
            timeout=TIMEOUT,
        )
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_entries_still_works(self, api_client, admin_auth):
        r = api_client.get(
            f"{BASE_URL}/api/entries",
            headers=auth_headers(admin_auth["token"]),
            timeout=TIMEOUT,
        )
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_csv_export_still_works(self, api_client, admin_auth):
        r = api_client.get(
            f"{BASE_URL}/api/entries.csv",
            headers=auth_headers(admin_auth["token"]),
            timeout=TIMEOUT,
        )
        assert r.status_code == 200
        assert r.headers.get("Content-Type", "").startswith("text/csv")

    def test_voice_rejects_empty(self, labour_auth):
        headers = {"Authorization": f"Bearer {labour_auth['token']}"}
        r = requests.post(
            f"{BASE_URL}/api/voice/transcribe",
            headers=headers,
            timeout=TIMEOUT,
        )
        # Missing file -> 422 (validation)
        assert r.status_code == 422, f"expected 422, got {r.status_code}: {r.text}"
