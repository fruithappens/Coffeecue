# Printer setup — Star CloudPRNT

For whoever sets the printers up at a venue. Written after the first live
CloudPRNT bring-up, 18 Aug 2026.

> **Credentials are NOT in this file, deliberately.** This repository is on
> GitHub; a device password committed here is public and effectively
> permanent. The printer's `root` password lives in Steve's password
> manager. Ask him.

## Hardware

| | |
|---|---|
| Station 1 | Star **mC-Label3 MCL32CI** — Ethernet + USB, cutter |
| Station 2 | Star **TSP143IV SK** — Ethernet + USB (the AU variant has no Wi-Fi/Bluetooth) |
| Media | 58 mm removable linerless direct thermal |
| Resolution | 203 dpi (8 dots/mm). Max print width 80 mm; we render 406 dots ≈ 50.8 mm |

Both talk **CloudPRNT over Ethernet** to the same endpoint. Neither needs a
computer running — that is the whole point of CloudPRNT, and it is why it is
preferred over the USB path for an event.

## 1. Get the printer on the network

Plug in Ethernet. To find the IP address, **hold FEED while powering on** —
the printer prints a self-test showing its IP and MAC.

Note the MAC. You will match it in the Support UI (it prints with colons,
`00:11:62:45:73:8F`; the app stores it bare, `00116245738F` — both work).

## 2. Open the printer's web configuration

Browse to `http://<printer-ip>` from a machine on the same network.

- Username: `root`
- Password: **ask Steve** (Star ships a well-known default; it should be
  changed on every unit before an event, and has been on Station 1)

At the home bench Station 1 was `192.168.2.38`, but this is DHCP and will be
different at a venue. Always read it off the self-test.

## 3. Turn CloudPRNT on

In the web config, enable CloudPRNT and set:

| Setting | Value |
|---|---|
| Server URL | `https://web-production-4cc9c.up.railway.app/cloudprnt` |
| Polling interval | 5 seconds |
| Authentication | none |
| HTTPS trust | trusted CA list |

Save and let the printer reboot if prompted.

**CloudPRNT ships DISABLED.** The self-test will say the firmware supports
it while it is switched off — that is not the same as it being on.

## 4. Adopt it in Coffee Cue

The printer registers itself on its first poll and appears in
**Support → Printers** as "New printer ####" — **disabled**, on purpose, so
a strange device on the network cannot start printing your labels.

1. Check the MAC matches the self-test.
2. Enable it and assign it to a station.
3. Leave the driver on **CloudPRNT — printer polls us (no agent)**.
4. Press **Test print**. Expect exactly ONE label.

## 5. Verify

- Exactly one label per job, then silence. Repeat printing was a real bug
  (fixed in #224) — if it ever returns, disable the printer and say so.
- The Print Queue shows `queued → fetched → printed` with `attempts = 0`.
- A printer that has not polled recently shows offline, and queueing to it
  warns instead of showing a green tick.

## Notes

- **USB via the print agent is a fallback**, not the plan. It needs a
  computer awake with the agent running, and it stops when the lid closes.
  Use it only when a venue network blocks the printer's outbound HTTPS.
- Don't run both CloudPRNT and the agent against the same MAC — two pollers
  steal each other's jobs and labels go missing unpredictably.
- Label content currently prints **clipped on the left** over CloudPRNT
  (the USB path is fine). Under investigation; print the calibration Test
  label and read the ruler to measure it.
