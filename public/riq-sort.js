/**
 * RIQ table sort helper — drop-in click-to-sort for existing tables.
 *
 * Usage (either):
 *   <script src="/riq-sort.js"></script>
 *   <table data-riq-sort> ... </table>   // sorts every TH automatically
 *
 *   or call manually: RIQSort.attach(tableElement)
 *
 * Cell parsing:
 *   - If a TH has data-sort-type="num" | "pct" | "money" | "date" | "text",
 *     that type is used. Otherwise inferred from the first non-empty cell.
 *   - data-sort-value="..." on a TD overrides the parsed value.
 *
 * Mark the default-sort column with data-sort-default-desc or data-sort-default-asc
 * on the TH to set the initial state (single click cycles direction).
 */
(function () {
  const NUM_RE = /^-?\$?\s*[\d,]+(\.\d+)?\s*%?$/;
  const DATE_RE = /^\d{4}-\d{2}-\d{2}/;
  const MONEY_RE = /^-?\$/;
  const PCT_RE = /%\s*$/;

  function parseCell(td, type) {
    const override = td.getAttribute('data-sort-value');
    const txt = (override != null ? override : (td.innerText || td.textContent || '')).trim();
    if (txt === '' || txt === '—' || txt === 'N/A') return type === 'text' ? '' : -Infinity;
    switch (type) {
      case 'num':
      case 'money':
      case 'pct':
        return parseFloat(txt.replace(/[$,%\s]/g, '')) || 0;
      case 'date':
        return new Date(txt).getTime() || 0;
      case 'text':
      default:
        return txt.toLowerCase();
    }
  }

  function inferType(rows, colIdx) {
    for (const r of rows) {
      const td = r.children[colIdx];
      if (!td) continue;
      const t = (td.innerText || td.textContent || '').trim();
      if (!t || t === '—' || t === 'N/A') continue;
      if (MONEY_RE.test(t)) return 'money';
      if (PCT_RE.test(t)) return 'pct';
      if (DATE_RE.test(t)) return 'date';
      if (NUM_RE.test(t)) return 'num';
      return 'text';
    }
    return 'text';
  }

  function attach(table) {
    if (!table || table.dataset.riqSortAttached === '1') return;
    table.dataset.riqSortAttached = '1';

    const ths = [...table.querySelectorAll('thead th')];
    if (ths.length === 0) return;

    // Inject minimal style once
    if (!document.getElementById('riq-sort-style')) {
      const s = document.createElement('style');
      s.id = 'riq-sort-style';
      s.textContent = `
        th[data-riq-sortable] { cursor: pointer; user-select: none; position: relative; }
        th[data-riq-sortable]:hover { color: var(--accent, #f4a738); }
        th[data-riq-sort-active]::after { content: attr(data-riq-sort-arrow); margin-left: 4px; color: var(--accent, #f4a738); }
      `;
      document.head.appendChild(s);
    }

    let activeCol = null;
    let activeDir = -1;
    let activeType = 'text';

    ths.forEach((th, idx) => {
      if (th.getAttribute('data-sort-skip') === '1') return;
      th.setAttribute('data-riq-sortable', '1');

      const initDesc = th.hasAttribute('data-sort-default-desc');
      const initAsc = th.hasAttribute('data-sort-default-asc');

      th.addEventListener('click', () => {
        const tbody = table.querySelector('tbody');
        if (!tbody) return;
        const rows = [...tbody.querySelectorAll('tr')];
        if (rows.length === 0) return;

        const type = th.getAttribute('data-sort-type') || inferType(rows, idx);

        if (activeCol === idx) {
          activeDir *= -1;
        } else {
          activeCol = idx;
          activeDir = (type === 'text') ? 1 : -1;
          activeType = type;
        }

        ths.forEach((x) => {
          x.removeAttribute('data-riq-sort-active');
          x.removeAttribute('data-riq-sort-arrow');
        });
        th.setAttribute('data-riq-sort-active', '1');
        th.setAttribute('data-riq-sort-arrow', activeDir > 0 ? '▲' : '▼');

        rows.sort((a, b) => {
          const av = parseCell(a.children[idx], type);
          const bv = parseCell(b.children[idx], type);
          if (av < bv) return -1 * activeDir;
          if (av > bv) return 1 * activeDir;
          return 0;
        });
        rows.forEach((r) => tbody.appendChild(r));
      });

      if (initDesc || initAsc) {
        // Defer initial click until tbody likely has rows; if not, user clicks.
        setTimeout(() => {
          const tbody = table.querySelector('tbody');
          if (tbody && tbody.children.length > 0) th.click();
          if (initAsc) th.click(); // second click to flip if asc desired (default = desc on first click for num types)
        }, 0);
      }
    });

    // Re-attach on tbody mutation so dynamically-rendered tables work
    const tbody = table.querySelector('tbody');
    if (tbody && window.MutationObserver) {
      let lastSig = '';
      const obs = new MutationObserver(() => {
        if (activeCol == null) return;
        const sig = `${tbody.children.length}|${tbody.firstElementChild?.innerText?.slice(0,40)}`;
        if (sig === lastSig) return;
        lastSig = sig;
        // Re-apply current sort
        const th = ths[activeCol];
        if (!th) return;
        const rows = [...tbody.querySelectorAll('tr')];
        if (rows.length === 0) return;
        rows.sort((a, b) => {
          const av = parseCell(a.children[activeCol], activeType);
          const bv = parseCell(b.children[activeCol], activeType);
          if (av < bv) return -1 * activeDir;
          if (av > bv) return 1 * activeDir;
          return 0;
        });
        rows.forEach((r) => tbody.appendChild(r));
      });
      obs.observe(tbody, { childList: true });
    }
  }

  function autoAttachAll() {
    // Explicit opt-in (per-table)
    document.querySelectorAll('table[data-riq-sort]').forEach(attach);
    // Page-wide opt-in via <body data-riq-sort-all>
    if (document.body && document.body.hasAttribute('data-riq-sort-all')) {
      document.querySelectorAll('table').forEach((t) => {
        if (t.querySelector('thead th')) attach(t);
      });
    }
  }

  window.RIQSort = { attach, autoAttachAll };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoAttachAll);
  } else {
    autoAttachAll();
  }

  // Re-scan periodically for tables added after load
  let scans = 0;
  const scanTimer = setInterval(() => {
    autoAttachAll();
    scans += 1;
    if (scans > 20) clearInterval(scanTimer);
  }, 500);
})();
