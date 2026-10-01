"""
New feature tests for SteelTrack backend (iteration 2):
  1. GET /api/analytics/summary (admin/office/labour)
  2. GET /api/entries.csv (admin/office; labour forbidden; query-token auth)
  3. Stock guardrail on POST /api/entries/outward
  4. POST /api/voice/transcribe (contract-level validation only)

Also sanity-checks regressions on existing endpoints.
"""
import io
import time
import pytest
import requests
from datetime import datetime, timezone

from tests.conftest import auth_headers, BASE_URL


# ---------- Analytics ----------
class TestAnalyticsSummary:
    def test_analytics_shape_admin(self, api_client, admin_auth):
        r = api_client.get(f"{BASE_URL}/api/analytics/summary",
                           params={"days": 7},
                           headers=auth_headers(admin_auth["token"]))
        assert r.status_code == 200, r.text
        data = r.json()

        # Top-level keys
        for key in ("daily", "totals_today", "totals_window",
                    "pending_office", "total_entries",
                    "top_parties", "top_brokers"):
            assert key in data, f"missing {key} in response"

        # daily must have exactly 7 items, dates YYYY-MM-DD, numeric kg
        assert isinstance(data["daily"], list)
        assert len(data["daily"]) == 7, f"expected 7 daily buckets, got {len(data['daily'])}"
        seen_days = set()
        for b in data["daily"]:
            assert "day" in b
            # YYYY-MM-DD
            datetime.strptime(b["day"], "%Y-%m-%d")
            assert b["day"] not in seen_days, "duplicate day in daily buckets"
            seen_days.add(b["day"])
            for k in ("inward_pcs", "outward_pcs", "inward_kg", "outward_kg",
                      "inward_count", "outward_count"):
                assert k in b, f"missing {k} in daily bucket"
                assert isinstance(b[k], (int, float)), f"{k} not numeric: {b[k]}"

        # totals_today / totals_window shape
        for tkey in ("totals_today", "totals_window"):
            t = data[tkey]
            for k in ("inward_pcs", "outward_pcs", "inward_kg", "outward_kg"):
                assert k in t, f"missing {k} in {tkey}"
                assert isinstance(t[k], (int, float))

        assert isinstance(data["top_parties"], list)
        assert isinstance(data["top_brokers"], list)
        assert isinstance(data["pending_office"], int)
        assert isinstance(data["total_entries"], int)

    def test_analytics_accessible_office(self, api_client, office_auth):
        r = api_client.get(f"{BASE_URL}/api/analytics/summary",
                           params={"days": 7},
                           headers=auth_headers(office_auth["token"]))
        assert r.status_code == 200, r.text

    def test_analytics_accessible_labour(self, api_client, labour_auth):
        r = api_client.get(f"{BASE_URL}/api/analytics/summary",
                           params={"days": 7},
                           headers=auth_headers(labour_auth["token"]))
        assert r.status_code == 200, r.text

    def test_analytics_reflects_new_inward(self, api_client, labour_auth, admin_auth):
        # Baseline
        r0 = api_client.get(f"{BASE_URL}/api/analytics/summary",
                            params={"days": 7},
                            headers=auth_headers(admin_auth["token"]))
        assert r0.status_code == 200
        base = r0.json()["totals_today"]
        base_pcs = float(base.get("inward_pcs", 0))
        base_kg = float(base.get("inward_kg", 0))

        # Create inward with known theoretical ~ 5*1000*2000*2*7.85e-6 = 157.0 kg
        body = {
            "thickness_mm": 5, "width_mm": 1000, "length_mm": 2000,
            "pieces": 2, "vehicle_number": "MH00ANA0001",
            "actual_weight_kg": 157.0,
        }
        c = api_client.post(f"{BASE_URL}/api/entries/inward", json=body,
                            headers=auth_headers(labour_auth["token"]))
        assert c.status_code == 200, c.text
        assert abs(c.json()["theoretical_weight_kg"] - 157.0) < 0.1

        # Re-fetch and assert deltas
        r1 = api_client.get(f"{BASE_URL}/api/analytics/summary",
                            params={"days": 7},
                            headers=auth_headers(admin_auth["token"]))
        assert r1.status_code == 200
        now_totals = r1.json()["totals_today"]
        assert float(now_totals["inward_pcs"]) >= base_pcs + 2 - 1e-6, \
            f"inward_pcs did not increase by >=2 (before={base_pcs}, after={now_totals['inward_pcs']})"
        delta_kg = float(now_totals["inward_kg"]) - base_kg
        assert abs(delta_kg - 157.0) < 2.0, \
            f"inward_kg delta expected ~157, got {delta_kg}"


