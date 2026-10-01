"""
SteelTrack backend API tests.
Covers: auth (3 roles), weight calc, entries (inward/outward), inventory,
office update RBAC, users admin RBAC, upload+retrieve.
"""
import io
import os
import re
import time
import pytest
import requests
from datetime import datetime, timezone
from tests.conftest import auth_headers, BASE_URL


ENTRY_NUMBER_RE = re.compile(r"^(INW|OUT)-\d{8}-\d{4}$")


# ---------- Auth ----------
class TestAuth:
    def test_login_admin(self, admin_auth):
        assert "token" in admin_auth and admin_auth["user"]["role"] == "admin"
        assert admin_auth["user"]["email"] == "admin@steeltrack.com"

    def test_login_office(self, office_auth):
        assert office_auth["user"]["role"] == "office"

    def test_login_labour(self, labour_auth):
        assert labour_auth["user"]["role"] == "labour"

    def test_login_bad_password(self, api_client):
        r = api_client.post(f"{BASE_URL}/api/auth/login",
                            json={"email": "admin@steeltrack.com", "password": "wrong"})
        assert r.status_code == 401

    def test_auth_me(self, api_client, admin_auth):
        r = api_client.get(f"{BASE_URL}/api/auth/me",
                           headers=auth_headers(admin_auth["token"]))
        assert r.status_code == 200
        data = r.json()
        assert data["email"] == "admin@steeltrack.com" and data["role"] == "admin"

    def test_auth_me_missing_token(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/auth/me")
        assert r.status_code in (401, 403)


# ---------- Weight calculator ----------
class TestCalcWeight:
    def test_calc_weight_known(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/calc/weight",
                           params={"thickness": 10, "width": 1250,
                                   "length": 2500, "pieces": 1})
        assert r.status_code == 200
        val = r.json()["theoretical_weight_kg"]
        assert abs(val - 245.3125) < 0.001, f"got {val}"


# ---------- Entries: inward ----------
@pytest.fixture(scope="class")
def inward_entry(api_client, labour_auth):
    body = {
        "thickness_mm": 10, "width_mm": 1250, "length_mm": 2500,
        "pieces": 5, "vehicle_number": "MH12AB1234",
        "actual_weight_kg": 1226.5,
    }
    r = api_client.post(f"{BASE_URL}/api/entries/inward", json=body,
                        headers=auth_headers(labour_auth["token"]))
    assert r.status_code == 200, r.text
    return r.json()


class TestInward:
    def test_inward_create_ok(self, inward_entry):
        e = inward_entry
        assert e["direction"] == "inward"
        assert ENTRY_NUMBER_RE.match(e["entry_number"]), e["entry_number"]
        today = datetime.now(timezone.utc).strftime("%Y%m%d")
        assert today in e["entry_number"]
        # theoretical ~ 10*1250*2500*5*7.85e-6 = 1226.5625
        assert abs(e["theoretical_weight_kg"] - 1226.5625) < 0.01
        assert e["variance_flagged"] is False
        assert e["variance_pct"] is not None and e["variance_pct"] <= 0.2

    def test_inward_variance_flagged(self, api_client, labour_auth):
        body = {
            "thickness_mm": 10, "width_mm": 1250, "length_mm": 2500,
            "pieces": 5, "vehicle_number": "MH12AB9999",
            "actual_weight_kg": 1500,
        }
        r = api_client.post(f"{BASE_URL}/api/entries/inward", json=body,
                            headers=auth_headers(labour_auth["token"]))
        assert r.status_code == 200, r.text
        e = r.json()
        assert e["variance_flagged"] is True
        assert e["variance_pct"] > 0.2

    def test_inward_decimal_pieces(self, api_client, labour_auth):
        body = {
            "thickness_mm": 10, "width_mm": 1250, "length_mm": 2500,
            "pieces": 0.5, "vehicle_number": "MH12AB0005",
        }
        r = api_client.post(f"{BASE_URL}/api/entries/inward", json=body,
                            headers=auth_headers(labour_auth["token"]))
        assert r.status_code == 200, r.text
        e = r.json()
        assert e["pieces"] == 0.5
        assert abs(e["theoretical_weight_kg"] - 122.656) < 0.1

    def test_inward_entry_number_uniqueness(self, api_client, labour_auth):
        """Create two inward entries and ensure numbers are unique & sequential."""
        body = {
            "thickness_mm": 8, "width_mm": 1000, "length_mm": 2000,
            "pieces": 2, "vehicle_number": "MH12UQ0001",
        }
        r1 = api_client.post(f"{BASE_URL}/api/entries/inward", json=body,
                             headers=auth_headers(labour_auth["token"]))
        r2 = api_client.post(f"{BASE_URL}/api/entries/inward", json=body,
                             headers=auth_headers(labour_auth["token"]))
        assert r1.status_code == 200 and r2.status_code == 200
        n1 = r1.json()["entry_number"]
        n2 = r2.json()["entry_number"]
        assert n1 != n2
        s1 = int(n1.split("-")[-1]); s2 = int(n2.split("-")[-1])
        assert s2 == s1 + 1


# ---------- Entries listing / get / office update ----------
class TestEntriesListingAndUpdate:
    def test_list_entries_sorted_desc(self, api_client, admin_auth, inward_entry):
        r = api_client.get(f"{BASE_URL}/api/entries",
                           headers=auth_headers(admin_auth["token"]))
        assert r.status_code == 200
        data = r.json()
        assert len(data) >= 1
        # ensure sorted desc by created_at
        times = [e["created_at"] for e in data]
        assert times == sorted(times, reverse=True)

    def test_list_entries_filter_inward(self, api_client, admin_auth):
        r = api_client.get(f"{BASE_URL}/api/entries",
                           params={"direction": "inward"},
                           headers=auth_headers(admin_auth["token"]))
        assert r.status_code == 200
        assert all(e["direction"] == "inward" for e in r.json())

    def test_get_entry_by_id(self, api_client, admin_auth, inward_entry):
        eid = inward_entry["id"]
        r = api_client.get(f"{BASE_URL}/api/entries/{eid}",
                           headers=auth_headers(admin_auth["token"]))
        assert r.status_code == 200
        assert r.json()["id"] == eid

    def test_office_update_by_office_ok(self, api_client, office_auth, inward_entry):
        eid = inward_entry["id"]
        patch = {"invoice_no": "INV-TEST-001", "party_name": "TEST_Party",
                 "rate": 65.5, "payment_terms": "30 days"}
        r = api_client.patch(f"{BASE_URL}/api/entries/{eid}/office", json=patch,
                             headers=auth_headers(office_auth["token"]))
        assert r.status_code == 200, r.text
        e = r.json()
        assert e["invoice_no"] == "INV-TEST-001"
        assert e["party_name"] == "TEST_Party"
        assert e["rate"] == 65.5
        assert e["payment_terms"] == "30 days"
        # Verify persistence via GET
        g = api_client.get(f"{BASE_URL}/api/entries/{eid}",
                           headers=auth_headers(office_auth["token"]))
        assert g.json()["invoice_no"] == "INV-TEST-001"

    def test_office_update_by_labour_forbidden(self, api_client, labour_auth, inward_entry):
        eid = inward_entry["id"]
        r = api_client.patch(f"{BASE_URL}/api/entries/{eid}/office",
                             json={"invoice_no": "X"},
                             headers=auth_headers(labour_auth["token"]))
        assert r.status_code == 403


# ---------- Outward + Inventory ----------
class TestOutwardAndInventory:
    @pytest.fixture(scope="class")
    def inward_for_outward(self, api_client, labour_auth):
        body = {
            "thickness_mm": 12, "width_mm": 1500, "length_mm": 3000,
            "pieces": 10, "vehicle_number": "MH99INV0001", "grade": "IS2062",
        }
        r = api_client.post(f"{BASE_URL}/api/entries/inward", json=body,
                            headers=auth_headers(labour_auth["token"]))
        assert r.status_code == 200
        return r.json()

    def test_inventory_shows_inward(self, api_client, admin_auth, inward_for_outward):
        r = api_client.get(f"{BASE_URL}/api/inventory",
                           headers=auth_headers(admin_auth["token"]))
        assert r.status_code == 200
        groups = r.json()
        match = [g for g in groups if g["thickness_mm"] == 12 and g["width_mm"] == 1500
                 and g["length_mm"] == 3000 and g.get("grade") == "IS2062"]
        assert match, f"inventory group missing. groups={groups}"
        g = match[0]
        assert g["pieces_available"] >= 10
        assert g["theoretical_weight_available_kg"] > 0

    def test_outward_create_and_inventory_reduces(self, api_client, labour_auth, admin_auth, inward_for_outward):
        r0 = api_client.get(f"{BASE_URL}/api/inventory",
                            headers=auth_headers(admin_auth["token"]))
        before = [g for g in r0.json()
                  if g["thickness_mm"] == 12 and g["width_mm"] == 1500
                  and g["length_mm"] == 3000 and g.get("grade") == "IS2062"][0]
        before_pieces = before["pieces_available"]

        body = {
            "thickness_mm": 12, "width_mm": 1500, "length_mm": 3000,
            "pieces": 3, "vehicle_number": "MH99OUT0001", "grade": "IS2062",
            "broker_name": "TEST_Broker",
        }
        r = api_client.post(f"{BASE_URL}/api/entries/outward", json=body,
                            headers=auth_headers(labour_auth["token"]))
        assert r.status_code == 200, r.text
        e = r.json()
        assert e["direction"] == "outward"
        assert e["broker_name"] == "TEST_Broker"
        assert e["entry_number"].startswith("OUT-")

        r1 = api_client.get(f"{BASE_URL}/api/inventory",
                            headers=auth_headers(admin_auth["token"]))
        after = [g for g in r1.json()
                 if g["thickness_mm"] == 12 and g["width_mm"] == 1500
                 and g["length_mm"] == 3000 and g.get("grade") == "IS2062"][0]
        assert abs(after["pieces_available"] - (before_pieces - 3)) < 1e-6, \
            f"before={before_pieces} after={after['pieces_available']}"

    def test_outward_requires_broker(self, api_client, labour_auth):
        body = {
            "thickness_mm": 12, "width_mm": 1500, "length_mm": 3000,
            "pieces": 1, "vehicle_number": "MH99OUT0002",
        }
        r = api_client.post(f"{BASE_URL}/api/entries/outward", json=body,
                            headers=auth_headers(labour_auth["token"]))
        assert r.status_code == 422


# ---------- Users admin RBAC ----------
class TestUserAdmin:
    def test_list_users_admin_ok(self, api_client, admin_auth):
        r = api_client.get(f"{BASE_URL}/api/users",
                           headers=auth_headers(admin_auth["token"]))
        assert r.status_code == 200
        emails = {u["email"] for u in r.json()}
        assert "admin@steeltrack.com" in emails

    def test_list_users_labour_forbidden(self, api_client, labour_auth):
        r = api_client.get(f"{BASE_URL}/api/users",
                           headers=auth_headers(labour_auth["token"]))
        assert r.status_code == 403

    def test_register_user_admin_ok(self, api_client, admin_auth):
        email = f"test_user_{int(time.time())}@steeltrack.com"
        body = {"email": email, "password": "pass1234", "name": "TEST_User", "role": "office"}
        r = api_client.post(f"{BASE_URL}/api/auth/register", json=body,
                            headers=auth_headers(admin_auth["token"]))
        assert r.status_code == 200, r.text
        u = r.json()
        assert u["email"] == email and u["role"] == "office"
        # Verify login works
        login = api_client.post(f"{BASE_URL}/api/auth/login",
                                json={"email": email, "password": "pass1234"})
        assert login.status_code == 200

    def test_register_user_labour_forbidden(self, api_client, labour_auth):
        body = {"email": "nope@x.com", "password": "x", "name": "x", "role": "labour"}
        r = api_client.post(f"{BASE_URL}/api/auth/register", json=body,
                            headers=auth_headers(labour_auth["token"]))
        assert r.status_code == 403

    def test_register_user_office_forbidden(self, api_client, office_auth):
        body = {"email": "nope2@x.com", "password": "x", "name": "x", "role": "labour"}
        r = api_client.post(f"{BASE_URL}/api/auth/register", json=body,
                            headers=auth_headers(office_auth["token"]))
        assert r.status_code == 403


# ---------- Upload + retrieve ----------
class TestUpload:
    def test_upload_and_fetch_file(self, labour_auth):
        # Minimal valid PNG (1x1 red pixel)
        png_bytes = bytes.fromhex(
            "89504e470d0a1a0a0000000d49484452000000010000000108020000"
            "00907753de0000000c4944415408d76368606060000000040001"
            "5d3dc9a30000000049454e44ae426082"
        )
        files = {"file": ("test.png", io.BytesIO(png_bytes), "image/png")}
        headers = {"Authorization": f"Bearer {labour_auth['token']}"}
        r = requests.post(f"{BASE_URL}/api/upload", files=files, headers=headers, timeout=60)
        if r.status_code == 502:
            pytest.skip(f"Object storage unavailable: {r.text}")
        assert r.status_code == 200, r.text
        data = r.json()
        assert "path" in data and "size" in data
        path = data["path"]

        # Fetch back - owner (labour) should succeed
        g = requests.get(f"{BASE_URL}/api/files/{path}", headers=headers, timeout=60)
        assert g.status_code == 200, g.text
        assert g.content and len(g.content) > 0
