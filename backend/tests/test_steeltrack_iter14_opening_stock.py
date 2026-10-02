"""
Iteration 14 — Bulk Opening Stock tool (shared OpeningStockForm).
Backend: reuses POST /api/entries/inward with vehicle_number=OPENING-STOCK,
remarks 'Opening stock bulk load — N items', backdatable entry_date, all rows
as line_items. Verifies persistence, inventory aggregation, entries search,
and rejection of empty payloads.
"""
import re
import pytest
from datetime import datetime, timedelta, timezone
from tests.conftest import auth_headers, BASE_URL


# Unique dims unlikely to collide with real/test stock
ITEMS = [
    {"thickness_mm": 13, "width_mm": 1167, "length_mm": 4873, "pieces": 11, "grade": "TEST_IS2062"},
    {"thickness_mm": 17, "width_mm": 1333, "length_mm": 5111, "pieces": 7, "grade": None},
    {"thickness_mm": 23, "width_mm": 1499, "length_mm": 6333, "pieces": 5, "grade": "TEST_E350"},
]


def _find_group(inv, it):
    for g in inv:
        if (g["thickness_mm"] == it["thickness_mm"] and g["width_mm"] == it["width_mm"]
                and g["length_mm"] == it["length_mm"] and (g.get("grade") or None) == it["grade"]):
            return g
    return None


@pytest.fixture(scope="module")
def opening_entry(api_client, office_auth):
    """Create the opening-stock inward entry (backdated to yesterday) via office role."""
    yesterday = (datetime.now(timezone.utc) - timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    payload = {
        "vehicle_number": "OPENING-STOCK",
        "driver_name": None, "driver_phone": None, "mukadam_name": None,
        "line_items": ITEMS,
        "actual_weight_kg": None,
        "slip_photo_path": None,
        "remarks": f"TEST_ Opening stock bulk load — {len(ITEMS)} items",
        "entry_date": yesterday.isoformat(),
    }
    # inventory snapshot BEFORE
    inv_before = api_client.get(f"{BASE_URL}/api/inventory", headers=auth_headers(office_auth["token"])).json()

    r = api_client.post(f"{BASE_URL}/api/entries/inward", json=payload,
                        headers=auth_headers(office_auth["token"]))
    assert r.status_code == 200, f"create inward failed: {r.status_code} {r.text}"
    entry = r.json()

    inv_after = api_client.get(f"{BASE_URL}/api/inventory", headers=auth_headers(office_auth["token"])).json()
    return {"entry": entry, "inv_before": inv_before, "inv_after": inv_after, "yesterday": yesterday}


class TestOpeningStockEntry:
    def test_entry_number_format_inw(self, opening_entry):
        en = opening_entry["entry"]["entry_number"]
        assert re.match(r"^INW-\d{8}-\d{4}$", en), f"bad entry_number: {en}"

    def test_vehicle_number_opening_stock(self, opening_entry):
        assert opening_entry["entry"]["vehicle_number"] == "OPENING-STOCK"

    def test_remarks_bulk_load(self, opening_entry):
        assert "Opening stock bulk load" in (opening_entry["entry"]["remarks"] or "")

    def test_line_items_count_matches(self, opening_entry):
        lis = opening_entry["entry"]["line_items"]
        assert len(lis) == len(ITEMS)
        for li, src in zip(lis, ITEMS):
            assert li["thickness_mm"] == src["thickness_mm"]
            assert li["pieces"] == src["pieces"]
            assert (li.get("grade") or None) == src["grade"]
            assert li["theoretical_weight_kg"] > 0

    def test_total_pieces_is_sum(self, opening_entry):
        assert opening_entry["entry"]["pieces"] == sum(i["pieces"] for i in ITEMS)

    def test_entry_date_backdated_to_yesterday(self, opening_entry):
        ed = opening_entry["entry"]["entry_date"]
        stored = datetime.fromisoformat(ed.replace("Z", "+00:00"))
        assert stored.date() == opening_entry["yesterday"].date(), f"entry_date {stored} not backdated"

    def test_entry_persisted_get_by_id(self, api_client, office_auth, opening_entry):
        eid = opening_entry["entry"]["id"]
        r = api_client.get(f"{BASE_URL}/api/entries/{eid}", headers=auth_headers(office_auth["token"]))
        assert r.status_code == 200
        data = r.json()
        assert data["vehicle_number"] == "OPENING-STOCK"
        assert len(data["line_items"]) == len(ITEMS)

    def test_inventory_aggregation_includes_quantities(self, opening_entry):
        for it in ITEMS:
            before = _find_group(opening_entry["inv_before"], it)
            after = _find_group(opening_entry["inv_after"], it)
            assert after is not None, f"inventory group missing for {it}"
            b_pcs = before["pieces_available"] if before else 0
            assert after["pieces_available"] == b_pcs + it["pieces"], \
                f"pieces delta wrong for {it}: before={b_pcs} after={after['pieces_available']}"

    def test_entries_search_opening_finds_entry(self, api_client, office_auth, opening_entry):
        r = api_client.get(f"{BASE_URL}/api/entries", params={"search": "OPENING"},
                           headers=auth_headers(office_auth["token"]))
        assert r.status_code == 200
        nums = [e["entry_number"] for e in r.json()]
        assert opening_entry["entry"]["entry_number"] in nums, \
            f"search 'OPENING' did not return {opening_entry['entry']['entry_number']}"


class TestOpeningStockValidation:
    def test_zero_line_items_rejected(self, api_client, admin_auth):
        r = api_client.post(f"{BASE_URL}/api/entries/inward",
                            json={"vehicle_number": "OPENING-STOCK", "line_items": [],
                                  "remarks": "TEST_ empty"},
                            headers=auth_headers(admin_auth["token"]))
        assert r.status_code == 400, f"expected 400 got {r.status_code}"

    def test_all_roles_can_post_inward(self, api_client, labour_auth):
        """Labour retains generic inward permission (UI restricts opening-stock route)."""
        r = api_client.post(f"{BASE_URL}/api/entries/inward",
                            json={"vehicle_number": "TEST-LABOUR-INW",
                                  "line_items": [{"thickness_mm": 13, "width_mm": 1167,
                                                  "length_mm": 4873, "pieces": 1, "grade": "TEST_IS2062"}],
                                  "remarks": "TEST_ labour inward permission check"},
                            headers=auth_headers(labour_auth["token"]))
        assert r.status_code == 200
