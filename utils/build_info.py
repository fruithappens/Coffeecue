"""Which commit this server is running (roadmap S1-5).

Railway sets RAILWAY_GIT_COMMIT_SHA on a normal deploy but NOT when a
deployment is rolled back (that reuses an old image with fresh settings),
so /api/app-version reported null after the first rollback drill. The
Dockerfile now also writes the commit into the image as BUILD_COMMIT,
which travels with the image through any rollback.
"""
import os

_FILE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "BUILD_COMMIT"
)


def commit():
    """Full commit sha, or None if neither source has one (a laptop copy)."""
    env = (os.environ.get("RAILWAY_GIT_COMMIT_SHA") or "").strip()
    if env:
        return env
    try:
        with open(_FILE) as f:
            baked = f.read().strip()
        return baked or None
    except OSError:
        return None
