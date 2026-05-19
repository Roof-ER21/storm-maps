#!/usr/bin/env node
// Compute contractor-margin intel from pricing-items.json (Roof Docs's
// charged price) vs pricing-contractor.json (what subs cost us per line
// item). Surfaces:
//   - Overall margin (avg %, total $ on the table)
//   - By trade: where we make/lose money
//   - By contractor: each sub's overall margin profile
//   - Worst lines: items where we're upside-down (sub costs > our charge)
//   - Best lines: highest-margin items
//
// Output: data/pricing-margins.json (~30 KB)
//
// NOTE: This is a simplified margin model. Real margin depends on quantity
// per job + supplemental adjustments + overhead absorption. Treat these
// numbers as directional signals — "we should not charge less than the sub
// costs us for fur-out brick" — not as bottom-line P&L.

import fs from 'node:fs';

const RIQ_BASE = process.env.RIQ_BASE || '/Users/a21/storm-maps';
const ITEMS = `${RIQ_BASE}/data/roofdocs-reference/pricing-items.json`;
const CONTRACTOR = `${RIQ_BASE}/data/roofdocs-reference/pricing-contractor.json`;
const OUT = `${RIQ_BASE}/data/pricing-margins.json`;

const items = JSON.parse(fs.readFileSync(ITEMS, 'utf8')).data;
const contractor = JSON.parse(fs.readFileSync(CONTRACTOR, 'utf8')).data;

const itemMap = new Map();
for (const i of items) itemMap.set(i.pricingID, i);

const lines = [];
for (const c of contractor) {
  const item = itemMap.get(c.pricingLibraryId);
  if (!item) continue;
  if (!(item.price > 0) || !(c.price > 0)) continue;
  const margin = (item.price - c.price) / item.price;
  lines.push({
    contractorId: c.contractorId,
    contractorName: c.contractor?.companyName || '(unknown contractor)',
    description: item.description,
    displayName: item.displayName,
    trade: item.trade,
    subtrade: item.subtrade,
    type: item.type,
    ourPrice: item.price,
    contractorPrice: c.price,
    margin,
    marginDollars: item.price - c.price,
  });
}

// By trade
const tradeMap = new Map();
for (const l of lines) {
  const t = l.trade || '(uncategorized)';
  const b = tradeMap.get(t) ?? { count: 0, marginSum: 0, ourSum: 0, contractorSum: 0, worstMargin: 1 };
  b.count += 1;
  b.marginSum += l.margin;
  b.ourSum += l.ourPrice;
  b.contractorSum += l.contractorPrice;
  if (l.margin < b.worstMargin) b.worstMargin = l.margin;
  tradeMap.set(t, b);
}
const byTrade = [...tradeMap.entries()]
  .map(([trade, b]) => ({
    trade,
    lineCount: b.count,
    avgMargin: b.marginSum / b.count,
    avgOurPrice: b.ourSum / b.count,
    avgContractorPrice: b.contractorSum / b.count,
    worstMargin: b.worstMargin,
  }))
  .sort((a, b) => b.avgMargin - a.avgMargin);

// By contractor
const contractorMap = new Map();
for (const l of lines) {
  const k = l.contractorId;
  const b = contractorMap.get(k) ?? { name: l.contractorName, count: 0, marginSum: 0, losers: 0 };
  b.count += 1;
  b.marginSum += l.margin;
  if (l.margin < 0) b.losers += 1;
  contractorMap.set(k, b);
}
const byContractor = [...contractorMap.entries()]
  .map(([contractorId, b]) => ({
    contractorId,
    contractorName: b.name,
    lineCount: b.count,
    avgMargin: b.marginSum / b.count,
    underwaterLines: b.losers,
  }))
  .sort((a, b) => a.avgMargin - b.avgMargin); // worst contractors first

// Worst lines (we lose most $ or worst %)
const worstByPercent = [...lines].sort((a, b) => a.margin - b.margin).slice(0, 30);
const bestByPercent = [...lines].sort((a, b) => b.margin - a.margin).slice(0, 20);

const overall = {
  totalLines: lines.length,
  avgMargin: lines.reduce((s, l) => s + l.margin, 0) / lines.length,
  underwaterLines: lines.filter((l) => l.margin < 0).length,
  brokeEvenLines: lines.filter((l) => l.margin >= 0 && l.margin < 0.05).length,
  healthyLines: lines.filter((l) => l.margin >= 0.20).length,
};

fs.writeFileSync(OUT, JSON.stringify({
  generated: new Date().toISOString(),
  overall,
  byTrade,
  byContractor,
  worstByPercent,
  bestByPercent,
}));

console.log(`Wrote ${OUT}`);
console.log(`  ${overall.totalLines} contractor↔item line matches`);
console.log(`  Avg margin: ${(overall.avgMargin * 100).toFixed(1)}%`);
console.log(`  Underwater (sub > us): ${overall.underwaterLines} lines`);
console.log(`  Break-even (<5%): ${overall.brokeEvenLines} lines`);
console.log(`  Healthy (≥20%): ${overall.healthyLines} lines`);
console.log('  By trade:');
for (const t of byTrade) console.log(`    ${t.trade}: ${(t.avgMargin*100).toFixed(1)}% avg (n=${t.lineCount})`);
