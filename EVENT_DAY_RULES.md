# Event day rules

Short list. Everything here is written because it already went wrong once.

## 1. Do not deploy while people are ordering

**On 2026-08-18 a customer's confirmed coffee order was lost this way.**
A merge landed at 04:28:45 UTC; their "Yes" arrived at 04:33:25, four
minutes later, while Railway was swapping containers. The message was
recorded and then died mid-processing. Replaying the identical
conversation afterwards worked perfectly — there was no bug. The deploy
was the bug.

A redeploy restarts the app. Anything in flight at that moment is at
risk, and an SMS in flight is a person standing at a counter.

- **No merges to `main` during an event.** Not "small" ones, not doc-only
  ones — the deploy restarts the app regardless of what changed.
- **No merges while anyone is live-testing.** If someone says they are
  about to test, stop merging until they say they are done.
- Freeze from **the night before** through the end of the event.
- Something genuinely broken on the day? Fix it, but announce it first,
  and expect to lose in-flight messages during the swap.

The healthcheck (below) narrows the window; it does not remove it.

## 2. The print agent must be running (USB printers only)

Nothing prints without it, and jobs queue silently. Not needed at all if
the printer is on LAN talking CloudPRNT directly — which is the better
setup for an event, because it survives the laptop sleeping.

```
~/coffeecue-print-agent/start-printing.command
```

Support -> Printers shows a printer as offline when nothing is polling
it, and queueing to one now warns instead of showing a green tick.

## 3. Check for dropped messages

```
GET /api/sms/dropped
```

Anything listed is a real person whose message was accepted but never
processed — i.e. someone who never got their coffee and does not know
why. The bench `resilience` suite reports the same thing.

## 4. Real logs exist now

```
GET /api/diagnostics/logs?level=ERROR
```

Warnings and errors with tracebacks, newest first. In-memory, so the
window **resets on redeploy** — an empty list means "nothing captured
since the last deploy", NOT "nothing went wrong". This endpoint used to
return fabricated sample data; if you ever see "Sample log message"
again, it has regressed.

## 5. Deploy config lives in two files

`railway.json` and `railway.toml` both exist and Railway reads one of
them. Keep the `[deploy]` settings identical in both, or you will
configure something that never takes effect.
