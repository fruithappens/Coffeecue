#!/usr/bin/env python3
"""Build, park, wake and list CupQ client copies (roadmap C3-4, C3-8).

    python scripts/new_client.py <slug> --apply [--region sg|us|eu] [--demo]
                                         [--event-name ...] [--event-file ...]
    python scripts/fleet_apply.py park <slug>     stop its web server (~$1.70/month parked)
    python scripts/fleet_apply.py wake <slug>     start it again
    python scripts/fleet_apply.py list            every copy: region, web state, address

The build is the twelve steps of docs/NEW_CLIENT_COPY.md as one command.
Each step records what it made in ~/cupq-fleet/<slug>.json (ids only, no
secrets), so a run that stops part-way picks up where it left off when
it's run again; nothing is created twice.

What it never does: delete anything, buy a text number, or touch an
existing copy other than adding the new one to cupq.app's fleet board.

Tokens are read from ~/.zshrc (RAILWAY_API_TOKEN, CLOUDFLARE_API_TOKEN)
and never printed. The first admin's password goes straight from the
deploy log into ~/cupq-demo-events/<host>-admin.txt (chmod 600).
"""
from __future__ import annotations

import json
import os
import re
import secrets
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from railway_api import call  # noqa: E402

REPO = "fruithappens/Coffeecue"
DOMAIN = "cupq.app"
STATE_DIR = Path.home() / "cupq-fleet"
ADMIN_DIR = Path.home() / "cupq-demo-events"
REGIONS = {
    "sg": "asia-southeast1-eqsg3a",  # Singapore: closest Railway region to Australia
    "us": "us-west2",
    "eu": "europe-west4-drams3a",
}
# The live copy: its fleet token is shared with every new copy, and its
# fleet board lists them (FLEET_COPIES).
LIVE = {
    "project": "1b1cd06b-5e5c-4f0a-a995-17ba21d9096a",
    "env": "a5fe4ee3-a319-45c9-a75b-e3efec261a2f",
    "web": "bfffe2df-3c0a-4ffd-be65-9d717847737a",
}
POSTGRES_TEMPLATE = "postgres"
WEB_PORT = 8080


# --- small helpers -----------------------------------------------------------
def say(msg):
    print(f"{time.strftime('%H:%M:%S')}  {msg}", flush=True)


def gql(query, variables=None):
    r = call(query, variables)
    if r.get("errors"):
        raise RuntimeError("; ".join(e.get("message", "?") for e in r["errors"]))
    return r["data"]


def _profile_token(name):
    try:
        for line in open(os.path.expanduser("~/.zshrc")):
            line = line.strip()
            if line.startswith(f"export {name}="):
                return line.split("=", 1)[1].strip().strip("'\"")
    except OSError:
        pass
    return None


