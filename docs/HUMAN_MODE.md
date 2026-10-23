# Human mode

Input that comes from the operating system instead of from inside the browser.

Ben, Slack #unibrowse 2026-10-23: *"the key is we really need it to not be in the
browser that it gets solved it needs to be mouse and keyboard automation that's
made to look realistic"*, and then *"in human mode the unibrowse combination
extension/ui-eye app should prevent scripted manipulation to fill out things and
force the agents to do human like movements"*.

**Default OFF. Flipped per profile.** Also his call, same thread.

---

## The one-paragraph version

Turn it on for a profile and the scripted input tools stop working for that
profile. In their place you get `browser_human_click`, `browser_human_move`,
`browser_human_type`, `browser_human_scroll` and `browser_human_key`, which move
a real pointer across that profile's X display and press real buttons. The page
sees `isTrusted: true` events arriving after genuine pointer travel, because
that is what they are.

```js
browser_human_mode({ enable: true, extensionId: "ext_caf9ec42-…" })
browser_human_click({ selector: "#email", extensionId: "ext_caf9ec42-…" })
browser_human_type({ text: "hello@example.com", extensionId: "ext_caf9ec42-…" })
browser_human_mode({ list: true })          // what is on right now
```

---

## What it refuses, and why those

| Refused | Because |
|---|---|
| `browser_click`, `browser_type`, `browser_fill_form`, `browser_select_option`, `browser_press_key`, `browser_submit_form`, `browser_drag`, `browser_hover`, `browser_set_clipboard` | the browser acting on itself |
| `browser_realistic_click`, `browser_realistic_type`, `browser_realistic_mouse_move` | ⛔ **also refused.** "Realistic" there means a bezier path dispatched through CDP Input. It is still the browser typing into itself, which is the thing this exists to stop |
| `browser_evaluate` / `browser_execute_macro`, **only** when the script manipulates input — `.value =`, `.click()`, `.focus()`, `dispatchEvent`, `execCommand`, `form.submit()`, `setSelectionRange`, prototype patching | reading the DOM is how you find the thing to click, so reading stays |

Everything else is untouched: navigation, screenshots, snapshots, queries,
cookies, network logs.

---

## Honest limits

⛔ **A guard rail, not a sandbox.** The evaluate check is a list of patterns, so
an agent that wanted to could write around it. What it buys is that the scripted
path stops being the path of least resistance — defeating it takes a deliberate
act. Do not describe it as a security control.

⚠️ **The gate keys on `extensionId`.** A call that omits it is not gated. The
server already requires `extensionId` whenever more than one extension is
connected, which is the only situation where human mode is interesting, but this
is a hole by construction rather than an oversight.

⛔ **Sidecar profiles only.** Human input is delivered by `xdotool` against that
profile's Xvfb display, which exists only for chromes the `chromium-host`
sidecar launched. Office's desktop Chrome has no display we may drive — the
standing rule is never to coordinate-click `:0`, use ui-eye's `AXPress` there —
so `browser_human_mode` refuses to enable for a profile it has no display for.
Enabling it anyway would refuse every input tool and offer nothing in return.

⚠️ **It makes the input human, not the browser anonymous.** The debugger is
still attached and `Runtime` is still enabled while a tab is attached, which is
independently detectable. Measured 2026-10-08 (alpaca, memo `5eaf3446`): 11
Alpaca signups passed on office's desktop Chrome using *plain* scripted calls,
while the VPN chromium failed Turnstile running identical code. In the one case
we have evidence for, profile and IP dominated input realism.

⚠️ **The tab is switched to ACTIVE first.** OS-level input lands wherever the
pointer is; naming a `tabTarget` steers our measurement, not the mouse. If the
switch fails the call errors rather than clicking somewhere unmeasured.

---

## The motion

