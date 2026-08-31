/**
 * Extract a page — or the current selection — as markdown, html, or text.
 *
 * ⛔ THIS FUNCTION IS INJECTED INTO THE PAGE, so it must be entirely
 * self-contained: no closure references, no imports, nothing from the service
 * worker's scope. chrome.scripting serialises the SOURCE and evaluates it in
 * the target document, so a reference to anything outside it is a
 * ReferenceError at the far end — reported as an empty result, not an error.
 *
 * It lives in its own file (importScripts'd into background.js) only so the
 * 8k-line background stays navigable; it is still injected by reference.
 */

/* exported extractPageContent */
function extractPageContent(scope, format) {
  // ── selection or whole document ────────────────────────────────────────
  const sel = window.getSelection && window.getSelection();
  const hasSelection = !!(sel && String(sel).trim().length > 0 && sel.rangeCount > 0);

  if (scope === 'selection' && !hasSelection) {
    // ⛔ Never silently fall back to the whole page. Someone who selected a
    // paragraph and got the entire document would not notice until the
    // recipient acted on the wrong thing.
    return {
      ok: false,
      error: 'Nothing is selected on this page. Select some text first, or send the whole page instead.',
    };
  }

  let root;
  if (scope === 'selection') {
    const frag = sel.getRangeAt(0).cloneContents();
    root = document.createElement('div');
    root.appendChild(frag);
  } else {
    root = document.body ? document.body.cloneNode(true) : document.createElement('div');
    // Strip the things that are never content.
    const junk = root.querySelectorAll('script, style, noscript, template, svg, iframe, object, embed');
    for (const n of junk) n.remove();
    // unibrowse's own page furniture must not travel with the content.
    const ours = root.querySelectorAll(
      '#__unibrowse_sr_overlay, [id^="__unibrowse"], [class^="__unibrowse"]',
    );
    for (const n of ours) n.remove();
  }

  const title = document.title || '';
  const url = location.href;

  if (format === 'html') {
    return { ok: true, content: root.innerHTML, format: 'html', title, url, scope };
  }
  if (format === 'text') {
    return { ok: true, content: (root.innerText || root.textContent || '').trim(), format: 'text', title, url, scope };
  }

  // ── markdown ───────────────────────────────────────────────────────────
  // A deliberately small converter: headings, emphasis, links, images, code,
  // lists, blockquotes, tables, rules. Anything it does not know becomes its
  // text, which degrades to readable prose rather than to markup soup.
  const INLINE_SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG']);

  function esc(t) {
    return t.replace(/([\\`*_[\]])/g, '\\$1');
  }

  function inline(node) {
    let out = '';
    for (const child of node.childNodes) {
      if (child.nodeType === 3) {
        out += esc(child.nodeValue.replace(/\s+/g, ' '));
        continue;
      }
      if (child.nodeType !== 1) continue;
      const tag = child.tagName;
      if (INLINE_SKIP.has(tag)) continue;
      const inner = inline(child);
      if (tag === 'STRONG' || tag === 'B') out += inner.trim() ? `**${inner.trim()}**` : '';
      else if (tag === 'EM' || tag === 'I') out += inner.trim() ? `*${inner.trim()}*` : '';
      else if (tag === 'CODE') out += '`' + (child.textContent || '') + '`';
      else if (tag === 'BR') out += '\n';
      else if (tag === 'A') {
        const href = child.getAttribute('href') || '';
        out += href && inner.trim() ? `[${inner.trim()}](${href})` : inner;
      } else if (tag === 'IMG') {
        const alt = child.getAttribute('alt') || '';
        const src = child.getAttribute('src') || '';
        if (src) out += `![${alt}](${src})`;
      } else out += inner;
    }
    return out;
  }

  const lines = [];

  function block(node, listPrefix, depth) {
    for (const child of node.childNodes) {
      if (child.nodeType === 3) {
        const t = child.nodeValue.replace(/\s+/g, ' ').trim();
        if (t) lines.push(esc(t));
        continue;
      }
      if (child.nodeType !== 1) continue;
      const tag = child.tagName;
      if (INLINE_SKIP.has(tag)) continue;

      if (/^H[1-6]$/.test(tag)) {
        const t = inline(child).trim();
        if (t) lines.push('', '#'.repeat(Number(tag[1])) + ' ' + t, '');
      } else if (tag === 'P') {
        const t = inline(child).trim();
        if (t) lines.push(t, '');
      } else if (tag === 'PRE') {
        const t = (child.textContent || '').replace(/\s+$/, '');
        if (t) lines.push('```', t, '```', '');
      } else if (tag === 'BLOCKQUOTE') {
        const before = lines.length;
        block(child, listPrefix, depth);
        for (let i = before; i < lines.length; i++) if (lines[i]) lines[i] = '> ' + lines[i];
        lines.push('');
      } else if (tag === 'UL' || tag === 'OL') {
        let n = 1;
        for (const li of child.children) {
          if (li.tagName !== 'LI') continue;
          const marker = tag === 'OL' ? `${n++}. ` : '- ';
          const t = inline(li).trim();
          if (t) lines.push('  '.repeat(depth) + marker + t);
          // Nested lists inside this item.
          const nested = li.querySelectorAll(':scope > ul, :scope > ol');
          for (const sub of nested) block(li, marker, depth + 1);
        }
        lines.push('');
      } else if (tag === 'TABLE') {
        const rows = child.querySelectorAll('tr');
        let wroteHeader = false;
        for (const tr of rows) {
          const cells = tr.querySelectorAll('th, td');
          if (!cells.length) continue;
          const vals = Array.from(cells).map((c) => inline(c).trim().replace(/\|/g, '\\|') || ' ');
          lines.push('| ' + vals.join(' | ') + ' |');
          if (!wroteHeader) {
            lines.push('| ' + vals.map(() => '---').join(' | ') + ' |');
            wroteHeader = true;
          }
        }
        lines.push('');
      } else if (tag === 'HR') {
        lines.push('', '---', '');
      } else if (tag === 'LI') {
        const t = inline(child).trim();
        if (t) lines.push('  '.repeat(depth) + '- ' + t);
      } else {
        block(child, listPrefix, depth);
      }
    }
  }

  block(root, '', 0);

  const md = lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { ok: true, content: md, format: 'markdown', title, url, scope };
}
