#!/usr/bin/env python3
"""Rebuild docs/ui/README.md from the last sweep. Run after every batch."""
import json, os, datetime
OUT = os.path.expanduser("~/cupq-next/docs/ui")
rows = json.load(open(f"{OUT}/_scores.json"))
done = [r for r in rows if r["legacy"] == 0 and r["selects"] == 0]
todo = sorted([r for r in rows if r not in done], key=lambda r: -r["legacy"])

md = [
"# The tidy-up: every screen, before and after",
"",
"> Steve, holding two screenshots side by side: *\"simple clean, branded UI vs",
"> cluttered complicated, non branded UI ... they often look similar to this.\"*",
"",
"He was right, and the cause was small. The screen that looked good — the",
"Station Admin sheet — built its row pattern **inline**, twenty good lines that",
"nothing else could reach. Every other settings screen went on building its own",
"out of bare `<select>` and `<input>`, each with a paragraph of grey text",
"underneath.",
"",
"`src/design/Settings.js` promotes that pattern so the rest can use it:",
"`SettingGroup`, `SettingRow`, `Toggle`, `Segmented`, `SelectRow`, `TextField`,",
"`SettingNote`. **The shape of a row is the whole idea**: an icon, a name, one",
"line of hint, and exactly one control. If a setting needs a paragraph, the",
"setting is wrong or the paragraph belongs in Help.",
"",
"## How a screen is scored",
"",
"`legacy` counts elements still carrying old Tailwind colours",
"(`bg-blue-500`, `text-gray-500` …). `cq` counts elements on the design system.",
"A converted screen reads **legacy 0**. Nothing here is a judgement call — the",
"numbers come from the live DOM, swept by `scratchpad/capture/ui_sweep.js`.",
"",
f"Last swept: {datetime.date.today().isoformat()} · **{len(done)} of {len(rows)} done**",
"",
"---",
"",
f"## Done ({len(done)})",
"",
]
for r in done:
    md += [f"### {r['label']}", "", f"![{r['label']}]({r['file']})", ""]
md += ["---", "", f"## Still to do ({len(todo)}), worst first", "",
       "| Screen | legacy | cq | selects | inputs |", "| --- | ---: | ---: | ---: | ---: |"]
for r in todo:
    md.append(f"| [{r['label']}]({r['file']}) | {r['legacy']} | {r['cq']} | {r['selects']} | {r['inputs']} |")
md += ["", "Shots of these are in this folder too — they are the *before*.", ""]
open(f"{OUT}/README.md","w").write("\n".join(md))
print(f"docs/ui/README.md written — {len(done)} done, {len(todo)} to go")
