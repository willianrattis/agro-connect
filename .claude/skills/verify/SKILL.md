---
name: verify
description: Verify Agro Connect's index.html visually with headless Chrome (no server, no build).
---

# Verifying Agro Connect (static single-file app)

The whole app is `index.html` — no build, no server needed (`file://` works,
inline `<script type="module">` runs fine from file://).

## Screenshot recipe (headless Chrome)

```bash
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
"$CHROME" --headless=new --disable-gpu --window-size=1024,800 \
  --virtual-time-budget=5000 --screenshot=out.png \
  "file:///…/agro-connect/index.html"
```

Gotchas learned the hard way:

- **Chrome enforces a ~500px minimum window width.** A `--window-size=360,…`
  screenshot silently renders a ~500px layout viewport and looks like a
  horizontal-overflow bug. For true mobile widths, wrap the page in an iframe
  harness (`<iframe style="width:360px;height:780px" src="file://…/index.html">`)
  and screenshot the harness at ≥560px window width.
- **Console errors:** add `--enable-logging=stderr` and grep stderr for
  `CONSOLE`. Chrome-internal `ERROR:` lines (mojo, web-app install, dns) are
  noise — only `[…:INFO/ERROR:CONSOLE(n)]` lines come from the page.
- **Skeleton/loading state:** `--virtual-time-budget` fast-forwards the 900 ms
  mock-fetch timer, so to capture the skeleton state screenshot *without* a
  virtual-time budget (load event fires before the timer).
- **Interactions (tab switches etc.):** no Playwright/puppeteer libs on this
  machine. Script clicks from an iframe harness (`f.contentDocument.getElementById(…).click()`)
  and launch Chrome with `--allow-file-access-from-files`.
- **Reduced motion:** `--force-prefers-reduced-motion`.

## Flows worth driving

- Rebanho view: skeletons → staggered card entrance, summary tiles get values.
- Bottom tab bar: click each tab, active pill + `aria-current` moves, views swap.
- ≥768px: tab bar becomes a left rail (screenshot at 1024 wide, no iframe needed).
- Reduced motion: cards must still be fully visible (no stuck opacity-0).
