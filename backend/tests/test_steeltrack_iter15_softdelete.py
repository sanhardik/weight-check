"""Iteration 15 — Entry Soft-Delete (cancel / restore) backend tests.

Covers:
- Cancel inward with untouched stock (200, status/history/stock effects)
- Cancel inward whose material was partially dispatched (400 guardrail)
- Cancel outward (stock back) / restore outward (stock consumed) / restore with
  insufficient stock (400)
- Double-cancel 400, restore-active 400, office/labour 403 on cancel+restore
- Exclusions: /inventory, /analytics summary, /parties/ledger, FIFO auto-match,
  party-statement PDF generation
- Cancelled entry still in GET /entries + CSV export Status column
- Mutation guards: correction/office/full-edit/slip on cancelled entry → 400;
  after restore they work again
"""
import pytest
import requests

from tests.conftest import auth_headers

GRADE = "CXL-ITER15"
# Unique dims per scenario so stock math is isolated
DIMS_A = {"thickness_mm": 17.5, "width_mm": 1225, "length_mm": 4877, "grade": GRADE}
DIMS_B = {"thickness_mm": 19.5, "width_mm": 1275, "length_mm": 4922, "grade": GRADE}
DIMS_C = {"thickness_mm": 21.5, "width_mm": 1325, "length_mm": 4966, "grade": GRADE}
DIMS_D = {"thickness_mm": 23.5, "width_mm": 1375, "length_mm": 5011, "grade": GRADE}
DIMS_E = {"thickness_mm": 25.5, "width_mm": 1425, "length_mm": 5055, "grade": GRADE}
DIMS_F = {"thickness_mm": 27.5, "width_mm": 1475, "length_mm": 5099, "grade": GRADE}
DIMS_G = {"thickness_mm": 29.5, "width_mm": 1525, "length_mm": 5143, "grade": GRADE}


# ---------- helpers ----------
def _hdr(auth):
    return auth_headers(auth["token"])


def _mk_inward(client, base_url, auth, dims, pieces, vehicle, remarks="TEST_ITER15"):
    r = client.post(f"{base_url}/api/entries/inward", headers=_hdr(auth), json={
        "vehicle_number": vehicle, "remarks": remarks,
        "line_items": [{**dims, "pieces": pieces}],
    }, timeout=30)
    assert r.status_code == 200, f"inward create failed: {r.status_code} {r.text}"
    return r.json()


def _mk_outward(client, base_url, auth, dims, pieces, vehicle, party=None, broker="TEST Broker"):
    payload = {
        "vehicle_number": vehicle, "broker_name": broker, "remarks": "TEST_ITER15",
        "line_items": [{**dims, "pieces": pieces}],
    }
    r = client.post(f"{base_url}/api/entries/outward", headers=_hdr(auth), json=payload, timeout=30)
    assert r.status_code == 200, f"outward create failed: {r.status_code} {r.text}"
    entry = r.json()
    if party:
        r2 = client.patch(f"{base_url}/api/entries/{entry['id']}/office", headers=_hdr(auth),
                          json={"party_name": party}, timeout=30)
        assert r2.status_code == 200, f"party set failed: {r2.status_code} {r2.text}"
        entry = r2.json()
    return entry


def _avail(client, base_url, auth, dims):
    r = client.get(f"{base_url}/api/inventory", headers=_hdr(auth), timeout=30)
    assert r.status_code == 200
    for g in r.json():
        if (g["thickness_mm"] == dims["thickness_mm"] and g["width_mm"] == dims["width_mm"]
                and g["length_mm"] == dims["length_mm"] and g.get("grade") == dims["grade"]):
            return g["pieces_available"]
    return 0.0


def _cancel(client, base_url, auth, entry_id, reason=None):
    return client.post(f"{base_url}/api/entries/{entry_id}/cancel", headers=_hdr(auth),
                       json={"reason": reason} if reason else {}, timeout=30)


def _restore(client, base_url, auth, entry_id):
    return client.post(f"{base_url}/api/entries/{entry_id}/restore", headers=_hdr(auth),
                       json={}, timeout=30)