def http(method, url, body=None, headers=None, timeout=30):
    req = urllib.request.Request(
        url, method=method, data=json.dumps(body).encode() if body is not None else None,
        headers={"Content-Type": "application/json", "User-Agent": "cupq-fleet/1", **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read()
            return r.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read() or b"{}")
        except ValueError:
            return e.code, {}
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        return 0, {"error": str(e)[:120]}


def cloudflare(method, path, body=None):
    tok = os.environ.get("CLOUDFLARE_API_TOKEN") or _profile_token("CLOUDFLARE_API_TOKEN")
    if not tok:
        raise RuntimeError("CLOUDFLARE_API_TOKEN is not set")
    status, data = http(method, "https://api.cloudflare.com/client/v4" + path, body,
                        {"Authorization": "Bearer " + tok})
    if not data.get("success"):
        raise RuntimeError(f"Cloudflare {method} {path}: {data.get('errors') or status}")
    return data["result"]


class State:
    """What this copy's build has made so far: ~/cupq-fleet/<slug>.json."""

    def __init__(self, slug):
        STATE_DIR.mkdir(mode=0o700, exist_ok=True)
        self.path = STATE_DIR / f"{slug}.json"
        self.d = json.loads(self.path.read_text()) if self.path.exists() else {"slug": slug}

    def __getitem__(self, k):
        return self.d.get(k)

    def set(self, **kw):
        self.d.update(kw)
        old = os.umask(0o077)
        try:
            self.path.write_text(json.dumps(self.d, indent=2))
        finally:
            os.umask(old)


def wait_deploy(service, env, label, minutes=12):
    q = ("query($s: String!, $e: String!) { serviceInstance(serviceId: $s, environmentId: $e) "
         "{ latestDeployment { id status } } }")
    last = None
    for _ in range(minutes * 3):
        dep = (gql(q, {"s": service, "e": env})["serviceInstance"] or {}).get("latestDeployment") or {}
        if dep.get("status") != last:
            say(f"   {label}: {dep.get('status')}")
            last = dep.get("status")
        if dep.get("status") == "SUCCESS":
            return dep["id"]
        if dep.get("status") in ("FAILED", "CRASHED", "REMOVED"):
            raise RuntimeError(f"{label} deploy {dep.get('status')}")
        time.sleep(20)
    raise RuntimeError(f"{label} deploy still not done after {minutes} minutes")


def services(project):
    d = gql("query($p: String!) { project(id: $p) { services { edges { node { id name } } } } }", {"p": project})
    return {e["node"]["name"]: e["node"]["id"] for e in d["project"]["services"]["edges"]}


def volume_regions(project):
    d = gql("""query($p: String!) { project(id: $p) { volumes { edges { node { name
        volumeInstances { edges { node { region mountPath serviceId state } } } } } } } }""", {"p": project})
    out = []
    for v in d["project"]["volumes"]["edges"]:
        for vi in v["node"]["volumeInstances"]["edges"]:
            out.append(vi["node"])
    return out


def set_region(service, env, region):
    gql("mutation($s: String!, $e: String!, $i: ServiceInstanceUpdateInput!) "
        "{ serviceInstanceUpdate(serviceId: $s, environmentId: $e, input: $i) }",
        {"s": service, "e": env, "i": {"multiRegionConfig": {region: {"numReplicas": 1}}}})


def live_variables():
    return gql("query($p: String!, $e: String!, $s: String!) { variables(projectId: $p, environmentId: $e, serviceId: $s) }",
               {"p": LIVE["project"], "e": LIVE["env"], "s": LIVE["web"]})["variables"]


def upsert_vars(project, env, service, variables, skip_deploys=False):
    gql("mutation($i: VariableCollectionUpsertInput!) { variableCollectionUpsert(input: $i) }",
        {"i": {"projectId": project, "environmentId": env, "serviceId": service,
               "variables": variables, "skipDeploys": skip_deploys}})


def fleet_token():
    """The fleet's shared token: cupq.app's, made once if it has none.

    Setting it on cupq.app restarts it (about a second, measured in the
    drills), so it's only ever done when it's missing and no event is on.
    """
    tok = live_variables().get("FLEET_STATUS_TOKEN")
    if tok:
        return tok
    status, fr = http("GET", f"https://{DOMAIN}/api/public/release-freeze")
    if status != 200 or fr.get("frozen"):
        raise RuntimeError("cupq.app has no fleet token and is mid-event (or unreachable): try after the event")
    tok = secrets.token_urlsafe(32)
    upsert_vars(LIVE["project"], LIVE["env"], LIVE["web"], {"FLEET_STATUS_TOKEN": tok})
    say("   fleet token made and set on cupq.app")
    return tok


def add_to_fleet_board(name, url):
    """cupq.app's FLEET_COPIES list (read by System > Fleet beside the saved list)."""
    v = live_variables()
    try:
        copies = json.loads(v.get("FLEET_COPIES") or "[]")
    except ValueError:
        copies = []
    if any(c.get("url") == url for c in copies if isinstance(c, dict)):
        return False
    copies.append({"name": name, "url": url})
    # skipDeploys: no restart of cupq.app for this; the board picks it up
    # at cupq.app's next deploy (every merge).
    upsert_vars(LIVE["project"], LIVE["env"], LIVE["web"], {"FLEET_COPIES": json.dumps(copies)}, skip_deploys=True)
    return True


# --- the build ---------------------------------------------------------------
def build(slug, event_name, region_key="sg", demo=False, event_file=None):
    region = REGIONS[region_key]
    host = f"{slug}.{DOMAIN}"
    st = State(slug)
    say(f"Building {host} in {region} ({'demo: texts off' if demo else 'texts ON once a number is added'})")
    say(f"   record of this build: {st.path}")

    # 1. Project
    if not st["project"]:
        ws = gql("query($p: String!) { project(id: $p) { workspaceId } }", {"p": LIVE["project"]})["project"]["workspaceId"]
        p = gql("mutation($i: ProjectCreateInput!) { projectCreate(input: $i) { id environments { edges { node { id name } } } } }",
                {"i": {"name": f"cupq-{slug}", "workspaceId": ws, "defaultEnvironmentName": "production"}})["projectCreate"]
        st.set(project=p["id"], env=p["environments"]["edges"][0]["node"]["id"], workspace=ws, region=region, host=host)
        say(f"1. project cupq-{slug} made")
    else:
        say("1. project: already made")
    P, E = st["project"], st["env"]

    # 2. Database, in the right region from the start (its disk follows)
    if not st["postgres"]:
        t = gql('query($c: String!) { template(code: $c) { id serializedConfig } }', {"c": POSTGRES_TEMPLATE})["template"]
        cfg = t["serializedConfig"]
        for svc in cfg.get("services", {}).values():
            svc.setdefault("deploy", {})["multiRegionConfig"] = {region: {"numReplicas": 1}}
            for vm in (svc.get("volumeMounts") or {}).values():
                vm["region"] = region
        gql("mutation($i: TemplateDeployV2Input!) { templateDeployV2(input: $i) { projectId workflowId } }",
            {"i": {"templateId": t["id"], "serializedConfig": cfg, "projectId": P, "environmentId": E,
                   "workspaceId": st["workspace"]}})
        pg = None
        for _ in range(30):
            pg = services(P).get("Postgres")
            if pg:
                break
            time.sleep(5)
        if not pg:
            raise RuntimeError("Postgres service didn't appear")
        st.set(postgres=pg)
        say("2. database added")
    else:
        say("2. database: already added")
    PG = st["postgres"]
    wait_deploy(PG, E, "database")
    disk = [v for v in volume_regions(P) if v["serviceId"] == PG]
    if not disk or disk[0]["region"] != region:
        # The demo build's trap: the disk stayed in the US. Move it now, while empty.
        say(f"   database disk is in {disk[0]['region'] if disk else '?'}: moving it to {region}")
        set_region(PG, E, region)
        gql("mutation($s: String!, $e: String!) { serviceInstanceDeployV2(serviceId: $s, environmentId: $e) }", {"s": PG, "e": E})
        time.sleep(30)
        wait_deploy(PG, E, "database (moved)")
        disk = [v for v in volume_regions(P) if v["serviceId"] == PG]
        if not disk or disk[0]["region"] != region:
            raise RuntimeError(f"database disk still in {disk[0]['region'] if disk else '?'}")
    say(f"   database disk in {region}: checked")

    # 3. Web service with its settings in the same call
    if not st["web"]:
        variables = {
            "DATABASE_URL": "${{Postgres.DATABASE_URL}}",
            "JWT_SECRET_KEY": secrets.token_urlsafe(48),
            "SECRET_KEY": secrets.token_urlsafe(48),
            "PIN_PEPPER": secrets.token_urlsafe(32),
            "CLOUDPRNT_SHARED_SECRET": secrets.token_urlsafe(32),
            "FLEET_STATUS_TOKEN": fleet_token(),
            "DEBUG": "False", "LOG_LEVEL": "INFO", "JWT_COOKIE_SECURE": "True",
            "TESTING_MODE": "True" if demo else "False",
            "EVENT_NAME": event_name,
            "CORS_ALLOWED_ORIGINS": f"https://{host}",
            "PUBLIC_BASE_URL": f"https://{host}",
            "DEFAULT_ADMIN_USERNAME": f"{slug}admin",
            "DEFAULT_ADMIN_EMAIL": f"{slug}admin@{DOMAIN}",
            "PYTHONUNBUFFERED": "1",
        }
        w = gql("mutation($i: ServiceCreateInput!) { serviceCreate(input: $i) { id } }",
                {"i": {"projectId": P, "environmentId": E, "name": "web", "source": {"repo": REPO},
                       "branch": "main", "variables": variables}})["serviceCreate"]["id"]
        st.set(web=w)
        say("3. web service made with its settings (secrets generated, never shown)")
    else:
        say("3. web service: already made")
    W = st["web"]

    # 4-5. Web region and its /data volume
    if not st["volume"]:
        set_region(W, E, region)
        v = gql("mutation($i: VolumeCreateInput!) { volumeCreate(input: $i) { id } }",
                {"i": {"projectId": P, "environmentId": E, "serviceId": W, "mountPath": "/data", "region": region}})
        st.set(volume=v["volumeCreate"]["id"])
        say("4-5. web region set, /data volume added")
    else:
        say("4-5. web region and volume: already done")

    # 6. Deploy (the Docker build takes 3-6 minutes)
    if not st["deployed"]:
        gql("mutation($s: String!, $e: String!) { serviceInstanceDeployV2(serviceId: $s, environmentId: $e) }", {"s": W, "e": E})
        time.sleep(20)
        st.set(deployed=wait_deploy(W, E, "web", minutes=15))
        say("6. web deployed")
    else:
        say("6. web: already deployed")

    # 7. Railway's own address, then health
    if not st["railway_domain"]:
        dom = gql("mutation($i: ServiceDomainCreateInput!) { serviceDomainCreate(input: $i) { domain } }",
                  {"i": {"serviceId": W, "environmentId": E, "targetPort": WEB_PORT}})["serviceDomainCreate"]["domain"]
        st.set(railway_domain=dom)
    for _ in range(30):
        code, _b = http("GET", f"https://{st['railway_domain']}/api/health", timeout=15)
        if code == 200:
            break
        time.sleep(10)
    else:
        raise RuntimeError(f"https://{st['railway_domain']}/api/health never answered 200")
    say(f"7. answering at https://{st['railway_domain']}")

    # 8. Its own address on cupq.app, proxied like cupq.app itself
    if not st["custom_domain"]:
        cd = gql("""mutation($i: CustomDomainCreateInput!) { customDomainCreate(input: $i) {
            id status { dnsRecords { hostlabel recordType requiredValue } verificationDnsHost verificationToken } } }""",
                 {"i": {"domain": host, "serviceId": W, "environmentId": E, "projectId": P, "targetPort": WEB_PORT}})["customDomainCreate"]
        zone = cloudflare("GET", f"/zones?name={DOMAIN}")[0]["id"]
        recs = cloudflare("GET", f"/zones/{zone}/dns_records?per_page=100")
        apex = next((r for r in recs if r["name"] == DOMAIN and r["type"] in ("CNAME", "A")), None)
        proxied = bool(apex and apex.get("proxied"))
        have = {(r["type"], r["name"]) for r in recs}
        cname = next(r["requiredValue"] for r in cd["status"]["dnsRecords"] if r["recordType"].upper().endswith("CNAME"))
        want = [{"type": "CNAME", "name": host, "content": cname, "proxied": proxied, "ttl": 1,
                 "comment": f"CupQ copy cupq-{slug}"}]
        if cd["status"].get("verificationToken"):
            # Railway gives the host without the zone: "_railway-verify.<slug>".
            vhost = cd["status"].get("verificationDnsHost") or f"_railway-verify.{slug}"
            want.append({"type": "TXT", "name": f"{vhost}.{DOMAIN}",
                         "content": cd["status"]["verificationToken"], "ttl": 1,
                         "comment": f"Railway domain check for {host}"})
        for rec in want:
            if (rec["type"], rec["name"]) not in have:
                cloudflare("POST", f"/zones/{zone}/dns_records", rec)
        st.set(custom_domain=cd["id"])
        say(f"8. {host} added (Railway + Cloudflare)")
    for _ in range(36):
        code, _b = http("GET", f"https://{host}/api/health", timeout=15)
        if code == 200:
            break
        time.sleep(10)
    else:
        raise RuntimeError(f"https://{host} didn't answer within 6 minutes; rerun to keep checking")
    say(f"   https://{host} answers")

    # 9. First admin: from the deploy log straight to a private file
    admin_file = ADMIN_DIR / f"{host}-admin.txt"
    if not admin_file.exists():
        found = None
        for _ in range(12):
            logs = call("query($d: String!) { deploymentLogs(deploymentId: $d, limit: 3000) { message } }",
                        {"d": st["deployed"]})
            for line in (logs.get("data") or {}).get("deploymentLogs") or []:
                m = re.search(r"FIRST ADMIN LOGIN for this server: (\S+) / (\S+)", line.get("message", ""))
                if m:
                    found = m.groups()
            if found:
                break
            time.sleep(10)
        if not found:
            raise RuntimeError("no FIRST ADMIN LOGIN line in the deploy log")
        ADMIN_DIR.mkdir(exist_ok=True)
        old = os.umask(0o077)
        try:
            admin_file.write_text(f"{host} first admin\nusername: {found[0]}\npassword: {found[1]}\n"
                                  f"Log in at https://{host}/login and change it in Runner > People.\n")
        finally:
            os.umask(old)
        say(f"9. first admin {found[0]}: password saved to {admin_file} (not shown)")
    else:
        say(f"9. first admin: already saved in {admin_file}")

    # 10. Saved event
    token = None
    if event_file and not st["event_loaded"]:
        lines = admin_file.read_text().splitlines()
        user = next(l.split(": ", 1)[1] for l in lines if l.startswith("username: "))
        pw = next(l.split(": ", 1)[1] for l in lines if l.startswith("password: "))
        code, r = http("POST", f"https://{host}/api/auth/login", {"username": user, "password": pw})
        token = r.get("token") or r.get("access_token")
        if not token:
            raise RuntimeError(f"couldn't log in as {user} ({code}); the password may have been changed")
        preset = json.loads(Path(os.path.expanduser(event_file)).read_text())["payload"]
        auth = {"Authorization": f"Bearer {token}"}
        code, r = http("POST", f"https://{host}/api/quick-setup", {"preset": preset, "replace_look": True}, auth, timeout=90)
        if code >= 400 or r.get("success") is False:
            raise RuntimeError(f"loading the saved event failed ({code}): {r.get('message') or r.get('error')}")
        http("PUT", f"https://{host}/api/settings/sms-policy",
             {"policy": preset.get("started_sms_policy") or "queue_only", "threshold_seconds": 60}, auth)
        name = (preset.get("event_name") or event_name).strip()
        http("PUT", f"https://{host}/api/settings", {"event_name": name}, auth)
        http("PUT", f"https://{host}/api/settings/branding", {"settings": {"event_name": name}}, auth)
        st.set(event_loaded=True)
        say(f"10. saved event loaded ({name})")
    else:
        say("10. saved event: " + ("already loaded" if st["event_loaded"] else "none given"))

    # 11. Fleet board on cupq.app
    if add_to_fleet_board(event_name, f"https://{host}"):
        say("11. added to cupq.app's fleet board (shows after cupq.app's next deploy)")
    else:
        say("11. fleet board: already listed")

    st.set(built_at=time.strftime("%Y-%m-%d %H:%M"))
    say(f"Done. Next: log in at https://{host}/login and work Runner > Live > Readiness to green.")
    return 0


# --- park / wake / list ------------------------------------------------------
def _find(slug):
    st = State(slug)
    if st["project"] and st["web"]:
        return st["project"], st["env"], st["web"], st["host"]
    # Copies built by hand (demo) have no record: find by project name.
    d = gql("{ projects { edges { node { id name environments { edges { node { id } } } services { edges { node { id name } } } } } } }")
    for e in d["projects"]["edges"]:
        n = e["node"]
        if n["name"] == f"cupq-{slug}":
            web = next((s["node"]["id"] for s in n["services"]["edges"] if s["node"]["name"] == "web"), None)
            return n["id"], n["environments"]["edges"][0]["node"]["id"], web, f"{slug}.{DOMAIN}"
    raise SystemExit(f"No copy called cupq-{slug}")


def park(slug):
    if slug in ("live", "coffee-cue"):
        raise SystemExit("Not parking the live copy.")
    P, E, W, host = _find(slug)
    dep = gql("query($s: String!, $e: String!) { serviceInstance(serviceId: $s, environmentId: $e) "
              "{ latestDeployment { id status } } }", {"s": W, "e": E})["serviceInstance"]["latestDeployment"]
    if not dep or dep["status"] != "SUCCESS":
        print(f"{host}: web isn't running ({(dep or {}).get('status')}), nothing to park")
        return 0
    gql("mutation($id: String!) { deploymentStop(id: $id) }", {"id": dep["id"]})
    for _ in range(18):
        code, _b = http("GET", f"https://{host}/api/health", timeout=10)
        if code != 200:
            break
        time.sleep(5)
    say(f"{host} parked (web stopped; database and its data kept). Wake: python scripts/fleet_apply.py wake {slug}")
    return 0


def wake(slug):
    P, E, W, host = _find(slug)
    q = ("query($i: DeploymentListInput!) { deployments(input: $i, first: 10) "
         "{ edges { node { id status } } } }")
    deps = [e["node"] for e in gql(q, {"i": {"serviceId": W, "environmentId": E}})["deployments"]["edges"]]
    if deps and deps[0]["status"] == "SUCCESS":
        print(f"{host} is already awake")
        return 0
    # Redeploy the last good build: same version it was parked on, no rebuild.
    last = next((d for d in deps if d["status"] in ("SUCCESS", "SLEEPING", "REMOVED")), None)
    if last:
        gql("mutation($id: String!) { deploymentRedeploy(id: $id) { id } }", {"id": last["id"]})
    else:
        gql("mutation($s: String!, $e: String!) { serviceInstanceDeployV2(serviceId: $s, environmentId: $e) }", {"s": W, "e": E})
    for _ in range(60):
        code, _b = http("GET", f"https://{host}/api/health", timeout=10)
        if code == 200:
            say(f"{host} awake and answering")
            return 0
        time.sleep(10)
    raise SystemExit(f"{host} didn't answer within 10 minutes of waking")


def list_copies():
    d = gql("""{ projects { edges { node { id name services { edges { node { id name
        serviceInstances { edges { node { environmentId latestDeployment { status meta }
        domains { customDomains { domain } serviceDomains { domain } } } } } } } } } } } }""")
    for e in d["projects"]["edges"]:
        n = e["node"]
        for s in n["services"]["edges"]:
            if s["node"]["name"] != "web":
                continue
            for i in s["node"]["serviceInstances"]["edges"]:
                i = i["node"]
                doms = [c["domain"] for c in (i.get("domains") or {}).get("customDomains") or []] or \
                       [c["domain"] for c in (i.get("domains") or {}).get("serviceDomains") or []]
                # serviceInstance.region is always empty now; the region lives
                # in the deployment's manifest (multiRegionConfig).
                meta = (i.get("latestDeployment") or {}).get("meta") or {}
                region = ",".join(((meta.get("serviceManifest") or {}).get("deploy") or {}).get("multiRegionConfig") or {}) or "?"
                print(f"{n['name']:<16} {region:<26} "
                      f"{((i.get('latestDeployment') or {}).get('status') or '-'):<10} {', '.join(doms)}")
    return 0


def main(argv=None):
    a = (argv if argv is not None else sys.argv[1:])
    if not a or a[0] not in ("park", "wake", "list"):
        print(__doc__)
        return 2
    if a[0] == "list":
        return list_copies()
    if len(a) < 2:
        print(f"usage: fleet_apply.py {a[0]} <slug>")
        return 2
    return park(a[1]) if a[0] == "park" else wake(a[1])


if __name__ == "__main__":
    sys.exit(main())
