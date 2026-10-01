"""
SteelTrack iteration 4 backend tests
Covers:
  - Reorder suggestions in analytics low_stock
  - Field-level history on PATCH /entries/{id}/office
  - Role-based rate visibility for labour
"""
import os
import time
import uuid
import pytest
import requests
from datetime import datetime

import sys, os as _os
sys.path.insert(0, _os.path.dirname(__file__))
from conftest import BASE_URL, auth_headers


# ---------- helpers ----------
def _login(session, email, password):
    r = session.post(f"{BASE_URL}/api/auth/login",
                     json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="module")
def admin_tok():
    s = requests.Session(); return _login(s, "admin@steeltrack.com", "admin123")["token"]


@pytest.fixture(scope="module")
def office_tok():
    s = requests.Session(); return _login(s, "office@steeltrack.com", "office123")["token"]


@pytest.fixture(scope="module")
def labour_tok():
    s = requests.Session(); return _login(s, "labour@steeltrack.com", "labour123")["token"]


def _mk_inward(tok, pieces, grade, tw=4.0, w=100.0, l=1000.0, rate=None):
    body = {
        "thickness_mm": tw, "width_mm": w, "length_mm": l,
        "pieces": pieces, "grade": grade, "vehicle_number": "MH-TEST-01",
    }
    r = requests.post(f"{BASE_URL}/api/entries/inward",
                      json=body, headers=auth_headers(tok), timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


def _mk_outward(tok, pieces, grade, tw=4.0, w=100.0, l=1000.0):
    body = {
        "thickness_mm": tw, "width_mm": w, "length_mm": l,
        "pieces": pieces, "grade": grade, "vehicle_number": "MH-TEST-02",
        "broker_name": "ITER4 Broker",
    }
    r = requests.post(f"{BASE_URL}/api/entries/outward",
                      json=body, headers=auth_headers(tok), timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


# ---------- 1. Reorder suggestions ----------
class TestReorderSuggestions:
    """Analytics low_stock items contain avg_weekly_pcs, weeks_remaining, suggested_reorder_pcs."""

    def _get_low_stock(self, tok):
        r = requests.get(f"{BASE_URL}/api/analytics/summary?days=7",
                         headers=auth_headers(tok), timeout=30)
        assert r.status_code == 200, r.text
        return r.json()["low_stock"]

    def _find(self, items, t, w, l, g):
        for it in items:
            if (it["thickness_mm"] == t and it["width_mm"] == w
                    and it["length_mm"] == l and it.get("grade") == g):
                return it
        return None

    def test_zero_outward_group(self, admin_tok):
        # unique grade, no outward -> avg=0, weeks_remaining=None, suggested_reorder_pcs>=0
        grade = f"ITER4_ZOUT_{uuid.uuid4().hex[:6]}"
        # make available=1 so it's low-stock (threshold default is 2)
        _mk_inward(admin_tok, 1, grade)
        items = self._get_low_stock(admin_tok)
        it = self._find(items, 4.0, 100.0, 1000.0, grade)
        assert it is not None, f"group {grade} not found in low_stock"
        assert it["avg_weekly_pcs"] == 0
        assert it["weeks_remaining"] is None
        assert isinstance(it["suggested_reorder_pcs"], (int, float))
        assert it["suggested_reorder_pcs"] >= 0

    def test_recent_outward_4pcs_28d(self, admin_tok):
        # inward 5, outward 4 => available=1, consumption 4/28d -> weekly=1.0, weeks_remaining=1.0
        grade = f"ITER4_RECENT_{uuid.uuid4().hex[:6]}"
        _mk_inward(admin_tok, 5, grade)
        _mk_outward(admin_tok, 4, grade)
        items = self._get_low_stock(admin_tok)
        it = self._find(items, 4.0, 100.0, 1000.0, grade)
        assert it is not None, f"group {grade} not found in low_stock"
        assert it["avg_weekly_pcs"] == 1.0, it
        assert it["weeks_remaining"] == 1.0, it
        assert it["suggested_reorder_pcs"] >= 0

    def test_low_stock_sorted_by_weeks_remaining_nulls_last(self, admin_tok):
        items = self._get_low_stock(admin_tok)
        # Non-null weeks_remaining ascending, nulls at the end
        seen_null = False
        prev = None
        for it in items:
            wr = it.get("weeks_remaining")
            if wr is None:
                seen_null = True
            else:
                assert not seen_null, f"non-null {wr} appeared after a null — sort broken"
                if prev is not None:
                    assert prev <= wr, f"not ascending: {prev} > {wr}"
                prev = wr


# ---------- 2. Field-level history ----------
class TestOfficeHistory:
    """PATCH /entries/{id}/office appends one history row per changed tracked field."""

    def test_single_patch_multiple_fields_push_one_each(self, admin_tok, office_tok):
        e = _mk_inward(admin_tok, 2, f"ITER4_HIST_{uuid.uuid4().hex[:6]}")
        eid = e["id"]
        patch = {
            "invoice_no": "INV-1",
            "party_name": "Party A",
            "rate": 55.5,
            "payment_terms": "NET30",
            "office_remarks": "first",
        }
        r = requests.patch(f"{BASE_URL}/api/entries/{eid}/office",
                           json=patch, headers=auth_headers(office_tok), timeout=30)
        assert r.status_code == 200, r.text
        got = r.json()
        hist = got["history"]
        assert len(hist) == 5
        fields = sorted([h["field"] for h in hist])
        assert fields == sorted(list(patch.keys()))
        for h in hist:
            assert set(h.keys()) >= {"field", "old", "new", "by", "by_name", "by_role", "at"}
            assert h["by_role"] == "office"
            # ISO-ish datetime string
            assert isinstance(h["at"], str) and "T" in h["at"]
            # new value must match patch
            assert h["new"] == patch[h["field"]]
            assert h["old"] in (None, "")

    def test_unchanged_fields_not_pushed(self, admin_tok, office_tok):
        e = _mk_inward(admin_tok, 2, f"ITER4_UNCH_{uuid.uuid4().hex[:6]}")
        eid = e["id"]
        patch = {"invoice_no": "SAME-1", "party_name": "Same Party"}
        r = requests.patch(f"{BASE_URL}/api/entries/{eid}/office",
                           json=patch, headers=auth_headers(office_tok), timeout=30)
        assert r.status_code == 200, r.text
        assert len(r.json()["history"]) == 2
        # Same values again -> no history additions
        r2 = requests.patch(f"{BASE_URL}/api/entries/{eid}/office",
                            json=patch, headers=auth_headers(office_tok), timeout=30)
        assert r2.status_code == 200
        assert len(r2.json()["history"]) == 2, "unchanged fields must NOT be pushed"
        # Change only one — only that one should push
        r3 = requests.patch(f"{BASE_URL}/api/entries/{eid}/office",
                            json={"invoice_no": "SAME-1", "party_name": "Different Party"},
                            headers=auth_headers(office_tok), timeout=30)
        assert r3.status_code == 200
        h3 = r3.json()["history"]
        assert len(h3) == 3
        assert h3[-1]["field"] == "party_name"
        assert h3[-1]["old"] == "Same Party"
        assert h3[-1]["new"] == "Different Party"

    def test_three_sequential_patches_cumulative_in_order(self, admin_tok, office_tok):
        e = _mk_inward(admin_tok, 2, f"ITER4_SEQ_{uuid.uuid4().hex[:6]}")
        eid = e["id"]
        names = ["P1", "P2", "P3"]
        for n in names:
            time.sleep(0.05)  # ensure strict chronological order
            r = requests.patch(f"{BASE_URL}/api/entries/{eid}/office",
                               json={"party_name": n},
                               headers=auth_headers(office_tok), timeout=30)
            assert r.status_code == 200, r.text
        r = requests.get(f"{BASE_URL}/api/entries/{eid}",
                         headers=auth_headers(office_tok), timeout=30)
        assert r.status_code == 200
        hist = r.json()["history"]
        party_hist = [h for h in hist if h["field"] == "party_name"]
        assert len(party_hist) == 3
        # chronological
        times = [h["at"] for h in party_hist]
        assert times == sorted(times), f"history not in PATCH order: {times}"
        assert [h["new"] for h in party_hist] == names
        assert party_hist[0]["old"] in (None, "")
        assert party_hist[1]["old"] == "P1"
        assert party_hist[2]["old"] == "P2"

    def test_history_field_present_on_list_and_detail(self, admin_tok):
        e = _mk_inward(admin_tok, 1, f"ITER4_HISTLIST_{uuid.uuid4().hex[:6]}")
        # detail
        r = requests.get(f"{BASE_URL}/api/entries/{e['id']}",
                         headers=auth_headers(admin_tok), timeout=30)
        assert r.status_code == 200
        body = r.json()
        assert "history" in body and isinstance(body["history"], list)
        assert body["history"] == []  # empty by default
        # list
        r2 = requests.get(f"{BASE_URL}/api/entries?limit=50",
                          headers=auth_headers(admin_tok), timeout=30)
        assert r2.status_code == 200
        for item in r2.json():
            assert "history" in item and isinstance(item["history"], list)


# ---------- 3. Rate visibility ----------
class TestRateVisibility:
    """Labour never sees rate; admin/office still see real rate; DB value untouched."""

    def test_labour_detail_hides_rate_db_untouched(self, admin_tok, office_tok, labour_tok):
        e = _mk_inward(admin_tok, 1, f"ITER4_RATE_{uuid.uuid4().hex[:6]}")
        eid = e["id"]
        # office sets rate
        r = requests.patch(f"{BASE_URL}/api/entries/{eid}/office",
                           json={"rate": 123.45},
                           headers=auth_headers(office_tok), timeout=30)
        assert r.status_code == 200
        assert r.json()["rate"] == 123.45

        # labour: rate must be null
        rL = requests.get(f"{BASE_URL}/api/entries/{eid}",
                          headers=auth_headers(labour_tok), timeout=30)
        assert rL.status_code == 200
        assert rL.json()["rate"] is None, rL.json()

        # admin re-read: must still be 123.45 (DB untouched)
        rA = requests.get(f"{BASE_URL}/api/entries/{eid}",
                          headers=auth_headers(admin_tok), timeout=30)
        assert rA.status_code == 200
        assert rA.json()["rate"] == 123.45

        # office re-read: still real
        rO = requests.get(f"{BASE_URL}/api/entries/{eid}",
                          headers=auth_headers(office_tok), timeout=30)
        assert rO.status_code == 200
        assert rO.json()["rate"] == 123.45

    def test_labour_list_strips_rate_every_item(self, labour_tok):
        r = requests.get(f"{BASE_URL}/api/entries?limit=100",
                         headers=auth_headers(labour_tok), timeout=30)
        assert r.status_code == 200
        items = r.json()
        assert len(items) > 0
        for it in items:
            assert it.get("rate") is None, f"labour saw rate on entry {it.get('id')}: {it.get('rate')}"

    def test_labour_inward_post_response_rate_null(self, labour_tok):
        body = {
            "thickness_mm": 5.0, "width_mm": 120.0, "length_mm": 1500.0,
            "pieces": 1, "grade": f"ITER4_LAB_{uuid.uuid4().hex[:6]}",
            "vehicle_number": "LAB-01",
        }
        r = requests.post(f"{BASE_URL}/api/entries/inward",
                          json=body, headers=auth_headers(labour_tok), timeout=30)
        assert r.status_code == 200, r.text
        assert r.json()["rate"] is None