# ---------- CSV Export ----------
EXPECTED_HEADERS = [
    "Entry No.", "Direction", "Date", "Thickness (mm)", "Width (mm)", "Length (mm)",
    "Pieces", "Grade", "Vehicle No.", "Broker", "Theoretical Wt (kg)", "Actual Wt (kg)",
    "Variance %", "Flagged", "Invoice No.", "Party Name", "Rate (Rs)", "Payment Terms",
    "Remarks", "Office Remarks", "Created By",
]


def _parse_csv_rows(text: str):
    import csv as _csv
    return list(_csv.reader(io.StringIO(text)))


class TestCSVExport:
    def test_csv_export_admin(self, api_client, admin_auth, labour_auth):
        # ensure at least one entry exists
        api_client.post(f"{BASE_URL}/api/entries/inward",
                        json={"thickness_mm": 6, "width_mm": 1200,
                              "length_mm": 2400, "pieces": 1,
                              "vehicle_number": "MH00CSV0001"},
                        headers=auth_headers(labour_auth["token"]))

        r = api_client.get(f"{BASE_URL}/api/entries.csv",
                           headers=auth_headers(admin_auth["token"]))
        assert r.status_code == 200, r.text
        ctype = r.headers.get("Content-Type", "")
        assert ctype.startswith("text/csv"), f"Content-Type={ctype}"
        cdisp = r.headers.get("Content-Disposition", "")
        assert "attachment" in cdisp.lower()
        assert "filename" in cdisp.lower()

        rows = _parse_csv_rows(r.text)
        assert len(rows) >= 1
        assert rows[0] == EXPECTED_HEADERS, f"header mismatch: {rows[0]}"
        assert len(rows[0]) == 21
        for row in rows[1:]:
            assert len(row) == 21, f"data row has {len(row)} fields, expected 21: {row}"

    def test_csv_export_filter_inward(self, api_client, admin_auth):
        r = api_client.get(f"{BASE_URL}/api/entries.csv",
                           params={"direction": "inward"},
                           headers=auth_headers(admin_auth["token"]))
        assert r.status_code == 200, r.text
        rows = _parse_csv_rows(r.text)
        assert rows[0] == EXPECTED_HEADERS
        for row in rows[1:]:
            assert row[1] == "INWARD", f"non-inward row leaked: {row}"

    def test_csv_export_office_ok(self, api_client, office_auth):
        r = api_client.get(f"{BASE_URL}/api/entries.csv",
                           headers=auth_headers(office_auth["token"]))
        assert r.status_code == 200, r.text

    def test_csv_export_labour_forbidden(self, api_client, labour_auth):
        r = api_client.get(f"{BASE_URL}/api/entries.csv",
                           headers=auth_headers(labour_auth["token"]))
        assert r.status_code == 403, r.text

    def test_csv_export_query_token_without_auth_header(self, admin_auth):
        # Use a fresh session with NO Authorization header
        s = requests.Session()
        r = s.get(f"{BASE_URL}/api/entries.csv",
                  params={"token": admin_auth["token"]}, timeout=30)
        assert r.status_code == 200, f"status={r.status_code} body={r.text}"
        assert r.headers.get("Content-Type", "").startswith("text/csv")
        rows = _parse_csv_rows(r.text)
        assert rows and rows[0] == EXPECTED_HEADERS


