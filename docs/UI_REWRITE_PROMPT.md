# The prompt

Paste this to start a screen-conversion session. It is deliberately short —
the detail lives in `docs/UI_REWRITE_GUIDE.md`, and duplicating it here would
mean two things to keep in step.

---

```
Work in ~/cupq-next (branch `next` — a full copy of CupQ that never deploys).
Production is a live coffee business; nothing you do here touches it.

Read docs/UI_REWRITE_GUIDE.md in full before you touch a file. It has the
vocabulary, the six rules, the screen list and the traps. Follow it.

Your job this session: convert the next 3-4 screens from that list onto the
design system. Not all 27 — do a few properly rather than many badly.

Start:
  cd ~/cupq-next && ./next.sh          # copy comes up on localhost:5001
  cd scratchpad/capture && npm install # first time only
  node ui_sweep.js && python3 ui_doc.py

That sweep is the current truth. Take screens from the top of the "suggested
order" section of the guide, not the raw worst-first table — the order there
exists for a reason.

For each screen:
  1. Read the whole component before changing anything.
  2. Convert it. Behaviour must not change: same handlers, same API calls,
     same settings. You are changing how it looks.
  3. ./build.sh from the repo root (it refuses to copy a failed compile).
  4. ./stop.sh && ./next.sh, then LOOK at the screen in a browser or a
     screenshot. The score alone is not enough — it cannot see a wrapped
     label or a control that is now unreachable.
  5. Re-run ui_sweep.js. Done means legacy: 0 and selects: 0 for that screen.
  6. Run all five harnesses from scratchpad/capture/. All must stay green.
  7. Commit that screen on its own, with a message saying what changed and
     what you deliberately left alone.

At the end: python3 ui_doc.py to update docs/ui/README.md, and commit it.

Things that will bite you:
  - Ids arrive as strings ('435'). === against a number is a dead control.
    This has caused two real production bugs.
  - Several screens live inside 800-2,300 line components. Convert in place
    with exact anchors. Never refactor and convert in the same commit.
  - Raw inline hex (style={{ background: '#1f2937' }}) scores clean and still
    looks wrong. Grep any file you touch for #[0-9a-f]{6}.
  - Semantic colour is information. Green/amber/red that means state maps to
    cq-ready / cq-warn / cq-alert. Never to caramel.
  - Do not touch static/. Railway builds the frontend itself.

If a screen turns out to need a component the vocabulary does not have, add it
to src/design/ and say so in the commit — that is how cq-warn and the table
components came to exist. Do not improvise a one-off in a single file.

If something in the guide is wrong, fix the guide in the same session. It is
meant to be true, not decorative.
```

---

## Why it is shaped like this

**"Read the guide in full before you touch a file"** — the most likely failure
is a Claude skimming, deciding it understands, and inventing a new look. The
guide's first section exists to prevent exactly that.

**"3-4 screens, not all 27"** — a session that tries everything produces
twenty-seven half-conversions and a broken app. The work is only useful one
finished screen at a time.

**"LOOK at the screen"** — the sweep scores the DOM. It cannot see a label
wrapping onto two lines or a menu that opens off-screen. Both happened on the
first two screens converted here, and only a screenshot caught them.

**"Commit each screen on its own"** — so a bad conversion can be reverted
without taking three good ones with it.

**"Fix the guide if it is wrong"** — the guide told the next person to run five
harnesses that existed only in a scratchpad. Documentation rots silently unless
whoever trips over it is expected to repair it.
