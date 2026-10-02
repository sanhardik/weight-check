"""Iteration 11 — Office Portal + Tally Reminder backend tests.
Validates the new GET /api/parties/ledger endpoint:
- Admin & office roles return 200 with a list
- Labour role returns 403
- Each row has required fields (name/entries/pieces/weight/invoiced/pending_office/last_at/whatsapp*)
- Rows are sorted: pending_office>0 first, then by last_at desc
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://weight-check-30.preview.emergentagent.com").rstrip("/")


def _login(email: str, password: str) -> str:
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()["token"]


class TestPartiesLedger:
    @classmethod
    def setup_class(cls):
        cls.admin_tok = _login("admin@steeltrack.com", "admin123")
        cls.office_tok = _login("office@steeltrack.com", "office123")
        cls.labour_tok = _login("labour@steeltrack.com", "labour123")

    def test_ledger_admin_200(self):
        r = requests.get(f"{BASE_URL}/api/parties/ledger", headers={"Authorization": f"Bearer {self.admin_tok}"}, timeout=20)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)

    def test_ledger_office_200(self):
        r = requests.get(f"{BASE_URL}/api/parties/ledger", headers={"Authorization": f"Bearer {self.office_tok}"}, timeout=20)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_ledger_labour_403(self):
        r = requests.get(f"{BASE_URL}/api/parties/ledger", headers={"Authorization": f"Bearer {self.labour_tok}"}, timeout=20)
        assert r.status_code == 403

    def test_ledger_row_shape(self):
        r = requests.get(f"{BASE_URL}/api/parties/ledger", headers={"Authorization": f"Bearer {self.admin_tok}"}, timeout=20)
        data = r.json()
        assert len(data) > 0, "expected at least 1 party row"
        row = data[0]
        for k in ("name", "entries", "pieces", "weight", "invoiced", "pending_office", "last_at", "whatsapp", "whatsapp_digits"):
            assert k in row, f"missing field {k} in {row}"
        assert isinstance(row["name"], str)
        assert isinstance(row["entries"], int)
        assert isinstance(row["invoiced"], int)
        assert isinstance(row["pending_office"], int)

    def test_ledger_sorted_pending_first_then_last_at_desc(self):
        r = requests.get(f"{BASE_URL}/api/parties/ledger", headers={"Authorization": f"Bearer {self.admin_tok}"}, timeout=20)
        data = r.json()
        # Partition index: pending_office>0 rows must precede pending_office==0 rows
        seen_zero_pending = False
        for row in data:
            if row["pending_office"] == 0:
                seen_zero_pending = True
            else:
                assert not seen_zero_pending, f"row with pending_office>0 ({row['name']}) appears after a zero-pending row — sort broken"
        # Within pending>0 group: last_at descending (None treated as oldest)
        def _k(r):
            return r.get("last_at") or ""
        pending = [r for r in data if r["pending_office"] > 0]
        for i in range(len(pending) - 1):
            a, b = _k(pending[i]), _k(pending[i + 1])
            # strings sort lexicographically — ISO timestamps are safe
            assert a >= b, f"pending group not sorted desc: {pending[i]['name']}({a}) < {pending[i+1]['name']}({b})"

    def test_ledger_no_auth_401_or_403(self):
        r = requests.get(f"{BASE_URL}/api/parties/ledger", timeout=20)
        assert r.status_code in (401, 403)
