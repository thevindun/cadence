import os
import sys
import tempfile
from pathlib import Path

import pytest

# Point DATA_DIR at a temp dir BEFORE db is imported, so tests never touch cadence.db.
_TMP = tempfile.mkdtemp(prefix="cadence-test-")
os.environ["DATA_DIR"] = _TMP
os.environ.pop("CADENCE_AUTH", None)
sys.path.insert(0, str(Path(__file__).parent.parent))


@pytest.fixture(autouse=True)
def fresh_db():
    """Wipe and re-create the schema before every test."""
    import db
    if db.DB_PATH.exists():
        db.DB_PATH.unlink()
    for suffix in ("-wal", "-shm"):
        p = Path(str(db.DB_PATH) + suffix)
        if p.exists():
            p.unlink()
    db.init_db()
    yield


@pytest.fixture
def client():
    from fastapi.testclient import TestClient
    import main
    with TestClient(main.app) as c:
        yield c