"""
Iteration 8 feature tests — SteelTrack / Hemant Enterprise
Coverage:
  - Catalog CRUD (grades, thicknesses, widths, lengths, mukadams, brokers)
  - Role gating on catalog write/delete
  - Legacy mukadams/brokers shim
  - Multi line-item inward/outward entries
  - Backward-compat flat-field inward
  - entry_date persistence
  - Variance aggregated across line_items
  - Inventory / low-stock aggregation across line_items
  - FIFO auto-match on single-line outward
"""
import os
import time
import uuid
from datetime import datetime, timezone, timedelta

import pytest
import requests
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / "frontend" / ".env")
BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")


def auth_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ---------- helpers ----------
def _h(auth):
    return auth_headers(auth["token"])


# ========== CATALOG CRUD ==========
class TestCatalogRead:
    """GET /api/catalog/{kind} seeds + returns a list; numeric kinds are floats"""

    def test_grades_seeded_and_contain_defaults(self, api_client, admin_auth):
        r = api_client.get(f"{BASE_URL}/api/catalog/grades", headers=_h(admin_auth))
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, list) and len(data) >= 1
        values = [d["value"] for d in data]
        assert "IS2062" in values
        assert "E350" in values
        # grades are strings
        assert all(isinstance(v, str) for v in values)

    def test_thicknesses_seeded_numeric(self, api_client, admin_auth):
        r = api_client.get(f"{BASE_URL}/api/catalog/thicknesses", headers=_h(admin_auth))
        assert r.status_code == 200, r.text
        data = r.json()
        assert len(data) >= 1
        values = [d["value"] for d in data]
        assert all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in values)
        assert 10 in values or 10.0 in values

    def test_widths_lengths_numeric(self, api_client, admin_auth):
        for kind in ("widths", "lengths"):
            r = api_client.get(f"{BASE_URL}/api/catalog/{kind}", headers=_h(admin_auth))
            assert r.status_code == 200, f"{kind}: {r.text}"
            values = [d["value"] for d in r.json()]
            assert all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in values)

    def test_mukadams_brokers_readable_by_any_user(self, api_client, labour_auth):
        for kind in ("mukadams", "brokers"):
            r = api_client.get(f"{BASE_URL}/api/catalog/{kind}", headers=_h(labour_auth))
            assert r.status_code == 200, f"{kind}: {r.text}"
            assert isinstance(r.json(), list)

    def test_unknown_kind_returns_404(self, api_client, admin_auth):
        r = api_client.get(f"{BASE_URL}/api/catalog/widgets", headers=_h(admin_auth))
        assert r.status_code == 404


class TestCatalogWrite:
    """POST /api/catalog/{kind} with role & numeric handling"""

    def test_office_can_add_string_catalog(self, api_client, office_auth):
        val = f"TEST_GRADE_{uuid.uuid4().hex[:6].upper()}"
        r = api_client.post(f"{BASE_URL}/api/catalog/grades", json={"value": val}, headers=_h(office_auth))
        assert r.status_code == 200, r.text
        assert r.json()["value"] == val
        # verify persistence via GET
        g = api_client.get(f"{BASE_URL}/api/catalog/grades", headers=_h(office_auth))
        assert val in [d["value"] for d in g.json()]

    def test_numeric_kind_accepts_numeric_string(self, api_client, office_auth):
        # pick a value unlikely to pre-exist
        val = str(997)
        r = api_client.post(f"{BASE_URL}/api/catalog/thicknesses", json={"value": val}, headers=_h(office_auth))
        assert r.status_code == 200, r.text
        stored = r.json()["value"]
        assert isinstance(stored, float) and stored == 997.0

    def test_numeric_kind_rejects_non_numeric(self, api_client, office_auth):
        r = api_client.post(f"{BASE_URL}/api/catalog/thicknesses", json={"value": "abc"}, headers=_h(office_auth))
        assert r.status_code == 400

    def test_duplicate_is_idempotent(self, api_client, office_auth):
        val = f"DUP_{uuid.uuid4().hex[:6].upper()}"
        r1 = api_client.post(f"{BASE_URL}/api/catalog/grades", json={"value": val}, headers=_h(office_auth))
        r2 = api_client.post(f"{BASE_URL}/api/catalog/grades", json={"value": val}, headers=_h(office_auth))
        assert r1.status_code == 200 and r2.status_code == 200
        assert r1.json()["value"] == r2.json()["value"] == val

    def test_labour_cannot_add(self, api_client, labour_auth):
        r = api_client.post(f"{BASE_URL}/api/catalog/grades", json={"value": "NOPE"}, headers=_h(labour_auth))
        assert r.status_code == 403

    def test_unknown_kind_post_404(self, api_client, admin_auth):
        r = api_client.post(f"{BASE_URL}/api/catalog/widgets", json={"value": "x"}, headers=_h(admin_auth))
        assert r.status_code == 404


