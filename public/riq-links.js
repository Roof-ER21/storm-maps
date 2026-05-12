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
  function custKey(job) {
    return (
      String(job.customer || '').trim().toLowerCase() + '|' +
      String(job.addressLine1 || '').trim().toLowerCase() + '|' +
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

  global.RIQ = global.RIQ || {};
  global.RIQ.custKey = custKey;
  global.RIQ.custProfileUrl = custProfileUrl;
  global.RIQ.jobProfileUrl = jobProfileUrl;
  global.RIQ.portalUrl = portalUrl;
  global.RIQ.custLink = custLink;
  global.RIQ.jobLink = jobLink;
  global.RIQ.portalLink = portalLink;
  global.RIQ.escapeHtml = escapeHtml;
})(window);