Not a bezier curve. The model is the sigma-lognormal / motor-synergy model from
[SigmaDrift](https://github.com/ck0i/SigmaDrift) and its paper
([zenodo.org/records/18872499](https://zenodo.org/records/18872499)),
implemented here from the described components — that repo ships no licence.

- **sigma-lognormal velocity primitives** (Plamondon's kinematic theory) — the
  asymmetric bell-shaped speed profile a limb actually produces
- **two-phase surge** — one ballistic stroke covering 92-97% of the distance,
  then 0-2 corrective sub-movements
- **Ornstein-Uhlenbeck lateral drift** — mean-reverting hand wander
- **signal-dependent noise** (Harris & Wolpert 1998) — noise scales with motor
  command, which is what makes Fitts's law *emerge* rather than be imposed
- **8-12Hz physiological tremor**, suppressed while moving fast
- **gamma-distributed sample spacing** — real hardware does not poll on a metronome

Measured over 40 runs, a 630px reach at a 20px target:

| | this model | WindMouse | real humans |
|---|---|---|---|
| movement time | 847 ms | 596 ms | 750-850 ms |
| sub-movements | 2.9 | 19 | 1-3 |
| path efficiency | 0.974 | 0.982 | 0.95-0.99 |

⭐ **Sub-movement count is the one that matters.** It is cheap for a detector to
compute from a mousemove stream, and WindMouse — the algorithm most bot
libraries use — is off by a factor of six on it.

⭐ **Pass the target's width** when you know it (`browser_human_click` derives it
from the selector's rect). A narrow target is approached more slowly. That is
Fitts's law, and it is what makes the timing track the target instead of being a
constant that is itself a signature.

⛔ **No synthetic typos.** `browser_human_type` never mistypes. A "realistic"
wrong character in a credential, an address or an order quantity is a real-world
error, and the realism it buys has never been measured.

---

## Three copies of the model, and the check that keeps them honest

| file | used by |
|---|---|
| `scripts/humanmotion.py` | **canonical.** The host CLI `scripts/realinput.py` |
| `scripts/humanmotion.js` | the `chromium-host` sidecar's `POST /input` |
| `ui-eye/src/ui_eye/client/humanmotion.py` | ui-eye on the MacBook — a byte-identical copy |

They exist separately because ui-eye is Python on a MacBook that does not mount
the NAS, and the sidecar is node. Nothing can be shared between those runtimes.

⛔ **Change one, change all, then run the check:**

```bash
python3 -I scripts/motion-equivalence.py
```

It seeds the Python and the node port identically and diffs every step across
six cases including the edge branches, and md5s the ui-eye copy. All three carry
the same mulberry32 PRNG, Box-Muller normal and Marsaglia-Tsang gamma precisely
so that this is possible — Python's own `random.gauss` caches a spare deviate
and its `gammavariate` uses a different method, either of which would make the
implementations unfalsifiably different.

⚠️ A divergence fails nothing at runtime. One lane just starts moving
differently from the other, which is the kind of failure nobody notices.

---

## Where the parts live

```
src/tools/human-mode.ts        the tools, and the gate
src/server.ts                  gate called in BOTH CallTool handlers — the one chokepoint
chromium-host/server.js        POST /input: builds the gesture, runs one xdotool
scripts/humanmotion.{py,js}    the model
scripts/realinput.py           host-side CLI, for driving a display by hand
scripts/motion-equivalence.py  the anti-drift check
```

State lives in `<PROFILES_DIR>/_human-mode.json`. Missing or unreadable means
OFF — human mode failing open is one lane quietly using scripted input, while
failing closed is every tool in the fleet refusing because a file went away.

### Viewport → screen

Measured 2026-10-23, and not guessable from the `window` object alone:

```
offX = screenX + (outerWidth  - innerWidth) / 2     // window chrome, split L/R
offY = screenY + (outerHeight - innerHeight)        // title bar + toolbars, all on top
screen = off + clientXY * devicePixelRatio
```

Only valid while the tab is ACTIVE. An inactive tab reports its window geometry
perfectly well, and the pointer still goes to whatever is actually on screen.
