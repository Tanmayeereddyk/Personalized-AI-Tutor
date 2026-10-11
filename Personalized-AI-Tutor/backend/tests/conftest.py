"""Shared test fixtures.

Supabase is replaced by FakeSupabase, so the whole test suite runs
offline — no real Supabase account, keys, or network needed.
"""

import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from supabase import AuthApiError

from app.api.dependencies import get_service_supabase, get_supabase
from app.main import app


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class FakeAuth:
    """Mimics the small part of Supabase Auth that the backend uses."""

    def __init__(self) -> None:
        self.users: dict[str, dict] = {}        # id -> user
        self.passwords: dict[str, str] = {}     # email -> password
        self.signed_out: list[str] = []         # revoked tokens
        self.require_email_confirmation = False
        self.admin = SimpleNamespace(sign_out=self._sign_out)

    def sign_up(self, credentials: dict) -> SimpleNamespace:
        email: str = credentials["email"]
        if email in self.passwords:
            raise AuthApiError("User already registered", 400, None)

        user_id = str(uuid.uuid4())
        user = {"id": user_id, "email": email}
        self.users[user_id] = user
        self.passwords[email] = credentials["password"]

        if self.require_email_confirmation:
            session = None  # Supabase returns no session until confirmed
        else:
            session = SimpleNamespace(
                access_token=f"token-{user_id}",
                token_type="bearer",
                refresh_token="refresh-x",
            )
        return SimpleNamespace(user=SimpleNamespace(**user), session=session)

    def sign_in_with_password(self, credentials: dict) -> SimpleNamespace:
        email: str = credentials["email"]
        if self.passwords.get(email) != credentials["password"]:
            raise AuthApiError("Invalid login credentials", 400, None)

        user = next(u for u in self.users.values() if u["email"] == email)
        session = SimpleNamespace(
            access_token=f"token-{user['id']}",
            token_type="bearer",
            refresh_token="refresh-x",
        )
        return SimpleNamespace(user=SimpleNamespace(**user), session=session)

    def get_user(self, jwt: str | None = None) -> SimpleNamespace | None:
        if not jwt or not jwt.startswith("token-"):
            raise AuthApiError("invalid JWT", 401, None)
        user_id = jwt.removeprefix("token-")
        if user_id not in self.users:
            raise AuthApiError("invalid JWT", 401, None)
        return SimpleNamespace(user=SimpleNamespace(**self.users[user_id]))

    def _sign_out(self, jwt: str, scope: str = "global") -> None:
        self.signed_out.append(jwt)


class FakeQuery:
    """Mimics the PostgREST query chain: filters run on execute()."""

    def __init__(self, rows: list[dict]) -> None:
        self._rows = rows
        self._op = "select"
        self._values: dict = {}
        self._filters: list[tuple[str, object]] = []
        self._single = False
        self._desc = False

    # -- builders -------------------------------------------------
    def select(self, *columns: str) -> "FakeQuery":
        return self

    def insert(self, values: dict) -> "FakeQuery":
        self._op, self._values = "insert", values
        return self

    def upsert(self, values: dict) -> "FakeQuery":
        self._op, self._values = "upsert", values
        return self

    def update(self, values: dict) -> "FakeQuery":
        self._op, self._values = "update", values
        return self

    def delete(self) -> "FakeQuery":
        self._op = "delete"
        return self

    def eq(self, column: str, value: object) -> "FakeQuery":
        self._filters.append((column, value))
        return self

    def order(self, column: str, desc: bool = False) -> "FakeQuery":
        self._desc = desc
        return self

    def maybe_single(self) -> "FakeQuery":
        self._single = True
        return self

    # -- execution ------------------------------------------------
    def _matches(self, row: dict) -> bool:
        return all(row.get(col) == val for col, val in self._filters)

    def execute(self) -> SimpleNamespace:
        if self._op == "insert":
            row = {
                "id": str(uuid.uuid4()),
                "created_at": _now(),
                "updated_at": _now(),
                **self._values,
            }
            self._rows.append(row)
            data: object = [row]

        elif self._op == "upsert":
            existing = next(
                (r for r in self._rows if r.get("id") == self._values.get("id")), None
            )
            if existing is not None:
                existing.update(self._values)
                data = [existing]
            else:
                row = {"created_at": _now(), "updated_at": _now(), **self._values}
                self._rows.append(row)
                data = [row]

        elif self._op == "update":
            matched = [r for r in self._rows if self._matches(r)]
            for row in matched:
                row.update(self._values)
                row["updated_at"] = _now()
            data = matched

        elif self._op == "delete":
            matched = [r for r in self._rows if self._matches(r)]
            for row in matched:
                self._rows.remove(row)
            data = matched

        else:  # select
            data = [dict(r) for r in self._rows if self._matches(r)]
            if self._desc:
                data.sort(key=lambda r: r.get("created_at") or "", reverse=True)

        if self._single:
            data = data[0] if data else None

        return SimpleNamespace(data=data)


class FakeSupabase:
    """One fake client standing in for both anon and service-role clients."""

    def __init__(self) -> None:
        self.auth = FakeAuth()
        self.tables: dict[str, list[dict]] = {}

    def table(self, name: str) -> FakeQuery:
        return FakeQuery(self.tables.setdefault(name, []))


def create_user(
    fake: FakeSupabase, email: str = "student@example.com", password: str = "password123"
) -> tuple[SimpleNamespace, dict[str, str]]:
    """Create a user directly in the fake and return (user, auth_headers)."""
    result = fake.auth.sign_up({"email": email, "password": password})
    headers = {"Authorization": f"Bearer token-{result.user.id}"}
    return result.user, headers


@pytest.fixture()
def fake_supabase() -> FakeSupabase:
    return FakeSupabase()


@pytest.fixture()
def client(fake_supabase: FakeSupabase):
    """Test client with Supabase replaced by the fake."""
    app.dependency_overrides[get_supabase] = lambda: fake_supabase
    app.dependency_overrides[get_service_supabase] = lambda: fake_supabase
    test_client = TestClient(app)
    yield test_client
    app.dependency_overrides.clear()


@pytest.fixture()
def logged_in_user(fake_supabase: FakeSupabase) -> tuple[SimpleNamespace, dict[str, str]]:
    """A ready-made user with valid Authorization headers."""
    return create_user(fake_supabase)
