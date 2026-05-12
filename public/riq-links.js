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
})(window);