class TestCatalogDelete:
    """DELETE /api/catalog/{kind}/{value} — admin only; numeric parsing"""

    def test_admin_can_delete_string(self, api_client, admin_auth):
        val = f"DEL_{uuid.uuid4().hex[:6].upper()}"
        api_client.post(f"{BASE_URL}/api/catalog/grades", json={"value": val}, headers=_h(admin_auth))
        r = api_client.delete(f"{BASE_URL}/api/catalog/grades/{val}", headers=_h(admin_auth))
        assert r.status_code == 200, r.text
        g = api_client.get(f"{BASE_URL}/api/catalog/grades", headers=_h(admin_auth))
        assert val not in [d["value"] for d in g.json()]

    def test_admin_delete_numeric_parses_float(self, api_client, admin_auth):
        # Add 10 (should already exist as seed) and ensure delete-by-"10" works then re-add
        api_client.post(f"{BASE_URL}/api/catalog/thicknesses", json={"value": "888"}, headers=_h(admin_auth))
        r = api_client.delete(f"{BASE_URL}/api/catalog/thicknesses/888", headers=_h(admin_auth))
        assert r.status_code == 200, r.text
        g = api_client.get(f"{BASE_URL}/api/catalog/thicknesses", headers=_h(admin_auth))
        values = [d["value"] for d in g.json()]
        assert 888.0 not in values and 888 not in values

    def test_office_cannot_delete(self, api_client, office_auth):
        r = api_client.delete(f"{BASE_URL}/api/catalog/grades/anything", headers=_h(office_auth))
        assert r.status_code == 403

    def test_labour_cannot_delete(self, api_client, labour_auth):
        r = api_client.delete(f"{BASE_URL}/api/catalog/grades/anything", headers=_h(labour_auth))
        assert r.status_code == 403


class TestLegacyShim:
    """GET/POST/DELETE /api/mukadams and /api/brokers still return {name}"""

    def test_mukadams_get_shape(self, api_client, admin_auth):
        r = api_client.get(f"{BASE_URL}/api/mukadams", headers=_h(admin_auth))
        assert r.status_code == 200
        for i in r.json():
            assert "name" in i

    def test_brokers_crud_roundtrip(self, api_client, admin_auth):
        nm = f"TEST_BROKER_{uuid.uuid4().hex[:6].upper()}"
        r = api_client.post(f"{BASE_URL}/api/brokers", json={"name": nm}, headers=_h(admin_auth))
        assert r.status_code == 200, r.text
        g = api_client.get(f"{BASE_URL}/api/brokers", headers=_h(admin_auth))
        assert nm in [i["name"] for i in g.json()]
        d = api_client.delete(f"{BASE_URL}/api/brokers/{nm}", headers=_h(admin_auth))
        assert d.status_code == 200


# ========== LINE ITEMS ==========
VP_PREFIX = f"IT8-{uuid.uuid4().hex[:4].upper()}"