class TestCancelInward:
    """Cancel inward entries: happy path + dispatched-material guardrail."""

    def test_cancel_inward_untouched_stock(self, api_client, base_url, admin_auth):
        inw = _mk_inward(api_client, base_url, admin_auth, DIMS_A, 20, "TESTCX15A1")
        assert _avail(api_client, base_url, admin_auth, DIMS_A) == 20

        r = _cancel(api_client, base_url, admin_auth, inw["id"], reason="Wrong vehicle entered")
        assert r.status_code == 200, f"cancel failed: {r.status_code} {r.text}"
        body = r.json()
        assert body["status"] == "cancelled"
        assert body["cancel_reason"] == "Wrong vehicle entered"
        assert body["cancelled_at"] is not None
        assert body["cancelled_by_name"]
        # history records the status change with the reason
        status_changes = [h for h in body.get("history", []) if h.get("field") == "status"]
        assert status_changes, "no status history entry"
        assert "cancelled" in status_changes[-1]["new"]
        assert "Wrong vehicle entered" in status_changes[-1]["new"]
        # stock math: group disappears from /inventory (avail hits 0)
        assert _avail(api_client, base_url, admin_auth, DIMS_A) == 0.0
        # entry still listed in GET /entries with status=cancelled
        lr = api_client.get(f"{base_url}/api/entries", headers=_hdr(admin_auth),
                            params={"search": "TESTCX15A1"}, timeout=30)
        assert lr.status_code == 200
        matches = [e for e in lr.json() if e["id"] == inw["id"]]
        assert matches and matches[0]["status"] == "cancelled"

    def test_cancel_inward_partially_dispatched_blocked(self, api_client, base_url, admin_auth):
        inw = _mk_inward(api_client, base_url, admin_auth, DIMS_B, 10, "TESTCX15B1")
        out = _mk_outward(api_client, base_url, admin_auth, DIMS_B, 6, "TESTCX15B2")
        assert _avail(api_client, base_url, admin_auth, DIMS_B) == 4

        r = _cancel(api_client, base_url, admin_auth, inw["id"], reason="should fail")
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text}"
        assert "already dispatched" in r.json()["detail"]
        # stock unchanged after failed cancel
        assert _avail(api_client, base_url, admin_auth, DIMS_B) == 4
        # entry remains active
        g = api_client.get(f"{base_url}/api/entries/{inw['id']}", headers=_hdr(admin_auth), timeout=30)
        assert g.json()["status"] != "cancelled"

        # cleanup: cancel outward (returns 6) then cancel inward (now allowed)
        assert _cancel(api_client, base_url, admin_auth, out["id"], "TEST cleanup").status_code == 200
        assert _avail(api_client, base_url, admin_auth, DIMS_B) == 10
        assert _cancel(api_client, base_url, admin_auth, inw["id"], "TEST cleanup").status_code == 200


class TestOutwardCancelRestore:
    """Outward cancel returns stock; restore consumes it again; restore guardrail."""

    def test_outward_cancel_restore_cycle_and_guardrail(self, api_client, base_url, admin_auth):
        inw = _mk_inward(api_client, base_url, admin_auth, DIMS_C, 10, "TESTCX15C1")
        out1 = _mk_outward(api_client, base_url, admin_auth, DIMS_C, 4, "TESTCX15C2")
        assert _avail(api_client, base_url, admin_auth, DIMS_C) == 6

        # cancel outward → stock increases back
        r = _cancel(api_client, base_url, admin_auth, out1["id"], "Duplicate outward")
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "cancelled"
        assert _avail(api_client, base_url, admin_auth, DIMS_C) == 10

        # drain stock so restore would exceed availability
        out2 = _mk_outward(api_client, base_url, admin_auth, DIMS_C, 8, "TESTCX15C3")
        assert _avail(api_client, base_url, admin_auth, DIMS_C) == 2

        # restore outward with insufficient stock → 400
        r = _restore(api_client, base_url, admin_auth, out1["id"])
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text}"
        assert "Cannot restore" in r.json()["detail"]
        assert _avail(api_client, base_url, admin_auth, DIMS_C) == 2

        # free stock, restore now works → stock decreases again
        assert _cancel(api_client, base_url, admin_auth, out2["id"], "TEST cleanup").status_code == 200
        assert _avail(api_client, base_url, admin_auth, DIMS_C) == 10
        r = _restore(api_client, base_url, admin_auth, out1["id"])
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "active"
        assert r.json()["cancel_reason"] is None
        assert _avail(api_client, base_url, admin_auth, DIMS_C) == 6

        # cleanup: cancel out1 + inward
        assert _cancel(api_client, base_url, admin_auth, out1["id"], "TEST cleanup").status_code == 200
        assert _cancel(api_client, base_url, admin_auth, inw["id"], "TEST cleanup").status_code == 200


