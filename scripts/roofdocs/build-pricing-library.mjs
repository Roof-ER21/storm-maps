#!/usr/bin/env node
// Round out the pricing inventory. Combines trades, components, materials,
// and project-meeting items into a single reference blob so the UI doesn't
// have to fan-fetch.

import fs from 'node:fs';

const RIQ_BASE = process.env.RIQ_BASE || '/Users/a21/RIQ21';
const REF = `${RIQ_BASE}/data/roofdocs-reference`;
const OUT = `${RIQ_BASE}/data/pricing-library.json`;

const trades = JSON.parse(fs.readFileSync(`${REF}/trades.json`, 'utf8')).data;
const components = JSON.parse(fs.readFileSync(`${REF}/pricing-components.json`, 'utf8')).data;
const materials = JSON.parse(fs.readFileSync(`${REF}/pricing-material.json`, 'utf8')).data;
const projectItems = JSON.parse(fs.readFileSync(`${REF}/pricing-project.json`, 'utf8')).data;

// Materials by trade (with totals)
const matByTrade = {};
for (const m of materials) {
  const t = m.trade || '(uncategorized)';
  if (!matByTrade[t]) matByTrade[t] = { count: 0, totalListPrice: 0, items: [] };
  matByTrade[t].count += 1;
  matByTrade[t].totalListPrice += m.price || 0;
  matByTrade[t].items.push({
    description: m.description,
    displayName: m.displayName,
    price: m.price,
    component: m.component,
    subtrade: m.subtrade,
    ordering: m.ordering,
  });
}
for (const t of Object.keys(matByTrade)) {
  matByTrade[t].avgPrice = matByTrade[t].count > 0 ? matByTrade[t].totalListPrice / matByTrade[t].count : 0;
  matByTrade[t].items.sort((a, b) => (b.price || 0) - (a.price || 0));
}

// Project items by trade
const projByTrade = {};
for (const p of projectItems) {
  const t = p.trade || '(uncategorized)';
  if (!projByTrade[t]) projByTrade[t] = [];
  projByTrade[t].push({
    id: p.projectMeetingItemID,
    description: p.description,
    subtrade: p.subtrade,
    component: p.component,
    markUpPercent: p.markUpPercent,
    selectionType: p.selectionType,
    componentCount: (p.components || []).length,
  });
}
for (const t of Object.keys(projByTrade)) projByTrade[t].sort((a, b) => (b.markUpPercent || 0) - (a.markUpPercent || 0));

// Components — strip empty descriptions, sort
const componentList = components
  .map((c) => ({ component: c.component, description: c.description }))
  .sort((a, b) => a.component.localeCompare(b.component));

const out = {
  generated: new Date().toISOString(),
  totals: {
    trades: trades.length,
    components: components.length,
    materials: materials.length,
    projectItems: projectItems.length,
  },
  trades: trades.sort((a, b) => a.tradeID - b.tradeID),
  components: componentList,
  materialsByTrade: matByTrade,
  projectItemsByTrade: projByTrade,
};

fs.writeFileSync(OUT, JSON.stringify(out));
console.log(`Wrote ${OUT}`);
console.log(`  ${trades.length} trades, ${components.length} components, ${materials.length} materials, ${projectItems.length} project items`);
console.log('  materials by trade:');
for (const [t, v] of Object.entries(matByTrade).sort((a, b) => b[1].count - a[1].count)) {
  console.log(`    ${t}: ${v.count} (avg $${v.avgPrice.toFixed(2)})`);
}
