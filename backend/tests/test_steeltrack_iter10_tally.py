"""
Iteration 10 feature tests — SteelTrack / Hemant Enterprise
Feature A: Daily Physical Tally + Admin Full Edit

Coverage (single class — pytest xdist --dist loadscope pins a class to one worker,
so methods run sequentially in file order; class-level state chains the flow):
  - GET /api/verifications/today: auto-creates exactly 2 tasks/day, idempotent,
    system_pieces snapshot + group_label present, snapshot matches live stock
  - POST /api/verifications/assign: admin replaces pending tasks, >2 -> 400,
    office/labour -> 403
  - POST /api/verifications/{task_id}/submit: empty photo_path -> 400, match ->
    matched=True, mismatch -> matched=False + discrepancy, resubmit -> 400,
    inventory_meta last_verified_at/by updated (visible via GET /api/inventory)
  - POST /api/verifications/{id}/review: approve, reject, apply_correction
    (negative discrepancy creates outward adjustment entry reducing stock exactly),
    second review -> 400, office/labour -> 403
  - GET /api/verifications/history: admin/office OK with pending_review, labour 403
  - PATCH /api/entries/{id}/full-edit: scalar edits + WAS->NOW history, line_items
    replacement recomputes pieces + theoretical weight + variance, outward stock
    guardrail 400, office/labour 403
"""
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

import pytest
import requests
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv(Path(__file__).resolve().parents[2] / "frontend" / ".env")
load_dotenv(Path(__file__).resolve().parents[2] / "backend" / ".env")
BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")

RUN = uuid.uuid4().hex[:6].upper()
GRADE = f"TEST_IT10-{RUN}"


def _h(auth):
    return {"Authorization": f"Bearer {auth['token']}", "Content-Type": "application/json"}


def _login(email, password):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"login failed for {email}: {r.text}"
    return r.json()


