#!/usr/bin/env python3
"""
Install (or re-install) the captcha-relay advisory hook + skill symlink on THIS host.

Idempotent by construction: it removes any existing registration of this script
before adding one, so running it twice leaves one copy, not two. Run it on every
host — ~/.claude is HOST-LOCAL (/home/ben differs per machine), while the hook and
skill themselves live once on the NAS.

⛔ Writes a timestamped backup of settings.json first and re-reads the file after
writing. A settings.json this script corrupted would break every Claude Code
session on the host, so "it returned 0" is not the check — the re-read is.
"""

import datetime
import json
import os
import shutil
import sys

HOOK = "/mnt/nas/data/code/unibrowse/hooks/captcha-relay-advisory.py"
SKILL_SRC = "/mnt/nas/data/code/unibrowse/skills/captcha-relay"
SETTINGS = os.path.expanduser("~/.claude/settings.json")
SKILL_DST = os.path.expanduser("~/.claude/skills/captcha-relay")

# PostToolUse is the load-bearing one: a captcha appears in a tool RESULT.
# UserPromptSubmit catches a human or a channel message naming one.
WIRING = [
    ("PostToolUse", "mcp__unibrowse__.*"),
    ("PreToolUse", "mcp__unibrowse__.*"),
    ("UserPromptSubmit", None),
]
CMD = f"python3 {HOOK}"


def main() -> int:
    host = os.uname().nodename
    if not os.path.exists(HOOK):
        print(f"{host}: FAIL hook script missing at {HOOK}")
        return 1
    if not os.path.exists(SETTINGS):
        print(f"{host}: FAIL no {SETTINGS}")
        return 1

    with open(SETTINGS) as fh:
        cfg = json.load(fh)

    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    shutil.copy2(SETTINGS, f"{SETTINGS}.bak-captcha-{stamp}")

    hooks = cfg.setdefault("hooks", {})
    for event, matcher in WIRING:
        entries = hooks.setdefault(event, [])
        # Drop any prior registration of THIS script, whatever matcher it had.
        for entry in list(entries):
            entry["hooks"] = [
                h for h in entry.get("hooks", []) if HOOK not in str(h.get("command", ""))
            ]
            if not entry["hooks"]:
                entries.remove(entry)
        block = {"hooks": [{"type": "command", "command": CMD}]}
        if matcher is not None:
            block["matcher"] = matcher
        entries.append(block)

    tmp = f"{SETTINGS}.tmp-captcha"
    with open(tmp, "w") as fh:
        json.dump(cfg, fh, indent=2)
        fh.write("\n")
    os.replace(tmp, SETTINGS)

    # Re-read: the only evidence that matters.
    with open(SETTINGS) as fh:
        back = json.load(fh)
    found = sorted(
        event
        for event, _ in WIRING
        if any(
            HOOK in str(h.get("command", ""))
            for entry in back.get("hooks", {}).get(event, [])
            for h in entry.get("hooks", [])
        )
    )

    skill = "unchanged"
    if os.path.islink(SKILL_DST):
        if os.readlink(SKILL_DST) != SKILL_SRC:
            os.unlink(SKILL_DST)
            os.symlink(SKILL_SRC, SKILL_DST)
            skill = "relinked"
    elif os.path.exists(SKILL_DST):
        skill = f"LEFT ALONE — {SKILL_DST} exists and is not a symlink"
    else:
        os.symlink(SKILL_SRC, SKILL_DST)
        skill = "linked"

    ok = found == sorted(e for e, _ in WIRING)
    readable = os.path.exists(os.path.join(SKILL_DST, "SKILL.md"))
    print(
        f"{host}: hooks={','.join(found)} complete={ok} skill={skill} "
        f"skill_readable={readable}"
    )
    return 0 if ok and readable else 1


sys.exit(main())
