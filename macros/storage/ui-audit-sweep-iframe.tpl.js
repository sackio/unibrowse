async (params) => {
  const AUDIT_SRC = __AUDIT_SRC__;
  const src = params.auditSrc || AUDIT_SRC;
  const widths = params.widths && params.widths.length ? params.widths : [320,360,390,414,480,600,768,834,1024,1280,1440,1680,1920];
  const height = params.height || 900;
  const expect = params.expect || [];
  const url = params.url || location.href;
  const settleMs = params.settleMs == null ? 400 : params.settleMs;
  const openDetails = params.openDetails === false ? false : true;
  const ifr = document.createElement('iframe');
  ifr.setAttribute('aria-hidden', 'true');
  Object.assign(ifr.style, { position: 'fixed', right: '0', bottom: '0', border: '0', opacity: '0.001', pointerEvents: 'none', zIndex: '-1', height: height + 'px', width: widths[0] + 'px' });
  document.body.appendChild(ifr);
  const loadedEvent = await new Promise((res) => {
    ifr.onload = () => res('load');
    ifr.onerror = () => res('error');
    setTimeout(() => res('timeout'), params.loadTimeoutMs || 20000);
    ifr.src = url;
  });
  let doc = null, access = null;
  try { doc = ifr.contentDocument; } catch (e) { access = e.message; }
  const kids = doc && doc.body ? doc.body.children.length : 0;
  if (!doc || !doc.body || (kids === 0 && !(doc.body.innerText || '').trim())) {
    const loc = (function(){ try { return ifr.contentWindow.location.href; } catch(e){ return 'blocked: ' + e.message; } })();
    ifr.remove();
    return { ok: false, error: 'iframe-empty', loadedEvent, crossOriginError: access, frameUrl: loc, requestedUrl: url,
      detail: 'The iframe produced no document to measure. OBSERVED, not diagnosed: load event = ' + loadedEvent + ', frame url = ' + loc + '. Likely X-Frame-Options / CSP frame-ancestors on the target, but this code cannot read response headers, so do not report that as the cause -- DISCRIMINATOR: curl -sS -I <url> | grep -iE "x-frame|content-security". Either way the fallback is the faithful path: browser_set_device_metrics({width,height}) then browser_execute_macro(ui-audit-current-viewport) per width, then browser_set_device_metrics({reset:true}).' };
  }
  const win = ifr.contentWindow;
  const runPass = (w) => { try { win.__uiauditExpect = expect; } catch (e) {} return win.eval(src); };
  const perWidth = [];
  let detailsOpened = 0;
  for (const w of widths) {
    ifr.style.width = w + 'px';
    void ifr.offsetWidth;
    await new Promise(r => setTimeout(r, settleMs));
    let r;
    try { r = runPass(w); } catch (e) {
      ifr.remove();
      return { ok: false, error: 'csp-blocks-eval', requestedUrl: url, width: w, cause: e.message,
        detail: 'The framed document forbids eval, so the audit function cannot be injected into its realm. Use the faithful path: browser_set_device_metrics per width + the ui-audit-current-viewport macro, whose body is injected over CDP and is not subject to page CSP.' };
    }
    const findings = (r && r.findings) ? r.findings.slice() : [];
    if (openDetails) {
      const d = [...doc.querySelectorAll('details:not([open])')];
      if (d.length) {
        detailsOpened = Math.max(detailsOpened, d.length);
        d.forEach(x => { x.open = true; });
        await new Promise(r2 => setTimeout(r2, 60));
        const seen = new Set(findings.map(f => f.check + f.sel));
        let r2 = null;
        try { r2 = runPass(w); } catch (e) { r2 = null; }
        for (const f of (r2 && r2.findings) || [])
          if (!seen.has(f.check + f.sel) && f.check !== 'text-overlap')
            findings.push(Object.assign({}, f, { detail: f.detail + ' (with menus/details open)' }));
        d.forEach(x => { x.open = false; });
      }
    }
    perWidth.push({ width: w, innerWidth: (function(){ try { return win.innerWidth; } catch(e){ return null; } })(), findings });
  }
  ifr.remove();
  const byKey = new Map();
  for (const p of perWidth) for (const f of p.findings) {
    const k = f.check + '|' + f.sel + '|' + (/ \(with menus\/details open\)$/.test(f.detail || '') ? 'open' : 'closed');
    if (!byKey.has(k)) byKey.set(k, { check: f.check, sel: f.sel, detail: f.detail, widths: [] });
    byKey.get(k).widths.push(p.width);
  }
  const order = ['expected-missing','expected-hidden','expected-off-viewport','expected-covered','page-overflow-x','element-off-viewport','text-clipped','text-clipped-vertically','text-overlap','text-spills-box','image-distorted','tap-target-small','text-too-small','text-ellipsized'];
  const rank = c => { const i = order.indexOf(c); return i < 0 ? 99 : i; };
  const findings = [...byKey.values()].sort((a, b) => rank(a.check) - rank(b.check) || a.sel.localeCompare(b.sel));
  const widthsMeasured = perWidth.map(p => p.innerWidth);
  const mismatch = perWidth.filter(p => p.innerWidth !== null && Math.abs(p.innerWidth - p.width) > 1).map(p => p.width + '->' + p.innerWidth);
  return { ok: true, mode: 'iframe', requestedUrl: url, loadedEvent, widths, widthsMeasured,
    widthMismatch: mismatch.length ? mismatch : undefined,
    detailsOpenedPerWidth: openDetails ? detailsOpened : 'skipped',
    findings,
    limits: 'MEASURED IN A FRESHLY LOADED IFRAME, NOT THE LIVE TAB. Cookies carry (same-origin), so a logged-in page renders logged in -- but SPA state, open modals, scroll position and anything typed are absent, and scrollbar width can shift a finding by a pixel or two. Confirm anything that matters at that one width with the CDP path.' };
}
