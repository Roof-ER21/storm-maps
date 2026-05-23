# Pricing Hub

View id: `pricing-hub`
Deep-link: `/?view=pricing-hub&tab=<tabId>`
Roles: admin, analytics (exec and employee excluded)

Two-tab pricing intelligence hub. Replaced two standalone HTML pages. Restricted to admin and analytics roles.

---

## Tabs

### margins — Pricing Margins
File: `src/components/hubs/native/pricing/PricingMargins.tsx`

Subcontractor margin analysis. Shows which trade lines are underwater (subcontractor cost exceeds RIQ's billed amount), by trade and by contractor.

Endpoints:
- `GET /api/intel/pricing-margins` — on mount; overall KPIs + byTrade breakdown + byContractor breakdown + worstByPercent + bestByPercent. 718 line matches, avg -0.6%, 119 underwater items.
- `GET /api/intel/pricing-templates` — fire-and-forget; 48 estimate templates by trade; rendered in a separate "Templates" section. Empty templates (0 items) mean a stub was created but not populated.

### library — Pricing Library
File: `src/components/hubs/native/pricing/PricingLibrary.tsx`

Reference catalog of all trades, components, materials, and project-meeting items from the portal.

Endpoints:
- `GET /api/intel/pricing-library` — full catalog on mount; 14 trades + 72 components + 227 materials + 96 project-meeting items, combined into one blob

---

## Notable Behavior

- This hub is the most restricted in the platform: `exec` and `employee` cannot access it. This is intentional — margin data is considered internal finance information.
- The Margins tab is computed nightly from 4.4k active portal jobs. The underwater line-item list is the primary alert signal for ops to renegotiate subcontractor rates.
