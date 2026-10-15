// cupq.app's Railway setup as code (replaces railway.json / railway.toml,
// which Railway stops reading on 1 Dec 2026). Made with `railway config pull`
// from the live project on 16 Oct 2026, then checked with `railway config plan`.
//
// Two lines are hand-set, because the pulled defaults were wrong:
//   - Postgres.source preserveExisting: without it the plan switched the live
//     database image to postgres:18. cupq.app's data is Postgres 16; never
//     change the image without a dump, a restore drill and Steve's OK.
//   - web build/deploy: the Dockerfile and restart-on-failure, which the old
//     files set (the dashboard's own builder setting says NIXPACKS).
// Secrets are preserve(): Railway keeps them; none are written here.
// Preview any edit with `railway config plan` before `railway config apply`.
import { defineRailway, github, postgres, preserve, project, service, volume } from "railway/iac";

export default defineRailway(() => {
  const Postgres = postgres("Postgres", { region: "us-west2" });
  Postgres.networking = { privateNetworkEndpoint: "postgres", tcpProxies: { "5432": {} } };
  Postgres.source = { type: "image", preserveExisting: true };
  const webVolume = volume("web-volume", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: "us-west2", sizeMB: 5000 });
  const dropVolume = volume("drop-volume", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: "us-west2", sizeMB: 500 });
  const web = service("web", {
    source: github("fruithappens/Coffeecue", { checkSuites: false }),
    start: "python run_server.py",
    build: { builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
    deploy: { restartPolicyType: "ON_FAILURE" },
    replicas: { "us-west2": 1 },
    domains: ["cupq.app"],
    volumeMounts: { "/data": webVolume },
    env: { BACKUP_HEARTBEAT_TOKEN: preserve(), DATABASE_URL: preserve(), DEBUG: preserve(), FLEET_COPIES: preserve(), JWT_COOKIE_SECURE: preserve(), JWT_SECRET_KEY: preserve(), LOG_LEVEL: preserve(), SECRET_KEY: preserve(), TESTING_MODE: preserve(), TWILIO_ACCOUNT_SID: preserve(), TWILIO_AUTH_TOKEN: preserve(), TWILIO_PHONE_NUMBER: preserve() },
  });

  return project("Coffee Cue", {
    resources: [Postgres, web, webVolume, dropVolume],
  });
});
