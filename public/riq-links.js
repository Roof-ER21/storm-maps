// RIQ 21 shared link helpers — used by every static page that lists
// customers or jobs so clicking a name/ID opens the customer profile.
//
// Usage:
//   <script src="/riq-links.js"></script>
//   ...
//   <td>${RIQ.custLink(job)}</td>           // <a href="customer-detail.html?k=...">Jane Smith</a>
//   <td>${RIQ.jobLink(job)}</td>            // <a href="...">12345</a> ← opens customer view, scrolled to this job
//   <td>${RIQ.portalLink(job)}</td>         // <a href="https://portal.theroofdocs.com/jobs/12345" target="_blank">🔗 Portal</a>
//
// Backend has /api/intel/* serving everything; these helpers just standardize
// the cross-page navigation contract so we don't reinvent it on every page.

(function (global) {
  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Match customer-detail.html's custKey(): lower(customer) | lower(addressLine1) | lower(city)
  // Resilient to records that store `address` as a single concat'd string (e.g.
  // resurrection.json, carrier-orphans.json) instead of split addressLine1/city.
  function custKey(job) {
    let addr = job.addressLine1;
    if (!addr && job.address) {
      // "23997 Bishop Meade Pl, Ashburn, VA, 20148" → "23997 Bishop Meade Pl"
      addr = String(job.address).split(',')[0];
    }
    return (
      String(job.customer || '').trim().toLowerCase() + '|' +
      String(addr || '').trim().toLowerCase() + '|' +
      String(job.city || '').trim().toLowerCase()
    );
  }

  function custProfileUrl(job) {
    const k = custKey(job);
    return 'customer-detail.html?k=' + encodeURIComponent(k);
  }

  function jobProfileUrl(job) {
    const k = custKey(job);
    return 'customer-detail.html?k=' + encodeURIComponent(k) + '&job=' + encodeURIComponent(job.id || job.jobId || '');
  }

  function portalUrl(job) {
    return 'https://portal.theroofdocs.com/jobs/' + encodeURIComponent(job.id || job.jobId || '');
  }

  function custLink(job, opts) {
    if (!job || !job.customer) return escapeHtml((job && job.customer) || '');
    const cls = (opts && opts.class) || 'riq-link';
    return '<a class="' + cls + '" href="' + custProfileUrl(job) + '">' + escapeHtml(job.customer) + '</a>';
  }

  function jobLink(job, opts) {
    const id = job.id || job.jobId;
    if (!id) return '';
    const cls = (opts && opts.class) || 'riq-link';
    const label = (opts && opts.label) || ('#' + id);
    return '<a class="' + cls + '" href="' + jobProfileUrl(job) + '">' + escapeHtml(label) + '</a>';
  }

  function portalLink(job, label) {
    const id = job.id || job.jobId;
    if (!id) return '';
    return '<a href="' + portalUrl(job) + '" target="_blank" rel="noreferrer" class="riq-link-portal">' + (label || '🔗 Portal') + '</a>';
  }

  // Common style block — pages can append to their <style> or import.
  const STYLE_BLOCK =
    '.riq-link { color: var(--accent, #f4a738); text-decoration: none; }' +
    '.riq-link:hover { text-decoration: underline; }' +
    '.riq-link-portal { color: var(--muted, #a09486); text-decoration: none; font-size: 11px; margin-left: 6px; }' +
    '.riq-link-portal:hover { color: var(--accent, #f4a738); }';

  // Auto-inject the style block once per page so consumers don't have to.
  if (typeof document !== 'undefined' && !document.getElementById('riq-link-styles')) {
    const s = document.createElement('style');
    s.id = 'riq-link-styles';
    s.textContent = STYLE_BLOCK;
    document.head.appendChild(s);
  }

  // Data-freshness badge — fetches /api/intel/health and shows when projects
  // were last refreshed from the portal. So every screen with a number on it
  // also tells you HOW STALE that number might be.
  async function installFreshnessBadge() {
    if (document.getElementById('riq-freshness')) return;
    const wrap = document.createElement('div');
    wrap.id = 'riq-freshness';
    wrap.style.cssText = [
      'position: fixed', 'bottom: 12px', 'right: 12px', 'z-index: 9999',
      'background: rgba(42, 36, 30, 0.95)',
      'border: 1px solid #3d3528', 'border-radius: 6px',
      'padding: 6px 12px', 'font-size: 11px',
      'font-family: -apple-system, system-ui, sans-serif',
      'color: #a09486', 'box-shadow: 0 2px 8px rgba(0,0,0,0.3)',
      'cursor: default', 'user-select: none',
    ].join(';');
    wrap.textContent = '⟳ checking…';
    document.body.appendChild(wrap);
    try {
      const r = await fetch('/api/intel/health', { cache: 'no-store' });
      if (!r.ok) throw new Error('health ' + r.status);
      const d = await r.json();
      // Use projects file age as the "data age" since it drives everything
      const proj = d.files?.projects;
      const ageH = proj?.ageHours;
      if (ageH == null) {
        wrap.textContent = '⚠ no portal data yet';
        wrap.style.color = '#e07b5a';
        return;
      }
      let color = '#9ed27a', icon = '✓';
      if (ageH > 36) { color = '#e0a04f'; icon = '⚠'; }
      if (ageH > 72) { color = '#e07b5a'; icon = '!'; }
      const ageStr = ageH < 1 ? `${Math.round(ageH * 60)}m`
        : ageH < 24 ? `${ageH.toFixed(1)}h`
        : `${(ageH / 24).toFixed(1)}d`;
      wrap.innerHTML = `<span style="color:${color}">${icon}</span> Portal data: <strong style="color:#f0ebe2">${ageStr}</strong> old · <span style="color:#f4a738">${d.storageBacking || 'unknown'}</span>`;
      wrap.title = `Last portal refresh: ${proj.bytes.toLocaleString()} bytes\nLatest refresh: ${ageH.toFixed(2)}h ago\nStorage: ${d.storageBacking}\nClick to dismiss`;
      wrap.style.cursor = 'pointer';
      wrap.addEventListener('click', () => wrap.remove());
    } catch (e) {
      wrap.textContent = '⚠ data status unknown';
      wrap.style.color = '#a09486';
    }
  }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', installFreshnessBadge);
    } else {
      installFreshnessBadge();
    }
  }

  // Phase 5: shareable list helper. Posts current filtered data to
  // /api/intel/share and shows a copyable short URL in a modal.
  async function shareList(listType, title, description, rows) {
    if (!Array.isArray(rows) || rows.length === 0) {
      alert('No rows to share. Adjust filters first.');
      return;
    }
    // Cap to first 1000 rows to stay under the 1.5MB server cap.
    const trimmed = rows.slice(0, 1000);
    let resp;
    try {
      const res = await fetch('/api/intel/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          list_type: listType,
          title,
          description,
          snapshot_data: trimmed,
          filter_params: { capturedAt: new Date().toISOString(), totalRows: rows.length },
          expires_in_days: 30,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'http_' + res.status }));
        alert('Share failed: ' + (err.error || err.message || res.status));
        return;
      }
      resp = await res.json();
    } catch (e) {
      alert('Share failed: ' + (e?.message || e));
      return;
    }
    // Inline modal — uses page theme tokens, falls back to defaults if absent.
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:9999';
    overlay.innerHTML = '<div style="background:#2a241e;border:1px solid #3d3528;border-radius:8px;padding:24px;max-width:520px;width:90%">' +
      '<div style="font-size:14px;color:#a09486;margin-bottom:4px">RIQ 21 · Share Link Created</div>' +
      '<h2 style="margin:0 0 12px;color:#f0ebe2;font-size:18px">' + escapeHtml(title) + '</h2>' +
      '<div style="color:#a09486;font-size:12px;margin-bottom:16px">' + trimmed.length + ' rows · expires in 30 days</div>' +
      '<input id="share-url" type="text" readonly value="' + escapeHtml(resp.url) + '" style="width:100%;background:#342c23;color:#f0ebe2;border:1px solid #3d3528;border-radius:4px;padding:10px;font-size:13px;font-family:monospace" />' +
      '<div style="margin-top:12px;display:flex;gap:8px;justify-content:flex-end">' +
        '<button id="share-copy" style="background:#f4a738;color:#1a1612;border:none;border-radius:4px;padding:8px 16px;font-size:13px;font-weight:600;cursor:pointer">Copy</button>' +
        '<button id="share-close" style="background:transparent;color:#a09486;border:1px solid #3d3528;border-radius:4px;padding:8px 16px;font-size:13px;cursor:pointer">Close</button>' +
      '</div></div>';
    document.body.appendChild(overlay);
    document.getElementById('share-copy').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(resp.url);
        document.getElementById('share-copy').textContent = 'Copied!';
        setTimeout(() => document.body.contains(overlay) && document.body.removeChild(overlay), 800);
      } catch {
        document.getElementById('share-url').select();
      }
    });
    document.getElementById('share-close').addEventListener('click', () => document.body.removeChild(overlay));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) document.body.removeChild(overlay); });
  }

  global.RIQ = global.RIQ || {};
  global.RIQ.custKey = custKey;
  global.RIQ.custProfileUrl = custProfileUrl;
  global.RIQ.jobProfileUrl = jobProfileUrl;
  global.RIQ.portalUrl = portalUrl;
  global.RIQ.custLink = custLink;
  global.RIQ.jobLink = jobLink;
  global.RIQ.portalLink = portalLink;
  global.RIQ.escapeHtml = escapeHtml;
  global.RIQ.installFreshnessBadge = installFreshnessBadge;
  global.RIQ.shareList = shareList;
})(window);
