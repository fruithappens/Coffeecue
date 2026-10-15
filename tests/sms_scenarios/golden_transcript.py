#!/usr/bin/env python3
"""Record every reply the text bot gives across many conversations, so a
refactor can prove it changed no wording (roadmap X7-6).

    python tests/sms_scenarios/golden_transcript.py record  out.json
    python tests/sms_scenarios/golden_transcript.py compare out.json

Drives the local /sms webhook (TESTING_MODE: no real texts, the reply comes
back in the HTTP response). Each conversation gets a fresh phone number so
history can't change the path; names, phone numbers, order numbers and
times are normalised so two runs compare word for word.

The conversations are the scenario runner's plus extra ones that reach
more of the bot's replies.
"""
import json
import re
import sys
import time
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from run_sms_scenarios import SmsClient, build_scenarios  # noqa: E402

BASE = "http://127.0.0.1:5001"

EXTRA = [
    ["help"],
    ["menu"],
    ["status"],
    ["hi", "{NAME}", "status"],
    ["hi", "{NAME}", "cancel"],
    ["hi", "{NAME}", "latte", "cancel"],
    ["hi", "{NAME}", "unicorn frappe"],
    ["hi", "{NAME}", "latte", "almond", "large", "yes"],
    ["hi", "{NAME}", "flat white with oat"],
    ["hi", "{NAME}", "2 lattes"],
    ["hi", "{NAME}", "a latte for me and a cappuccino for Sam"],
    ["{NAME}", "long black"],
    ["usual"],
    ["hi", "{NAME}", "decaf latte full cream small", "yes", "status"],
    ["hi", "{NAME}", "hot chocolate", "medium"],
    ["hi", "{NAME}", "tea"],
    ["hi", "{NAME}", "latte", "skim", "medium", "no"],
    ["STOP"],
    ["hi", "{NAME}", "barista"],
    ["hi", "{NAME}", "latte", "oat", "extra hot double shot", "medium"],
    ["thanks"],
    ["?"],
    ["delete"],
]


def normalise(text, name):
    t = text.replace(name, "NAME")
    t = re.sub(r"\+?61\d{8,9}", "PHONE", t)
    t = re.sub(r"#\s?[A-Z]?\d+[a-z]?", "#N", t)
    t = re.sub(r"\b\d{1,2}:\d{2}\s?(am|pm|AM|PM)?\b", "TIME", t)
    t = re.sub(r"\b(about |~)?\d+(-\d+)? ?min(ute)?s?\b", "N min", t)
    # Which station an order lands on varies run to run (load balancing).
    t = re.sub(
        r"\b(at|from|to) (Station \d+|East Wing|Main Hall|[A-Z][a-z]+ (Wing|Hall|Bar|Cart))\b",
        r"\1 STATION",
        t,
    )
    t = re.sub(r"\bStation \d+\b", "STATION", t)
    return t


def conversations():
    seq = 0
    for s, _phone, _name in build_scenarios():
        seq += 1
        yield f"scenario:{s.name}", [st.send for st in s.steps], _name
    for i, turns in enumerate(EXTRA):
        yield f"extra:{i:02d}", turns, f"Gold{i:02d}x"


def run():
    sms = SmsClient(BASE)
    out = {}
    stamp = int(time.time() * 1000) % 10_000_000
    for n, (key, turns, name) in enumerate(conversations()):
        phone = f"+614999{(stamp + n * 37) % 100000:05d}"
        replies = []
        for turn in turns:
            body = turn.replace("{NAME}", name)
            code, reply = sms.send(phone, body, message_sid=f"SM{uuid.uuid4().hex}")
            replies.append(
                {
                    "sent": body.replace(name, "NAME"),
                    "status": code,
                    "reply": normalise(reply, name),
                }
            )
        out[key] = replies
    return out


def main():
    mode, path = sys.argv[1], Path(sys.argv[2])
    now = run()
    if mode == "record":
        path.write_text(json.dumps(now, indent=1, ensure_ascii=False))
        n = sum(len(v) for v in now.values())
        print(f"recorded {len(now)} conversations, {n} replies -> {path}")
        return 0
    before = json.loads(path.read_text())
    diffs = []
    for key, turns in before.items():
        for i, t in enumerate(turns):
            got = (
                (now.get(key) or [{}] * (i + 1))[i]
                if i < len(now.get(key) or [])
                else {}
            )
            if got.get("reply") != t["reply"]:
                diffs.append((key, i, t["sent"], t["reply"], got.get("reply")))
    total = sum(len(v) for v in before.values())
    print(
        f"compared {total} replies: {total - len(diffs)} identical, {len(diffs)} different"
    )
    for key, i, sent, a, b in diffs[:30]:
        print(f"\n{key} turn {i} ({sent!r})\n  before: {a}\n  after:  {b}")
    return 1 if diffs else 0


if __name__ == "__main__":
    sys.exit(main())
