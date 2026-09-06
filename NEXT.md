# CupQ Next — the test copy

A full copy of CupQ on this Mac, loaded from a production export, used to build and judge
the re-imagining. **Production is never touched from here.** It cannot text or email anyone:
`TESTING_MODE=True` and no Twilio / EventsAir / SMTP credentials exist in its `.env`.

    ./next.sh      start (backend + built front end on http://localhost:5001; prints the Wi-Fi address)
    ./stop.sh      stop
    ./build.sh     rebuild the front end after changing "Barista Front End/src", then restart

Sign in: coffeecue / adminpassword. Data: `data/load_snapshot.py <export.json>` loads a fresh
production export (Organiser → Settings → Event Data) — all tables, orders included.
Branch: `next` (never auto-deploys; Railway only deploys `main`). Every screen shows a red
"TEST COPY" stripe (from `GET /api/env`; production shows nothing).
