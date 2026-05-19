#!/usr/bin/env node
// Clean pricing-templates.json — surface estimate template definitions
// (ProjectMeeting/Supplement/Contractor/Labor groupings used in scoping).

import fs from 'node:fs';

const RIQ_BASE = process.env.RIQ_BASE || '/Users/a21/storm-maps';
const IN = `${RIQ_BASE}/data/roofdocs-reference/pricing-templates.json`;
const OUT = `${RIQ_BASE}/data/pricing-templates.json`;

const raw = JSON.parse(fs.readFileSync(IN, 'utf8'));
const data = raw.data || [];

const out = data.map((t) => {
  const items = t.templateItems || [];
  const totalPrice = items.reduce((s, it) => s + (it.lineItem?.price || 0), 0);
  return {
    pricingTemplateID: t.pricingTemplateID,
    name: t.name,
    type: t.type,
    trade: t.trade,
    subtrade: t.subtrade,
    insuranceLevel: t.insuranceLevel,
    retailLevel: t.retailLevel,
    minimumPrice: t.minimumPrice,
    itemCount: items.length,
    totalPrice: Math.round(totalPrice * 100) / 100,
    sampleItems: items.slice(0, 5).map((it) => ({
      description: it.lineItem?.description,
      type: it.lineItem?.type,
      price: it.lineItem?.price,
      ordering: it.lineItem?.ordering,
    })),
  };
});

// Stats
const byType = {};
const byTrade = {};
for (const t of out) {
  byType[t.type || '(none)'] = (byType[t.type || '(none)'] || 0) + 1;
  byTrade[t.trade || '(uncategorized)'] = (byTrade[t.trade || '(uncategorized)'] || 0) + 1;
}

fs.writeFileSync(OUT, JSON.stringify({
  generated: new Date().toISOString(),
  totals: {
    count: out.length,
    withItems: out.filter((t) => t.itemCount > 0).length,
    avgItems: out.reduce((s, t) => s + t.itemCount, 0) / out.length,
    totalLineValue: Math.round(out.reduce((s, t) => s + t.totalPrice, 0) * 100) / 100,
  },
  byType,
  byTrade,
  templates: out.sort((a, b) => b.itemCount - a.itemCount),
}));

console.log(`Wrote ${OUT} — ${out.length} templates`);
console.log('  by type:', byType);
console.log('  by trade:', byTrade);
