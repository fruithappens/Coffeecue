#!/usr/bin/env python3
"""Tiny Railway GraphQL client for the fleet scripts.

    RAILWAY_API_TOKEN=... python scripts/railway_api.py query.graphql [vars.json]

Reads the token from the environment (never prints it), sends one query
or mutation, prints the JSON answer. Used by scripts/new_client.py and by
hand when building a client copy (docs/NEW_CLIENT_COPY.md).
"""
import json
import os
import sys
import urllib.error
import urllib.request

API = "https://backboard.railway.com/graphql/v2"


def _token_from_profile():
    """The token as saved in ~/.zshrc (export RAILWAY_API_TOKEN='...'), for
    shells started before it was added. Read, never printed."""
    try:
        for line in open(os.path.expanduser("~/.zshrc")):
            line = line.strip()
            if line.startswith("export RAILWAY_API_TOKEN="):
                return line.split("=", 1)[1].strip().strip("'\"")
    except OSError:
        pass
    return None


def call(query, variables=None, token=None):
    token = token or os.environ.get("RAILWAY_API_TOKEN") or _token_from_profile()
    if not token:
        raise SystemExit("RAILWAY_API_TOKEN is not set")
    req = urllib.request.Request(
        API,
        data=json.dumps({"query": query, "variables": variables or {}}).encode(),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json",
                 "User-Agent": "cupq-fleet/1"},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:  # GraphQL errors arrive as 400 with a JSON body
        try:
            return json.loads(e.read())
        except ValueError:
            return {"errors": [{"message": f"HTTP {e.code}"}]}


if __name__ == "__main__":
    q = open(sys.argv[1]).read()
    v = json.load(open(sys.argv[2])) if len(sys.argv) > 2 else None
    print(json.dumps(call(q, v), indent=2))
