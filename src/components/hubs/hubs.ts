/**
 * Hub configurations — each consolidated hub declares its tabs.
 *
 * Each tab points at an existing HTML page in /public so we don't break
 * anything during Phase 2b. Phase 2c will migrate the underlying pages
 * into React components and update the `src` to a route or a React node.
 */

export interface HubTab {
  id: string;
  label: string;
  /** HTML filename in /public/. Becomes a route in a later phase. */
  src: string;
}

export interface HubConfig {
  /** IntelView id, e.g. "carrier-hub" */
  view: string;
  /** Title shown above the tab bar */
  title: string;
  /** Sub-tabs. First entry = default. */
  tabs: HubTab[];
}

export const HUBS: HubConfig[] = [
  {
    view: "carrier-hub",
    title: "Carrier Intelligence",
    tabs: [
      { id: "overview",   label: "🏢 Overview",     src: "carrier-detail.html" },
      { id: "trades",     label: "🧾 × Trades",     src: "carrier-trades.html" },
      { id: "playbook",   label: "📕 Playbook",     src: "carrier-playbook.html" },
      { id: "algorithms", label: "🧠 Algorithms",   src: "carrier-algorithms.html" },
    ],
  },
  {
    view: "storm-hub",
    title: "Storm Response",
    tabs: [
      { id: "playbook", label: "🎯 Playbook",  src: "storm-playbook.html" },
      { id: "intel",    label: "🌪 By Storm",  src: "storm-intel.html" },
      { id: "exposure", label: "⚡ Exposure",  src: "storm-exposure.html" },
    ],
  },
  {
    view: "denial-hub",
    title: "Denial Combat",
    tabs: [
      { id: "analyze", label: "⚖️ Analyze",  src: "denial-analyzer.html" },
      { id: "archive", label: "📂 Archive",  src: "denial-archive.html" },
      { id: "stats",   label: "📊 Stats",    src: "denial-stats.html" },
    ],
  },
  {
    view: "adjuster-hub",
    title: "Adjusters",
    tabs: [
      { id: "directory", label: "📋 Directory",  src: "adjusters.html" },
      { id: "detail",    label: "🔍 Detail",     src: "adjuster-detail.html" },
      { id: "twin",      label: "🪞 Twin (AI)",  src: "adjuster-twin.html" },
    ],
  },
  {
    view: "rep-hub",
    title: "Sales Reps",
    tabs: [
      { id: "overview", label: "🎯 Overview",  src: "reps.html" },
      { id: "response", label: "⏱ Response",   src: "rep-response.html" },
    ],
  },
  {
    view: "customer-hub",
    title: "Customers",
    tabs: [
      { id: "list",     label: "👥 Roster",       src: "customers.html" },
      { id: "detail",   label: "👤 Detail",       src: "customer-detail.html" },
      { id: "lookup",   label: "🔍 Property",     src: "property-lookup.html" },
    ],
  },
  {
    view: "leads-hub",
    title: "Leads Funnel",
    tabs: [
      { id: "intel",  label: "📍 Intel",   src: "leads-intel.html" },
      { id: "funnel", label: "🚪 Funnel",  src: "leads.html" },
    ],
  },
  {
    view: "pricing-hub",
    title: "Pricing",
    tabs: [
      { id: "margins", label: "💰 Margins",  src: "pricing-margins.html" },
      { id: "library", label: "📚 Library",  src: "pricing-library.html" },
    ],
  },
  {
    view: "zip-hub",
    title: "ZIPs",
    tabs: [
      { id: "hot",    label: "🔥 Hot ZIPs",  src: "hot-zips.html" },
      { id: "intel",  label: "📋 Detail",    src: "zip-intel.html" },
    ],
  },
];

export function getHub(view: string): HubConfig | undefined {
  return HUBS.find((h) => h.view === view);
}
