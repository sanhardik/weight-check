import os
import pytest
import requests
from pathlib import Path
from dotenv import load_dotenv

# Load frontend .env to pick EXPO_PUBLIC_BACKEND_URL as the public base URL
load_dotenv(Path(__file__).resolve().parents[2] / "frontend" / ".env")

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    raise RuntimeError("EXPO_PUBLIC_BACKEND_URL not set in frontend/.env")


@pytest.fixture(scope="session")
def base_url():
    return BASE_URL


@pytest.fixture(scope="session")
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _login(session, email, password):
    r = session.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": email, "password": password},
        timeout=30,
    )
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    return r.json()


@pytest.fixture(scope="session")
def admin_auth(api_client):
    return _login(api_client, "admin@steeltrack.com", "admin123")


@pytest.fixture(scope="session")
def office_auth(api_client):
    return _login(api_client, "office@steeltrack.com", "office123")


@pytest.fixture(scope="session")
def labour_auth(api_client):
    return _login(api_client, "labour@steeltrack.com", "labour123")


def auth_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
