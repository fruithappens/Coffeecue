"""The running commit survives a rollback (S1-5)."""
from utils import build_info


def test_env_wins(monkeypatch, tmp_path):
    monkeypatch.setenv("RAILWAY_GIT_COMMIT_SHA", "abc1234def")
    assert build_info.commit() == "abc1234def"


def test_baked_file_when_env_missing(monkeypatch, tmp_path):
    monkeypatch.delenv("RAILWAY_GIT_COMMIT_SHA", raising=False)
    f = tmp_path / "BUILD_COMMIT"
    f.write_text("f34e082aaaa\n")
    monkeypatch.setattr(build_info, "_FILE", str(f))
    assert build_info.commit() == "f34e082aaaa"


def test_neither_is_none(monkeypatch, tmp_path):
    monkeypatch.delenv("RAILWAY_GIT_COMMIT_SHA", raising=False)
    monkeypatch.setattr(build_info, "_FILE", str(tmp_path / "missing"))
    assert build_info.commit() is None
    (tmp_path / "empty").write_text("\n")
    monkeypatch.setattr(build_info, "_FILE", str(tmp_path / "empty"))
    assert build_info.commit() is None