class TestGuardrails:
    """double-cancel, restore-active, role enforcement."""

    def test_double_cancel_and_restore_active_400(self, api_client, base_url, admin_auth):
        inw = _mk_inward(api_client, base_url, admin_auth, DIMS_D, 5, "TESTCX15D1")
        assert _cancel(api_client, base_url, admin_auth, inw["id"], "first").status_code == 200
        r = _cancel(api_client, base_url, admin_auth, inw["id"], "second")
        assert r.status_code == 400
        assert "already cancelled" in r.json()["detail"]

        assert _restore(api_client, base_url, admin_auth, inw["id"]).status_code == 200
        r = _restore(api_client, base_url, admin_auth, inw["id"])
        assert r.status_code == 400
        assert "not cancelled" in r.json()["detail"]
        # cleanup
        assert _cancel(api_client, base_url, admin_auth, inw["id"], "TEST cleanup").status_code == 200

    def test_office_and_labour_forbidden(self, api_client, base_url, admin_auth, office_auth, labour_auth):
        inw = _mk_inward(api_client, base_url, admin_auth, DIMS_E, 5, "TESTCX15E1")
        for role_auth in (office_auth, labour_auth):
            r = _cancel(api_client, base_url, role_auth, inw["id"], "role test")
            assert r.status_code == 403, f"cancel should be 403 for non-admin: {r.status_code}"
            r = _restore(api_client, base_url, role_auth, inw["id"])
            assert r.status_code == 403, f"restore should be 403 for non-admin: {r.status_code}"
        # also restore of a cancelled entry as non-admin → 403
        assert _cancel(api_client, base_url, admin_auth, inw["id"], "setup").status_code == 200
        assert _restore(api_client, base_url, office_auth, inw["id"]).status_code == 403
        assert _restore(api_client, base_url, labour_auth, inw["id"]).status_code == 403


class TestExclusions:
    """Cancelled entries excluded from inventory/analytics/ledger/FIFO/PDF but kept in CSV."""

    def test_cancelled_excluded_from_analytics(self, api_client, base_url, admin_auth):
        def today_outward():
            r = api_client.get(f"{base_url}/api/analytics/summary", headers=_hdr(admin_auth),
                               params={"days": 1}, timeout=30)
            assert r.status_code == 200
            data = r.json()
            daily = data.get("daily") or data.get("days") or []
            for d in daily:
                return d.get("outward_pcs", 0), d.get("outward_count", 0)
            return 0, 0

        before_pcs, before_cnt = today_outward()
        inw = _mk_inward(api_client, base_url, admin_auth, DIMS_F, 6, "TESTCX15F1")
        out = _mk_outward(api_client, base_url, admin_auth, DIMS_F, 6, "TESTCX15F2")
        mid_pcs, mid_cnt = today_outward()
        assert mid_pcs == before_pcs + 6 and mid_cnt == before_cnt + 1

        assert _cancel(api_client, base_url, admin_auth, out["id"], "analytics test").status_code == 200
        after_pcs, after_cnt = today_outward()
        assert after_pcs == before_pcs and after_cnt == before_cnt, \
            f"cancelled outward still counted: before={before_pcs}/{before_cnt} after={after_pcs}/{after_cnt}"
        # cleanup
        assert _cancel(api_client, base_url, admin_auth, inw["id"], "TEST cleanup").status_code == 200

    def test_cancelled_excluded_from_parties_ledger(self, api_client, base_url, admin_auth):
        party = "TEST_CXL_LEDGER_PARTY_15"
        inw = _mk_inward(api_client, base_url, admin_auth, DIMS_F, 4, "TESTCX15F3")
        out = _mk_outward(api_client, base_url, admin_auth, DIMS_F, 4, "TESTCX15F4", party=party)

        r = api_client.get(f"{base_url}/api/parties/ledger", headers=_hdr(admin_auth), timeout=30)
        assert r.status_code == 200
        row = next((p for p in r.json() if p["name"] == party), None)
        assert row is not None and row["entries"] == 1, f"party not in ledger: {row}"

        assert _cancel(api_client, base_url, admin_auth, out["id"], "ledger test").status_code == 200
        r = api_client.get(f"{base_url}/api/parties/ledger", headers=_hdr(admin_auth), timeout=30)
        row = next((p for p in r.json() if p["name"] == party), None)
        assert row is None or row["entries"] == 0, f"cancelled entry still in ledger: {row}"
        # cleanup
        assert _cancel(api_client, base_url, admin_auth, inw["id"], "TEST cleanup").status_code == 200

    def test_cancelled_excluded_from_party_statement(self, api_client, base_url, admin_auth):
        party = "TEST_CXL_STMT_PARTY_15"
        inw = _mk_inward(api_client, base_url, admin_auth, DIMS_F, 3, "TESTCX15F5")
        out = _mk_outward(api_client, base_url, admin_auth, DIMS_F, 3, "TESTCX15F6", party=party)
        assert _cancel(api_client, base_url, admin_auth, out["id"], "stmt test").status_code == 200

        r = api_client.post(f"{base_url}/api/reports/party-statement", headers=_hdr(admin_auth),
                            json={"party_name": party}, timeout=60)
        assert r.status_code == 404, f"expected 404 (no active entries), got {r.status_code}: {r.text}"
        assert "No entries" in r.json()["detail"]
        # cleanup
        assert _cancel(api_client, base_url, admin_auth, inw["id"], "TEST cleanup").status_code == 200

    def test_fifo_skips_cancelled_inward(self, api_client, base_url, admin_auth):
        inw1 = _mk_inward(api_client, base_url, admin_auth, DIMS_G, 5, "TESTCX15G1")
        inw2 = _mk_inward(api_client, base_url, admin_auth, DIMS_G, 5, "TESTCX15G2")
        assert _cancel(api_client, base_url, admin_auth, inw1["id"], "FIFO test").status_code == 200

        r = api_client.post(f"{base_url}/api/entries/outward", headers=_hdr(admin_auth), json={
            "vehicle_number": "TESTCX15G3", "broker_name": "TEST Broker", "remarks": "TEST_ITER15",
            "line_items": [{**DIMS_G, "pieces": 2}],
        }, timeout=30)
        assert r.status_code == 200, r.text
        out = r.json()
        assert out["source_entry_id"] == inw2["id"], \
            f"FIFO matched cancelled inward: {out['source_entry_id']} != {inw2['id']}"
        # cleanup
        assert _cancel(api_client, base_url, admin_auth, out["id"], "TEST cleanup").status_code == 200
        assert _cancel(api_client, base_url, admin_auth, inw2["id"], "TEST cleanup").status_code == 200

    def test_csv_export_keeps_cancelled_rows_with_status(self, api_client, base_url, admin_auth):
        inw = _mk_inward(api_client, base_url, admin_auth, DIMS_E, 2, "TESTCX15CSV")
        assert _cancel(api_client, base_url, admin_auth, inw["id"], "CSV audit test").status_code == 200

        r = api_client.get(f"{base_url}/api/entries.csv", headers=_hdr(admin_auth), timeout=60)
        assert r.status_code == 200, r.text[:300]
        lines = r.text.splitlines()
        header = lines[0]
        assert "Status" in header, f"Status column missing: {header}"
        row = next((ln for ln in lines if inw["entry_number"] in ln), None)
        assert row is not None, "cancelled entry missing from CSV export"
        assert row.rstrip().endswith(",cancelled") or '"cancelled"' in row or ",cancelled" in row, \
            f"cancelled status not in CSV row: {row}"


