#!/usr/bin/env node
// Pull the full Roof Docs employee roster from the portal's dashboard
// employees endpoint, then merge into data/employee-roster.json so
// the existing UUID → name lookup gets populated.
//
// Source endpoint: /api/dashboard/employees/all (561 employees per
// the 2026-04-15 API probe). Authenticated with the same x-access-token
// the other pull scripts use.
//
// Run: node scripts/roofdocs/pull-employee-roster.mjs
//
// Merge strategy: PRESERVE any manually-curated entries already in
// employee-roster.json (don't overwrite), ADD missing ones, FLAG
// soft-deleted users (disabled=true) in a _note field.

import fs from 'node:fs';
import path from 'node:path';

const RIQ_BASE = process.env.RIQ_BASE || '/Users/a21/storm-maps';
const SESSION_FILE = '/Users/a21/web-recon/data/sessions/theroofdocs.json';
const ROSTER_FILE = path.join(RIQ_BASE, 'data', 'employee-roster.json');

const session = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
const token = session.origins
  .find((o) => o.origin === 'https://portal.theroofdocs.com')
  ?.localStorage.find((kv) => kv.name === 'token')?.value;

if (!token) {
  console.error('No portal token found at ' + SESSION_FILE);
  process.exit(1);
}

const URL = 'https://api.theroofdocs.com/v1/dashboard/employees/all';
console.log('Fetching ' + URL + ' …');
const res = await fetch(URL, {
  headers: { 'x-access-token': token, 'Origin': 'https://portal.theroofdocs.com' },
});
if (!res.ok) {
  console.error(`HTTP ${res.status} ${res.statusText}`);
  process.exit(1);
}
const body = await res.json();
const employees = body.data || [];
console.log(`Got ${employees.length} employees`);

// Load existing roster (preserve manual entries)
let roster;
try {
  roster = JSON.parse(fs.readFileSync(ROSTER_FILE, 'utf8'));
} catch {
  roster = {
    _instructions: 'Maps internal user UUIDs to display names for ops/AR/field-tech surfaces. Auto-populated from portal /dashboard/employees/all via scripts/roofdocs/pull-employee-roster.mjs; merge preserves manual entries.',
    _lastUpdated: '',
    byUserId: {},
  };
}
roster.byUserId = roster.byUserId || {};

let added = 0;
let updated = 0;
let disabled = 0;

for (const e of employees) {
  const id = e.userID;
  if (!id) continue;
  const name = `${e.firstName || ''} ${e.lastName || ''}`.trim() || null;
  if (!name) continue;
  const existing = roster.byUserId[id];
  const isDisabled = !!e.disabled;
  if (isDisabled) disabled += 1;

  // Don't blow away manually-set names if they differ from the portal
  // (rare, but possible if someone customized the display name).
  if (existing && existing.name && existing.name === name) {
    // already up to date — just refresh metadata
    existing.email = e.email || existing.email || null;
    existing.disabled = isDisabled;
    continue;
  }
  if (existing && existing.name && existing.name !== name) {
    // manual override exists; leave name alone, add note
    existing._portalName = name;
    existing.disabled = isDisabled;
    continue;
  }
  // Net new OR previously had name: null (e.g. field-tech stubs we created)
  roster.byUserId[id] = {
    name,
    role: existing?.role || guessRole(e),
    email: e.email || null,
    disabled: isDisabled,
  };
  if (existing) updated += 1;
  else added += 1;
}

roster._lastUpdated = new Date().toISOString().slice(0, 10);
fs.writeFileSync(ROSTER_FILE, JSON.stringify(roster, null, 2));

console.log(`Wrote ${ROSTER_FILE}`);
console.log(`  Added: ${added} new employees`);
console.log(`  Updated: ${updated} previously-blank stubs`);
console.log(`  Disabled flag set on: ${disabled} entries`);
console.log(`  Roster total: ${Object.keys(roster.byUserId).length}`);

// Resolve the 4 field-tech UUIDs we'd been waiting on
const FT_TARGETS = [
  '64174115-87e2-41fb-aa5e-dff970ee5c0e',
  '120751b4-06a1-48de-bb2b-73f4b6baefa1',
  '3dc90bbb-8f49-4cf8-9a78-03a079ec165c',
  '359cfcfd-9290-455b-bd09-81255a0d7249',
];
console.log('\nField-tech UUID resolution:');
for (const id of FT_TARGETS) {
  const e = roster.byUserId[id];
  console.log(`  ${id}: ${e?.name || '(still missing)'} ${e?.disabled ? '[disabled]' : ''}`);
}

function guessRole(e) {
  // Lightweight heuristic from a few known fields. Real role mapping is in
  // dashboard/employees/roles (14 roles) which we don't pull here — could
  // wire that next if needed.
  if (e.mdSalesLicense || e.salesRepBasePay) return 'salesRep';
  if (e.trainerThreshold) return 'trainer';
  return null;
}