class TestMultiLineInward:
    def test_two_line_items_sum_totals(self, api_client, admin_auth):
        body = {
            "vehicle_number": f"{VP_PREFIX}-A",
            "line_items": [
                {"thickness_mm": 10, "width_mm": 1000, "length_mm": 2000, "pieces": 2, "grade": "IS2062"},
                {"thickness_mm": 12, "width_mm": 1250, "length_mm": 2500, "pieces": 3, "grade": "IS2062"},
            ],
        }
        r = api_client.post(f"{BASE_URL}/api/entries/inward", json=body, headers=_h(admin_auth))
        assert r.status_code == 200, r.text
        e = r.json()
        assert len(e["line_items"]) == 2
        # each line should have theoretical_weight_kg
        for li in e["line_items"]:
            assert li.get("theoretical_weight_kg") and li["theoretical_weight_kg"] > 0
        sum_tw = round(sum(li["theoretical_weight_kg"] for li in e["line_items"]), 3)
        assert abs(e["theoretical_weight_kg"] - sum_tw) < 0.01
        assert e["pieces"] == 5  # sum
        # top-level mirrors line 0
        li0 = e["line_items"][0]
        assert e["thickness_mm"] == li0["thickness_mm"]
        assert e["width_mm"] == li0["width_mm"]
        assert e["length_mm"] == li0["length_mm"]
        assert e["grade"] == li0["grade"]
        # fetch back
        g = api_client.get(f"{BASE_URL}/api/entries/{e['id']}", headers=_h(admin_auth))
        assert g.status_code == 200
        assert len(g.json()["line_items"]) == 2

    def test_legacy_flat_fields_still_work(self, api_client, admin_auth):
        body = {
            "vehicle_number": f"{VP_PREFIX}-LEG",
            "thickness_mm": 8, "width_mm": 1500, "length_mm": 3000, "pieces": 4,
            "grade": "E350",
        }
        r = api_client.post(f"{BASE_URL}/api/entries/inward", json=body, headers=_h(admin_auth))
        assert r.status_code == 200, r.text
        e = r.json()
        assert len(e["line_items"]) == 1
        assert e["line_items"][0]["pieces"] == 4


class TestEntryDate:
    def test_explicit_entry_date_persists(self, api_client, admin_auth):
        iso = "2025-01-15T10:30:00+00:00"
        body = {
            "vehicle_number": f"{VP_PREFIX}-DT",
            "thickness_mm": 10, "width_mm": 1000, "length_mm": 2000, "pieces": 1, "grade": "IS2062",
            "entry_date": iso,
        }
        r = api_client.post(f"{BASE_URL}/api/entries/inward", json=body, headers=_h(admin_auth))
        assert r.status_code == 200, r.text
        g = api_client.get(f"{BASE_URL}/api/entries/{r.json()['id']}", headers=_h(admin_auth))
        got = g.json().get("entry_date")
        assert got and "2025-01-15" in got

    def test_omitted_entry_date_defaults_to_now(self, api_client, admin_auth):
        body = {
            "vehicle_number": f"{VP_PREFIX}-DN",
            "thickness_mm": 10, "width_mm": 1000, "length_mm": 2000, "pieces": 1, "grade": "IS2062",
        }
        before = datetime.now(timezone.utc)
        r = api_client.post(f"{BASE_URL}/api/entries/inward", json=body, headers=_h(admin_auth))
        assert r.status_code == 200
        after = datetime.now(timezone.utc)
        dt = datetime.fromisoformat(r.json()["entry_date"].replace("Z", "+00:00"))
        assert (before - timedelta(seconds=5)) <= dt <= (after + timedelta(seconds=5))


