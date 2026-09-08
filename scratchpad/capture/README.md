# The harnesses

Headless checks that drive the running copy at `http://localhost:5001`.
They use the Chrome already on this Mac, so there is nothing to download.

## First time in a fresh checkout

```bash
cd scratchpad/capture
npm install            # playwright-core only
```

## Running them

The copy must be up (`./next.sh` from the repo root). Then, **from this
directory**:

```bash
node smoke_phase4.js       # 18 checks -- the barista queue
node stuck_collected.js     # 3 checks -- the Collected button
node smoke_notice.js       # 12 checks -- notices on every surface
node smoke_runner.js        # 8 checks -- all runner destinations render
node smoke_report.js       # 11 checks -- the event report
```

Run them from here, not from the repo root: `require('playwright-core')`
resolves from the script's own directory.

## The UI sweep

```bash
node ui_sweep.js       # walks all 30 screens, shoots + scores each into docs/ui/
python3 ui_doc.py      # rebuilds docs/ui/README.md from that sweep
```

See `docs/UI_REWRITE_GUIDE.md` for what the scores mean and what to do next.
