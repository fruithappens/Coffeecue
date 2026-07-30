# Coffee Cue print agent

Bridges the cloud print queue to thermal printers on the venue LAN.
Runs on any machine at the venue (typically the Surface), needs **only
Node.js** — no npm install, no other dependencies.

## When do you need this?

| Situation | What to use |
|---|---|
| Star mC-Label3 with working internet | **Nothing — skip the agent.** The printer's own CloudPRNT client talks straight to the cloud. Point it at `https://<your-app>/cloudprnt`. |
| Star printer that can't reach the internet (venue firewall) | This agent, `"protocol": "star-raster"` |
| Epson (TM series) receipt printer | This agent, `"protocol": "escpos"` |

**Never both at once**: a printer is driven *either* by its own CloudPRNT
client *or* by this agent. Two pollers using the same MAC steal each
other's jobs.

**Never mix protocols**: `star-raster` is for Star printers only, `escpos`
for Epson-compatibles only. The wrong protocol prints garbage. The agent
enforces the setting per printer; just set it correctly in the config.

## Setup

1. Install Node.js LTS (https://nodejs.org — the plain Windows installer is fine).
2. Copy this `print-agent/` folder onto the machine.
3. `copy config.example.json config.json` and edit:
   - `cloudBase` — your Coffee Cue URL.
   - One entry per printer: `mac` (the identity used with the cloud queue —
     use the printer's real MAC; it appears in Support → Printers on first
     poll, where you enable it and assign a station), `ip` + `port` (the
     printer on the venue LAN, port 9100), and `protocol`.
4. Run it:
   ```
   node agent.js
   ```
5. In the app: Support → Printers → the printer appears within seconds →
   name it, assign its station, tick Enabled → Test print.

## Checking on it

- `http://127.0.0.1:8631/health` — cloud reachability, per-printer last
  poll/print/error, spooled-job count.
- `POST http://127.0.0.1:8631/test` with `{"printer": "name-or-mac"}` —
  prints a locally generated test pattern straight to the printer,
  bypassing the cloud entirely (isolates LAN/printer problems from
  internet problems).
- `print-agent/agent.log` — everything the agent did.
- `node agent.js --selftest some-label.png` — decode a label PNG and show
  an ASCII preview (sanity check without touching a printer).

## Start automatically on Windows (Task Scheduler)

1. Task Scheduler → Create Task.
2. General: "Coffee Cue print agent", *Run whether user is logged on or
   not*, tick *Run with highest privileges*.
3. Triggers: New → *At startup* (add a 30s delay so WiFi is up).
4. Actions: New → Program `C:\Program Files\nodejs\node.exe`,
   arguments `agent.js`, *Start in* = the print-agent folder path.
5. Settings: tick *If the task fails, restart every 1 minute*.

## How it stays honest

- The agent fetches a job, writes it to `spool/` on disk, prints it, then
  confirms to the cloud with the **real** result (200 printed / 500
  failed — the cloud retries failed jobs up to 3 times and then marks
  them failed, visible in Support → Printers).
- If the machine crashes or internet drops between fetch and confirm, the
  spooled copy is recovered on the next start: printed if it never
  printed, confirm-only if it did (never printed twice).
- Printing never blocks orders. Worst case a label doesn't come out and
  the job shows failed in Support; coffee keeps flowing.

## Hardware-pending note

The `star-raster` output follows Star's raster-mode documentation but has
not yet been validated against a physical mC-Label3 (whose primary,
fully verified path is native CloudPRNT — no agent involved). Before an
event, run one Test print through whichever path you'll actually use.