class TestVarianceMultiLine:
    def test_variance_across_total(self, api_client, admin_auth):
        # Dimensions chosen so theoretical = 1000kg exactly: 10 * 1000 * 2548.9... etc.
        # Use t=10,w=1000,l=2000,p=25.47770700... Hard. Instead, scale actual to match actual total.
        # Build 2 line items, compute total locally; then try actual that exceeds 0.35%.
        line_items = [
            {"thickness_mm": 10, "width_mm": 1000, "length_mm": 2000, "pieces": 10, "grade": "IS2062"},
            {"thickness_mm": 10, "width_mm": 1000, "length_mm": 2000, "pieces": 10, "grade": "IS2062"},
        ]
        # theoretical per line = 10*1000*2000*10 * 7.85e-6 = 1570 kg; two lines = 3140 kg
        theo = 3140.0
        actual_flag = theo * 1.005   # +0.5% -> flagged
        actual_ok = theo * 1.002     # +0.2% -> not flagged
        body = {"vehicle_number": f"{VP_PREFIX}-VF", "line_items": line_items, "actual_weight_kg": actual_flag}
        r = api_client.post(f"{BASE_URL}/api/entries/inward", json=body, headers=_h(admin_auth))
        assert r.status_code == 200, r.text
        e = r.json()
        assert e["variance_flagged"] is True
        assert e["variance_pct"] and e["variance_pct"] > 0.35

        body2 = {"vehicle_number": f"{VP_PREFIX}-VN", "line_items": line_items, "actual_weight_kg": actual_ok}
        r2 = api_client.post(f"{BASE_URL}/api/entries/inward", json=body2, headers=_h(admin_auth))
        assert r2.status_code == 200
        e2 = r2.json()
        assert e2["variance_flagged"] is False


class TestInventoryAndMultiOutward:
    """New-spec multi-line inward shows in inventory; outward with insufficient line fails."""

    unique_grade = f"PYTEST_MULTI_{uuid.uuid4().hex[:4].upper()}"

    def test_new_spec_inventory_and_outward_partial_stock_fails(self, api_client, admin_auth):
        g = self.unique_grade
        # inward: two lines of same new spec, total pieces = 4
        body = {
            "vehicle_number": f"{VP_PREFIX}-INV",
            "line_items": [
                {"thickness_mm": 99, "width_mm": 99, "length_mm": 99, "pieces": 2, "grade": g},
                {"thickness_mm": 99, "width_mm": 99, "length_mm": 99, "pieces": 2, "grade": g},
            ],
        }
        r = api_client.post(f"{BASE_URL}/api/entries/inward", json=body, headers=_h(admin_auth))
        assert r.status_code == 200, r.text

        inv = api_client.get(f"{BASE_URL}/api/inventory", headers=_h(admin_auth)).json()
        row = next((x for x in inv if x.get("grade") == g and x.get("thickness_mm") == 99), None)
        assert row is not None, f"Spec not in inventory: {inv[:3]}"
        assert row["pieces_available"] == 4

        # Outward with 2 lines: 1st fits (3 pcs), 2nd exceeds (5 pcs needed vs 4 avail)
        out_body = {
            "vehicle_number": f"{VP_PREFIX}-OUT",
            "broker_name": "TEST_B",
            "line_items": [
                {"thickness_mm": 99, "width_mm": 99, "length_mm": 99, "pieces": 3, "grade": g},
                {"thickness_mm": 99, "width_mm": 99, "length_mm": 99, "pieces": 5, "grade": g},
            ],
        }
        # NOTE: both lines are the same spec. The stock check iterates per-line and
        # queries ONLY current DB state (not cumulative within the request).
        # The 2nd line will fail because pieces=5 > avail=4.
        r2 = api_client.post(f"{BASE_URL}/api/entries/outward", json=out_body, headers=_h(admin_auth))
        assert r2.status_code == 400
        assert "INSUFFICIENT STOCK" in r2.text

    def test_fifo_single_line_outward_works(self, api_client, admin_auth):
        g = f"FIFO_{uuid.uuid4().hex[:4].upper()}"
        # Create 2 inwards for the same spec
        for pcs in (3, 4):
            api_client.post(f"{BASE_URL}/api/entries/inward", json={
                "vehicle_number": f"{VP_PREFIX}-FI",
                "thickness_mm": 7, "width_mm": 777, "length_mm": 777, "pieces": pcs, "grade": g,
            }, headers=_h(admin_auth))
        # Outward (single-line) for 2 pcs
        r = api_client.post(f"{BASE_URL}/api/entries/outward", json={
            "vehicle_number": f"{VP_PREFIX}-FO",
            "broker_name": "TEST_B",
            "thickness_mm": 7, "width_mm": 777, "length_mm": 777, "pieces": 2, "grade": g,
        }, headers=_h(admin_auth))
        assert r.status_code == 200, r.text
        assert r.json().get("source_entry_id")  # auto-matched
