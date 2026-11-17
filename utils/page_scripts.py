"""Fingerprints of the inline scripts CupQ's own pages carry (SEC-013 step 2).

The page rules no longer allow inline script in general. The built
index.html keeps two small inline scripts on purpose (the tab-title
branding and the blank-screen reporter, which must not be a separate file
because it reports that file failing to load). Each is allowed by its
SHA-256 fingerprint, read from the built pages themselves, so any other
inline script -- one slipped into a page -- is refused by the browser.

Read once per file change (cached by modification time), never per request.
"""

import base64
import glob
import hashlib
import os
import re

_INLINE = re.compile(r"<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>", re.S | re.I)
_cache = {}


def _hashes_for(path):
    try:
        mtime = os.path.getmtime(path)
    except OSError:
        return []
    hit = _cache.get(path)
    if hit and hit[0] == mtime:
        return hit[1]
    try:
        with open(path, encoding="utf-8") as f:
            text = f.read()
    except OSError:
        return []
    out = []
    for body in _INLINE.findall(text):
        digest = hashlib.sha256(body.encode("utf-8")).digest()
        out.append("'sha256-%s'" % base64.b64encode(digest).decode("ascii"))
    _cache[path] = (mtime, out)
    return out


def inline_script_hashes(static_folder):
    """Every inline-script fingerprint in the top-level built pages."""
    if not static_folder:
        return []
    seen = []
    for path in sorted(glob.glob(os.path.join(static_folder, "*.html"))):
        for h in _hashes_for(path):
            if h not in seen:
                seen.append(h)
    return seen
