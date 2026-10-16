(params) => {
  const expect = (params && params.expect) || [];
  const openDetails = params && params.openDetails === false ? false : true;
  window.__uiauditExpect = expect;
  const run = () => { return (
__AUDIT_IIFE__
);  };
  const first = run();
  const findings = (first.findings || []).slice();
  let opened = 0;
  if (openDetails) {
    const d = [...document.querySelectorAll('details:not([open])')];
    opened = d.length;
    if (opened) {
      d.forEach(x => { x.open = true; });
      const seen = new Set(findings.map(f => f.check + f.sel));
      for (const f of (run().findings || []))
        if (!seen.has(f.check + f.sel) && f.check !== 'text-overlap')
          findings.push(Object.assign({}, f, { detail: f.detail + ' (with menus/details open)' }));
      d.forEach(x => { x.open = false; });
    }
  }
  return { ok: true, mode: 'current-viewport', url: location.href,
    width: first.width, height: first.height, expect, detailsOpened: openDetails ? opened : 'skipped',
    findings,
    note: 'ONE viewport: whatever this tab is set to right now. Sweep with browser_set_device_metrics({width,height}) before each call, and browser_set_device_metrics({reset:true}) when done -- an un-reset override follows the tab into every later screenshot and every other seat’s work on it. `width` is the measured innerWidth: if it is not what you asked for, the override did not take and the findings are for the wrong width.' };
}