# ---------- Stock Guardrail on Outward ----------
class TestStockGuardrail:
    def test_insufficient_stock_blocks_outward(self, api_client, labour_auth):
        grade = f"TEST_GRD_{int(time.time())}"
        # Inward: pieces=3
        r_in = api_client.post(f"{BASE_URL}/api/entries/inward",
                               json={"thickness_mm": 1, "width_mm": 100,
                                     "length_mm": 100, "pieces": 3,
                                     "grade": grade,
                                     "vehicle_number": "MH00STK0001"},
                               headers=auth_headers(labour_auth["token"]))
        assert r_in.status_code == 200, r_in.text

        # Attempt outward pieces=5 -> 400 INSUFFICIENT STOCK
        r_bad = api_client.post(f"{BASE_URL}/api/entries/outward",
                                json={"thickness_mm": 1, "width_mm": 100,
                                      "length_mm": 100, "pieces": 5,
                                      "grade": grade, "broker_name": "TEST_BRK",
                                      "vehicle_number": "MH00STK0002"},
                                headers=auth_headers(labour_auth["token"]))
        assert r_bad.status_code == 400, r_bad.text
        assert "INSUFFICIENT STOCK" in r_bad.json().get("detail", "")

        # pieces=2 succeeds (1 remaining)
        r_ok = api_client.post(f"{BASE_URL}/api/entries/outward",
                               json={"thickness_mm": 1, "width_mm": 100,
                                     "length_mm": 100, "pieces": 2,
                                     "grade": grade, "broker_name": "TEST_BRK",
                                     "vehicle_number": "MH00STK0003"},
                               headers=auth_headers(labour_auth["token"]))
        assert r_ok.status_code == 200, r_ok.text

        # pieces=2 again (would exceed; only 1 left) -> 400
        r_bad2 = api_client.post(f"{BASE_URL}/api/entries/outward",
                                 json={"thickness_mm": 1, "width_mm": 100,
                                       "length_mm": 100, "pieces": 2,
                                       "grade": grade, "broker_name": "TEST_BRK",
                                       "vehicle_number": "MH00STK0004"},
                                 headers=auth_headers(labour_auth["token"]))
        assert r_bad2.status_code == 400, r_bad2.text
        assert "INSUFFICIENT STOCK" in r_bad2.json().get("detail", "")

        # pieces=1 succeeds -> inventory drains to 0
        r_last = api_client.post(f"{BASE_URL}/api/entries/outward",
                                 json={"thickness_mm": 1, "width_mm": 100,
                                       "length_mm": 100, "pieces": 1,
                                       "grade": grade, "broker_name": "TEST_BRK",
                                       "vehicle_number": "MH00STK0005"},
                                 headers=auth_headers(labour_auth["token"]))
        assert r_last.status_code == 200, r_last.text

        # Any further outward on this exact dim+grade must be rejected (0 stock)
        r_zero = api_client.post(f"{BASE_URL}/api/entries/outward",
                                 json={"thickness_mm": 1, "width_mm": 100,
                                       "length_mm": 100, "pieces": 1,
                                       "grade": grade, "broker_name": "TEST_BRK",
                                       "vehicle_number": "MH00STK0006"},
                                 headers=auth_headers(labour_auth["token"]))
        assert r_zero.status_code == 400, r_zero.text

    def test_grade_isolation(self, api_client, labour_auth):
        suffix = int(time.time())
        grade_a = f"TEST_A_{suffix}"
        grade_b = f"TEST_B_{suffix}"
        # Inward grade A, pieces=2
        ra = api_client.post(f"{BASE_URL}/api/entries/inward",
                             json={"thickness_mm": 2, "width_mm": 200,
                                   "length_mm": 200, "pieces": 2,
                                   "grade": grade_a,
                                   "vehicle_number": "MH00GRD0001"},
                             headers=auth_headers(labour_auth["token"]))
        assert ra.status_code == 200, ra.text

        # Outward grade B, pieces=1 -> 400
        rb = api_client.post(f"{BASE_URL}/api/entries/outward",
                             json={"thickness_mm": 2, "width_mm": 200,
                                   "length_mm": 200, "pieces": 1,
                                   "grade": grade_b, "broker_name": "TEST_BRK",
                                   "vehicle_number": "MH00GRD0002"},
                             headers=auth_headers(labour_auth["token"]))
        assert rb.status_code == 400, rb.text
        assert "INSUFFICIENT STOCK" in rb.json().get("detail", "")


# ---------- Voice Transcribe (contract-level) ----------
class TestVoiceTranscribe:
    def test_voice_requires_multipart_file(self, api_client, labour_auth):
        # No file at all -> 422
        headers = {"Authorization": f"Bearer {labour_auth['token']}"}
        r = requests.post(f"{BASE_URL}/api/voice/transcribe",
                          headers=headers, timeout=30)
        assert r.status_code == 422, f"expected 422, got {r.status_code}: {r.text}"

    def test_voice_rejects_tiny_audio(self, labour_auth):
        # <1024 bytes -> 400 "Audio too short"
        tiny = b"\x00" * 100
        files = {"file": ("tiny.m4a", io.BytesIO(tiny), "audio/mp4")}
        headers = {"Authorization": f"Bearer {labour_auth['token']}"}
        r = requests.post(f"{BASE_URL}/api/voice/transcribe",
                          files=files, headers=headers, timeout=30)
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text}"
        assert "too short" in r.json().get("detail", "").lower()


# ---------- Regression on existing endpoints ----------
class TestRegression:
    def test_inventory_still_works(self, api_client, admin_auth):
        r = api_client.get(f"{BASE_URL}/api/inventory",
                           headers=auth_headers(admin_auth["token"]))
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_entries_list_still_works(self, api_client, admin_auth):
        r = api_client.get(f"{BASE_URL}/api/entries",
                           headers=auth_headers(admin_auth["token"]))
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_auth_me_still_works(self, api_client, admin_auth):
        r = api_client.get(f"{BASE_URL}/api/auth/me",
                           headers=auth_headers(admin_auth["token"]))
        assert r.status_code == 200
        assert r.json()["role"] == "admin"
