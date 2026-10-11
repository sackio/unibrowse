---
name: visual-assess
description: Screenshot a UI you built and judge it visually, using a REAL browser with real logins. Use when asked to review a page's layout, check a dashboard renders correctly, critique a design, or detect visual regressions — especially behind a login, on a kiosk, or at a pinned viewport, where headless tooling cannot reach.
---

# Visual assessment, unibrowse-flavoured

Ben, #guide 2026-10-07: a unibrowse version of the community visual-UI plugins
(`visual-eyes`, `snap-browser`). ⭐ **The point is not screenshots — Playwright
takes screenshots. The point is that unibrowse drives a REAL browser with REAL
sessions**, so it can photograph an authenticated Home Assistant kiosk or a
logged-in app that a headless runner cannot reach at all.

**Judgment is not this skill's job.** `frontend-design@claude-plugins-official`
is installed fleet-wide for that. This gets you a correct image, cheaply.

## The four steps

**1 · Pin the viewport.** A screenshot at an unknown size is not comparable to
anything.
`browser_set_device_metrics {width, height, deviceScaleFactor}`

**2 · Optionally outline what you are critiquing** — the `snap-browser` idea:
`browser_execute_macro {id:"aa5c1662-6da0-45f1-8550-9262dd508392", params:{selectors:[…]}}`
⛔ **Always clear it afterwards** — you are annotating someone else's live browser:
`browser_execute_macro {id:"cf26e53f-b19a-4f87-bfe3-74cf2eca7b6a"}` → assert `clean:true`.
⚠️ The outline sits OUTSIDE the element's own box, so capturing *that element*
crops the outline off. Outline for a parent/viewport shot ("where does this sit
in the layout"); for the element itself, step 3 already crops to it.

**3 · Capture to disk.**
`browser_segmented_screenshot {selectors:[…], outputDir:"/app/fetched/<yours>", prefix:"…"}`
One PNG per selector, elements auto-scrolled into view, returns paths.

**4 · Read the file and judge it.** `Read` renders a PNG visually. Then apply
`frontend-design`.

Regression: `scripts/visual/visual-assess.py baseline|compare|list` — see `--help`.

## ⛔ The two things that will bite you

**`outputDir` IS EFFECTIVELY REQUIRED.** It defaults to `/tmp`, the mcp-server
runs in a container, and **there is no /tmp mount** — so the default returns a
path that exists nowhere you can open, and nothing errors. MEASURED 2026-10-11
in both directions: a file written to the container's `/tmp` is absent on the
host, while `/app/fetched` → `/home/ben/files/unibrowse-fetched` →
`/mnt/nas/data/files/unibrowse-fetched`, readable from every host over NFS.
⚠️ The tool's own response says `pathsAre: "container-local"` and warns you not
to share the paths. That warning is right for `/tmp` and **WRONG for
`/app/fetched`**, which is bind-mounted and perfectly shareable — verified by
reading the file back on the host.

**NEVER PULL A SCREENSHOT THROUGH A TOOL RESPONSE.** `browser_screenshot`
returns base64 at a measured 0.955 tokens per source byte. A 52 KB PNG — the
small example page below — is **~49,600 tokens**. Capture to disk and `Read` it.
This single choice dominates the cost of visual work.

## ⚠️ Your screenshots are root-owned and you cannot delete them

MEASURED 2026-10-11: the container writes as root, so a PNG under
`/app/fetched/...` lands on the host owned by `root:root`. `rm` as `ben` fails
with Permission denied. ⇒ Clean up through the container:
`docker exec unibrowse-mcp-server rm -rf /app/fetched/<yours>`
⛔ Use your own subdirectory under `/app/fetched` and delete it when finished.
That tree is `/mnt/nas/data/files/unibrowse-fetched`, it is shared fleet-wide,
and nobody else can clear your leftovers either.

## ⚠️ Container sidecars lack fonts

MEASURED 2026-10-11: capturing example.com in a container sidecar rendered the
Arabic and Chinese paragraphs as tofu boxes while Latin text was fine. ⇒ A
visual critique of non-Latin text taken in a sidecar will report a font bug that
exists only in the container. Judge non-Latin UI on a real desktop browser.

## Picking a browser

⛔ Never capture in a browser that belongs to someone else's work without asking
— `office-site-browsers.sh map` names every profile's extensionId.
⛔ Never use `claudelogin` (the fleet's account-swap browser) or `alpacasignup`.
⭐ For a throwaway page with no login, a container sidecar is the polite choice.
For anything authenticated, you need the real browser that holds that session —
which is the entire reason this exists.