def _today(auth):
    r = requests.get(f"{BASE_URL}/api/verifications/today", headers=_h(auth), timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


def _stock_groups(auth):
    r = requests.get(f"{BASE_URL}/api/inventory", headers=_h(auth), timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


class TestIter10TallyAndFullEdit:
    """Full sequential E2E for Daily Tally + Admin Full Edit (single xdist scope)."""

    @pytest.fixture(scope="class")
    def admin_auth(self):
        return _login("admin@steeltrack.com", "admin123")

    @pytest.fixture(scope="class")
    def office_auth(self):
        return _login("office@steeltrack.com", "office123")

    @pytest.fixture(scope="class")
    def labour_auth(self):
        return _login("labour@steeltrack.com", "labour123")

    @pytest.fixture(scope="class", autouse=True)
    def reset_today_tasks(self, admin_auth):
        """Delete today's tasks so the flow starts from fresh auto-picks
        (earlier manual/curl runs may have already submitted today's tasks and
        assign cannot add pending tasks once 2 submitted ones are kept).
        Verification history rows are preserved."""
        d = _today(admin_auth)
        today = d["date"]
        mc = MongoClient(os.environ["MONGO_URL"])
        db = mc[os.environ["DB_NAME"]]
        db.verification_tasks.delete_many({"date": today})
        mc.close()
        self.__class__.today = today
        yield

    # ---------------- today: auto-create + idempotency ----------------

    def test_01_auto_creates_exactly_two_tasks_with_snapshot(self, labour_auth):
        d = _today(labour_auth)
        assert d["total"] == 2, f"expected 2 tasks, got {d['total']}"
        assert len(d["tasks"]) == 2
        assert d["done"] == 0
        for t in d["tasks"]:
            assert t["status"] == "pending"
            assert t["assigned_by"] == "system"
            assert t["system_pieces"] is not None and t["system_pieces"] > 0
            assert t["group_label"], "group_label missing"
            assert t["verification"] is None

    def test_02_second_call_idempotent_same_task_ids(self, labour_auth):
        d1 = _today(labour_auth)
        d2 = _today(labour_auth)
        assert sorted(t["id"] for t in d1["tasks"]) == sorted(t["id"] for t in d2["tasks"])
        assert d2["total"] == 2

    def test_03_tasks_match_live_stock(self, admin_auth):
        d = _today(admin_auth)
        inv = _stock_groups(admin_auth)
        stock = {(g["thickness_mm"], g["width_mm"], g["length_mm"], g.get("grade")): g["pieces_available"] for g in inv}
        for t in d["tasks"]:
            g = t["group"]
            key = (g["thickness_mm"], g["width_mm"], g["length_mm"], g.get("grade"))
            assert key in stock, f"task group {key} has no stock"
            assert abs(stock[key] - t["system_pieces"]) < 1e-9, "system_pieces snapshot != live stock"

    # ---------------- assign ----------------

    def test_04_assign_office_forbidden(self, office_auth):
        r = requests.post(f"{BASE_URL}/api/verifications/assign",
                          json={"groups": [{"thickness_mm": 1, "width_mm": 1, "length_mm": 1}]},
                          headers=_h(office_auth), timeout=30)
        assert r.status_code == 403, r.text

    def test_05_assign_labour_forbidden(self, labour_auth):
        r = requests.post(f"{BASE_URL}/api/verifications/assign",
                          json={"groups": [{"thickness_mm": 1, "width_mm": 1, "length_mm": 1}]},
                          headers=_h(labour_auth), timeout=30)
        assert r.status_code == 403, r.text

    def test_06_assign_more_than_two_rejected_400(self, admin_auth):
        r = requests.post(f"{BASE_URL}/api/verifications/assign",
                          json={"groups": [
                              {"thickness_mm": 1, "width_mm": 1, "length_mm": 1},
                              {"thickness_mm": 2, "width_mm": 1, "length_mm": 1},
                              {"thickness_mm": 3, "width_mm": 1, "length_mm": 1},
                          ]}, headers=_h(admin_auth), timeout=30)
        assert r.status_code == 400, r.text

    def test_07_admin_assign_replaces_pending_tasks(self, admin_auth):
        inv = _stock_groups(admin_auth)
        assert len(inv) >= 2, "need at least 2 stock groups to assign"
        picks = [
            {"thickness_mm": inv[0]["thickness_mm"], "width_mm": inv[0]["width_mm"],
             "length_mm": inv[0]["length_mm"], "grade": inv[0].get("grade"),
             "pcs": inv[0]["pieces_available"]},
            {"thickness_mm": inv[1]["thickness_mm"], "width_mm": inv[1]["width_mm"],
             "length_mm": inv[1]["length_mm"], "grade": inv[1].get("grade"),
             "pcs": inv[1]["pieces_available"]},
        ]
        r = requests.post(f"{BASE_URL}/api/verifications/assign",
                          json={"groups": [{k: v for k, v in p.items() if k != "pcs"} for p in picks]},
                          headers=_h(admin_auth), timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["total"] == 2
        assert all(t["status"] == "pending" for t in d["tasks"])
        assert all(t["assigned_by"] == "admin" for t in d["tasks"]), "assigned tasks must be marked admin"
        by_label = {t["group_label"]: t for t in d["tasks"]}
        for p in picks:
            lbl = f"{p['thickness_mm']}×{p['width_mm']}×{p['length_mm']}" + (f" · {p['grade']}" if p.get("grade") else "")
            assert lbl in by_label, f"assigned group {lbl} not in today's tasks"
            assert abs(by_label[lbl]["system_pieces"] - p["pcs"]) < 1e-9

    # ---------------- submit ----------------

    def test_08_submit_empty_photo_path_400(self, labour_auth):
        d = _today(labour_auth)
        pending = [t for t in d["tasks"] if t["status"] == "pending"]
        assert pending, "no pending task to test photo validation"
        r = requests.post(f"{BASE_URL}/api/verifications/{pending[0]['id']}/submit",
                          json={"physical_pieces": 1, "photo_path": ""}, headers=_h(labour_auth), timeout=30)
        assert r.status_code == 400, r.text
        assert "photo" in r.json()["detail"].lower()

    def test_09_submit_unknown_task_404(self, labour_auth):
        r = requests.post(f"{BASE_URL}/api/verifications/{uuid.uuid4()}/submit",
                          json={"physical_pieces": 1, "photo_path": "x.jpg"}, headers=_h(labour_auth), timeout=30)
        assert r.status_code == 404, r.text

    def test_10_match_submission(self, labour_auth):
        d = _today(labour_auth)
        t0 = [t for t in d["tasks"] if t["status"] == "pending"][0]
        self.__class__.task0 = t0
        r = requests.post(f"{BASE_URL}/api/verifications/{t0['id']}/submit",
                          json={"physical_pieces": t0["system_pieces"], "photo_path": "test/it10_match.jpg",
                                "note": "TEST_IT10 all good"},
                          headers=_h(labour_auth), timeout=30)
        assert r.status_code == 200, r.text
        v = r.json()
        self.__class__.v_match = v
        assert v["matched"] is True
        assert abs(v["discrepancy_pieces"]) < 1e-9
        assert v["system_pieces"] == t0["system_pieces"], "system pieces revealed after submit"
        assert v["physical_pieces"] == t0["system_pieces"]
        assert v["status"] == "submitted"
        assert v["verified_by_name"], "verified_by_name missing"

    def test_11_mismatch_submission_has_discrepancy(self, labour_auth):
        d = _today(labour_auth)
        t1 = [t for t in d["tasks"] if t["status"] == "pending"][0]
        self.__class__.task1 = t1
        r = requests.post(f"{BASE_URL}/api/verifications/{t1['id']}/submit",
                          json={"physical_pieces": t1["system_pieces"] - 1, "photo_path": "test/it10_mismatch.jpg"},
                          headers=_h(labour_auth), timeout=30)
        assert r.status_code == 200, r.text
        v = r.json()
        self.__class__.v_mismatch = v
        assert v["matched"] is False
        assert v["discrepancy_pieces"] == -1
        assert v["physical_pieces"] == t1["system_pieces"] - 1

    def test_12_resubmit_rejected_400(self, labour_auth):
        r = requests.post(f"{BASE_URL}/api/verifications/{self.__class__.task0['id']}/submit",
                          json={"physical_pieces": 1, "photo_path": "x.jpg"}, headers=_h(labour_auth), timeout=30)
        assert r.status_code == 400, r.text

    def test_13_today_shows_done_2_of_2(self, admin_auth):
        d = _today(admin_auth)
        assert d["done"] == 2 and d["total"] == 2
        for t in d["tasks"]:
            assert t["status"] == "submitted"
            assert t["verification"] is not None

    def test_14_inventory_meta_last_verified_updated(self, admin_auth):
        inv = _stock_groups(admin_auth)
        by_key = {(g["thickness_mm"], g["width_mm"], g["length_mm"], g.get("grade")): g for g in inv}
        for t in (self.__class__.task0, self.__class__.task1):
            g = t["group"]
            grp = by_key.get((g["thickness_mm"], g["width_mm"], g["length_mm"], g.get("grade")))
            assert grp is not None
            assert grp.get("last_verified_at"), f"last_verified_at missing for {t['group_label']}"
            assert grp.get("last_verified_by"), f"last_verified_by missing for {t['group_label']}"

    # ---------------- review ----------------

    def test_15_review_office_forbidden(self, office_auth):
        r = requests.post(f"{BASE_URL}/api/verifications/{self.__class__.v_match['id']}/review",
                          json={"action": "approve"}, headers=_h(office_auth), timeout=30)
        assert r.status_code == 403, r.text

    def test_16_review_labour_forbidden(self, labour_auth):
        r = requests.post(f"{BASE_URL}/api/verifications/{self.__class__.v_match['id']}/review",
                          json={"action": "approve"}, headers=_h(labour_auth), timeout=30)
        assert r.status_code == 403, r.text

    def test_17_approve_matched(self, admin_auth):
        r = requests.post(f"{BASE_URL}/api/verifications/{self.__class__.v_match['id']}/review",
                          json={"action": "approve", "note": "TEST_IT10 ok"}, headers=_h(admin_auth), timeout=30)
        assert r.status_code == 200, r.text
        v = r.json()
        assert v["status"] == "approved"
        assert v["review_note"] == "TEST_IT10 ok"

    def test_18_apply_correction_creates_outward_entry_and_reduces_stock(self, admin_auth):
        v = self.__class__.v_mismatch
        g = v["group"]
        key = (g["thickness_mm"], g["width_mm"], g["length_mm"], g.get("grade"))

        def stock_of():
            inv = _stock_groups(admin_auth)
            for grp in inv:
                if (grp["thickness_mm"], grp["width_mm"], grp["length_mm"], grp.get("grade")) == key:
                    return grp["pieces_available"]
            return 0.0

        before = stock_of()
        r = requests.post(f"{BASE_URL}/api/verifications/{v['id']}/review",
                          json={"action": "apply_correction", "note": "TEST_IT10 short by 1"},
                          headers=_h(admin_auth), timeout=30)
        assert r.status_code == 200, r.text
        v2 = r.json()
        assert v2["status"] == "correction_applied"
        assert v2["correction_entry_number"], "correction entry number missing"
        assert v2["correction_entry_number"].startswith("OUT-"), \
            f"expected outward entry, got {v2['correction_entry_number']}"
        assert v2["correction_entry_id"]
        assert stock_of() == before - 1, "stock must drop exactly by discrepancy"
        e = requests.get(f"{BASE_URL}/api/entries/{v2['correction_entry_id']}", headers=_h(admin_auth), timeout=30)
        assert e.status_code == 200, e.text
        ed = e.json()
        assert ed["direction"] == "outward"
        assert ed["vehicle_number"] == "PHYSICAL-TALLY"
        assert ed["broker_name"] == "Stock Correction"
        assert ed["pieces"] == 1

    def test_19_second_review_rejected_400(self, admin_auth):
        vid = self.__class__.v_match["id"]
        r = requests.post(f"{BASE_URL}/api/verifications/{vid}/review",
                          json={"action": "reject"}, headers=_h(admin_auth), timeout=30)
        assert r.status_code == 400, r.text

    def test_20_review_unknown_404(self, admin_auth):
        r = requests.post(f"{BASE_URL}/api/verifications/{uuid.uuid4()}/review",
                          json={"action": "approve"}, headers=_h(admin_auth), timeout=30)
        assert r.status_code == 404, r.text

    def test_21_reject_path(self, admin_auth, labour_auth):
        """Insert an extra pending task directly (2/day API cap) -> submit mismatch -> reject."""
        inv = _stock_groups(admin_auth)
        g = inv[0]
        task = {
            "id": str(uuid.uuid4()), "date": self.__class__.today,
            "group": {"thickness_mm": g["thickness_mm"], "width_mm": g["width_mm"],
                      "length_mm": g["length_mm"], "grade": g.get("grade")},
            "system_pieces": g["pieces_available"], "assigned_by": "admin",
            "status": "pending", "created_at": datetime.now(timezone.utc),
        }
        mc = MongoClient(os.environ["MONGO_URL"])
        db = mc[os.environ["DB_NAME"]]
        db.verification_tasks.insert_one(task.copy())
        mc.close()
        rs = requests.post(f"{BASE_URL}/api/verifications/{task['id']}/submit",
                           json={"physical_pieces": g["pieces_available"] - 1, "photo_path": "test/it10_reject.jpg"},
                           headers=_h(labour_auth), timeout=30)
        assert rs.status_code == 200, rs.text
        v = rs.json()
        assert v["matched"] is False
        rr = requests.post(f"{BASE_URL}/api/verifications/{v['id']}/review",
                           json={"action": "reject", "note": "TEST_IT10 recount needed"},
                           headers=_h(admin_auth), timeout=30)
        assert rr.status_code == 200, rr.text
        assert rr.json()["status"] == "rejected"
        assert rr.json()["review_note"] == "TEST_IT10 recount needed"

    # ---------------- history ----------------

    def test_22_history_admin(self, admin_auth):
        r = requests.get(f"{BASE_URL}/api/verifications/history", headers=_h(admin_auth), timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "items" in d and "pending_review" in d
        assert len(d["items"]) >= 2
        assert isinstance(d["pending_review"], int)
        item = d["items"][0]
        for f in ("group_label", "system_pieces", "physical_pieces", "discrepancy_pieces",
                  "matched", "status", "verified_by_name"):
            assert f in item, f"history item missing {f}"

    def test_23_history_office_allowed(self, office_auth):
        r = requests.get(f"{BASE_URL}/api/verifications/history", headers=_h(office_auth), timeout=30)
        assert r.status_code == 200, r.text

    def test_24_history_labour_forbidden(self, labour_auth):
        r = requests.get(f"{BASE_URL}/api/verifications/history", headers=_h(labour_auth), timeout=30)
        assert r.status_code == 403, r.text

    # ---------------- admin full edit ----------------

    def test_25_setup_entries(self, labour_auth):
        li = [{"thickness_mm": 11, "width_mm": 1250, "length_mm": 2500, "pieces": 5, "grade": GRADE}]
        ri = requests.post(f"{BASE_URL}/api/entries/inward",
                           json={"line_items": li, "vehicle_number": f"MH{RUN[:2]}IT1001",
                                 "actual_weight_kg": 5000, "remarks": f"TEST_IT10 {RUN}"},
                           headers=_h(labour_auth), timeout=30)
        assert ri.status_code in (200, 201), ri.text
        li2 = [{"thickness_mm": 11, "width_mm": 1250, "length_mm": 2500, "pieces": 2, "grade": GRADE}]
        ro = requests.post(f"{BASE_URL}/api/entries/outward",
                           json={"line_items": li2, "vehicle_number": f"MH{RUN[:2]}IT1002",
                                 "broker_name": f"TEST_BRK_{RUN}", "actual_weight_kg": 2000},
                           headers=_h(labour_auth), timeout=30)
        assert ro.status_code in (200, 201), ro.text
        self.__class__.inward = ri.json()
        self.__class__.outward = ro.json()

    def test_26_full_edit_office_forbidden(self, office_auth):
        r = requests.patch(f"{BASE_URL}/api/entries/{self.__class__.inward['id']}/full-edit",
                           json={"remarks": "office hack"}, headers=_h(office_auth), timeout=30)
        assert r.status_code == 403, r.text

    def test_27_full_edit_labour_forbidden(self, labour_auth):
        r = requests.patch(f"{BASE_URL}/api/entries/{self.__class__.inward['id']}/full-edit",
                           json={"remarks": "labour hack"}, headers=_h(labour_auth), timeout=30)
        assert r.status_code == 403, r.text

    def test_28_scalar_edits_persist_and_audit_logged(self, admin_auth):
        eid = self.__class__.inward["id"]
        r = requests.patch(f"{BASE_URL}/api/entries/{eid}/full-edit",
                           json={"vehicle_number": f"GJ{RUN[:2]}ZZ9999", "broker_name": f"TEST_BRK_{RUN}",
                                 "mukadam_name": f"TEST_MUK_{RUN}", "remarks": f"TEST_IT10 edited {RUN}",
                                 "actual_weight_kg": 5100},
                           headers=_h(admin_auth), timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["vehicle_number"] == f"GJ{RUN[:2]}ZZ9999"
        assert d["broker_name"] == f"TEST_BRK_{RUN}"
        assert d["mukadam_name"] == f"TEST_MUK_{RUN}"
        assert d["remarks"] == f"TEST_IT10 edited {RUN}"
        assert d["actual_weight_kg"] == 5100
        g = requests.get(f"{BASE_URL}/api/entries/{eid}", headers=_h(admin_auth), timeout=30)
        assert g.status_code == 200, g.text
        gd = g.json()
        assert gd["vehicle_number"] == f"GJ{RUN[:2]}ZZ9999"
        hist = gd.get("history") or []
        by_field = {}
        for h in hist:
            by_field.setdefault(h["field"], h)
        for f, newv in [("vehicle_number", f"GJ{RUN[:2]}ZZ9999"), ("broker_name", f"TEST_BRK_{RUN}"),
                        ("mukadam_name", f"TEST_MUK_{RUN}"), ("actual_weight_kg", 5100)]:
            assert f in by_field, f"history missing change for {f}"
            got = by_field[f]["new"]
            assert (float(got) == float(newv)) if isinstance(newv, (int, float)) else (str(got) == str(newv))
            assert by_field[f]["by_role"] == "admin"
        assert by_field["vehicle_number"]["old"] == f"MH{RUN[:2]}IT1001", "WAS value incorrect"

    def test_29_line_items_replacement_recomputes(self, admin_auth):
        eid = self.__class__.inward["id"]
        new_items = [{"thickness_mm": 12, "width_mm": 1250, "length_mm": 2500, "pieces": 4, "grade": GRADE},
                     {"thickness_mm": 12, "width_mm": 1500, "length_mm": 3000, "pieces": 3, "grade": GRADE}]
        r = requests.patch(f"{BASE_URL}/api/entries/{eid}/full-edit",
                           json={"line_items": new_items}, headers=_h(admin_auth), timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["pieces"] == 7
        assert len(d["line_items"]) == 2
        expected_tw = sum(i["theoretical_weight_kg"] for i in d["line_items"])
        assert abs(d["theoretical_weight_kg"] - expected_tw) < 0.01
        # steel density 7.85 g/cm3: mm^3 -> kg = t*w*l*pieces*7.85/1e6
        exp0 = 12 * 1250 * 2500 * 4 * 7.85 / 1e6
        assert abs(d["line_items"][0]["theoretical_weight_kg"] - exp0) < 0.5
        assert d["variance_pct"] is not None, "variance must be recomputed after line edit"
        g = requests.get(f"{BASE_URL}/api/entries/{eid}", headers=_h(admin_auth), timeout=30).json()
        assert g["pieces"] == 7
        assert any(h["field"] == "line_items" for h in (g.get("history") or []))

    def test_30_outward_line_items_stock_guardrail_400(self, admin_auth):
        eid = self.__class__.outward["id"]
        r = requests.patch(f"{BASE_URL}/api/entries/{eid}/full-edit",
                           json={"line_items": [{"thickness_mm": 11, "width_mm": 1250, "length_mm": 2500,
                                                 "pieces": 9999, "grade": GRADE}]},
                           headers=_h(admin_auth), timeout=30)
        assert r.status_code == 400, r.text
        assert "STOCK" in r.json()["detail"].upper()

    def test_31_outward_line_items_within_stock_ok(self, admin_auth):
        # inward was re-dimensioned in test_29, so restore inward lines first,
        # then edit outward to 3 pcs (avail excluding this outward = 5 in - 0 = 5).
        rid = self.__class__.inward["id"]
        r0 = requests.patch(f"{BASE_URL}/api/entries/{rid}/full-edit",
                            json={"line_items": [{"thickness_mm": 11, "width_mm": 1250, "length_mm": 2500,
                                                  "pieces": 5, "grade": GRADE}]},
                            headers=_h(admin_auth), timeout=30)
        assert r0.status_code == 200, r0.text
        eid = self.__class__.outward["id"]
        r = requests.patch(f"{BASE_URL}/api/entries/{eid}/full-edit",
                           json={"line_items": [{"thickness_mm": 11, "width_mm": 1250, "length_mm": 2500,
                                                 "pieces": 3, "grade": GRADE}]},
                           headers=_h(admin_auth), timeout=30)
        assert r.status_code == 200, r.text
        assert r.json()["pieces"] == 3

    def test_32_empty_edit_400(self, admin_auth):
        r = requests.patch(f"{BASE_URL}/api/entries/{self.__class__.inward['id']}/full-edit",
                           json={}, headers=_h(admin_auth), timeout=30)
        assert r.status_code == 400, r.text

    def test_33_full_edit_unknown_entry_404(self, admin_auth):
        r = requests.patch(f"{BASE_URL}/api/entries/{uuid.uuid4()}/full-edit",
                           json={"remarks": "x"}, headers=_h(admin_auth), timeout=30)
        assert r.status_code == 404, r.text