class TestMutationGuards:
    """Editing a cancelled entry is blocked; works again after restore."""

    def test_mutation_guards_and_restore_reenables(self, api_client, base_url, admin_auth):
        inw = _mk_inward(api_client, base_url, admin_auth, DIMS_D, 3, "TESTCX15M1")
        assert _cancel(api_client, base_url, admin_auth, inw["id"], "guard test").status_code == 200

        checks = [
            ("patch", f"/api/entries/{inw['id']}/correction", {"actual_weight_kg": 5000}),
            ("patch", f"/api/entries/{inw['id']}/office", {"invoice_no": "TEST-INV-15"}),
            ("patch", f"/api/entries/{inw['id']}/full-edit", {"remarks": "edit while cancelled"}),
            ("post", f"/api/entries/{inw['id']}/slip", {"slip_photo_path": "test/slip.jpg"}),
        ]
        for method, path, payload in checks:
            fn = api_client.patch if method == "patch" else api_client.post
            r = fn(f"{base_url}{path}", headers=_hdr(admin_auth), json=payload, timeout=30)
            assert r.status_code == 400, f"{path} on cancelled entry: expected 400, got {r.status_code}: {r.text}"
            assert "cancelled" in r.json()["detail"], f"unexpected message on {path}: {r.json()['detail']}"

        # restore → mutations work again
        assert _restore(api_client, base_url, admin_auth, inw["id"]).status_code == 200
        r = api_client.patch(f"{base_url}/api/entries/{inw['id']}/correction", headers=_hdr(admin_auth),
                             json={"actual_weight_kg": 5000}, timeout=30)
        assert r.status_code == 200, f"correction after restore failed: {r.status_code} {r.text}"
        assert r.json()["actual_weight_kg"] == 5000
        r = api_client.patch(f"{base_url}/api/entries/{inw['id']}/office", headers=_hdr(admin_auth),
                             json={"invoice_no": "TEST-INV-15"}, timeout=30)
        assert r.status_code == 200, f"office update after restore failed: {r.status_code} {r.text}"
        # cleanup
        assert _cancel(api_client, base_url, admin_auth, inw["id"], "TEST cleanup").status_code == 200
