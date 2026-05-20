#!/usr/bin/env node
// Phase 8a: lead-funnel rollup builder.
//
// Reads raw data/leads.json + data/leads-employees.json and produces
// data/leads-rollup.json with funnel KPIs, by-status, by-rep, by-zip, by-state,
// stuck-lead alerts, and a referral-method breakdown.
//
// Used by /api/intel/leads-summary (which returns this file) and by /leads.html
// (which renders it). Keeps the API endpoint fast — server doesn't have to
// re-aggregate 540 rows on every request.

import fs from 'node:fs';
import path from 'node:path';

const RIQ_BASE = process.env.RIQ_BASE || '/Users/a21/storm-maps';
const LEADS_FILE = path.join(RIQ_BASE, 'data', 'leads.json');
const EMPLOYEES_FILE = path.join(RIQ_BASE, 'data', 'leads-employees.json');
const OUT_FILE = path.join(RIQ_BASE, 'data', 'leads-rollup.json');

if (!fs.existsSync(LEADS_FILE)) {
  console.error(`Missing ${LEADS_FILE} — run refresh-all.sh first`);
  process.exit(1);
}

const rawLeads = JSON.parse(fs.readFileSync(LEADS_FILE, 'utf8'));
const leads = rawLeads?.data ?? rawLeads;
const rawEmps = fs.existsSync(EMPLOYEES_FILE) ? JSON.parse(fs.readFileSync(EMPLOYEES_FILE, 'utf8')) : null;
const emps = rawEmps?.data ?? rawEmps ?? [];

const today = new Date();
const STUCK_DAYS = 14;

const empById = new Map();
for (const e of emps) {
  if (e.userID) empById.set(e.userID, e);
}

const inc = (obj, k, v = 1) => { obj[k] = (obj[k] ?? 0) + v; };
const toEntries = (obj, sort = true) =>
  Object.entries(obj)
    .map(([k, v]) => ({ key: k, count: v }))
    .sort((a, b) => sort ? b.count - a.count : 0);

// ─── Funnel: status → next stage ───────────────────────────────────────────
// Door-knock journey: No answer / No answer-material drop → Conversation →
// Inspection → Appointment → (converted to customer)
const STATUS_TIERS = {
  'No answer': 0,
  'No answer - material drop': 0,
  'Do Not Knock': -1,                 // dead
  'Conversation': 1,                  // contact made
  'Inspection': 2,                    // inspection booked
  'Appointment': 3,                   // appointment set
};

const funnel = {
  total: leads.length,
  doorKnocks: 0,
  conversations: 0,
  inspections: 0,
  appointments: 0,
  converted: 0,
  doNotKnock: 0,
};

for (const l of leads) {
  if (l.status === 'No answer' || l.status === 'No answer - material drop') funnel.doorKnocks++;
  if (l.status === 'Do Not Knock') funnel.doNotKnock++;
  if (l.status === 'Conversation' || (STATUS_TIERS[l.status] ?? -2) >= 1) funnel.conversations++;
  if (l.status === 'Inspection' || (STATUS_TIERS[l.status] ?? -2) >= 2) funnel.inspections++;
  if (l.status === 'Appointment' || (STATUS_TIERS[l.status] ?? -2) >= 3) funnel.appointments++;
  if (l.convertedToCustomer === true) funnel.converted++;
}
funnel.doorKnockToConversationPct = funnel.total > 0
  ? +((funnel.conversations / funnel.total) * 100).toFixed(2) : 0;
funnel.conversationToAppointmentPct = funnel.conversations > 0
  ? +((funnel.appointments / funnel.conversations) * 100).toFixed(2) : 0;
funnel.totalToAppointmentPct = funnel.total > 0
  ? +((funnel.appointments / funnel.total) * 100).toFixed(2) : 0;

// ─── By-status / priority / state / referral-method ────────────────────────
const byStatus = {};
const byPriority = {};
const byState = {};
const byReferral = {};
const byHouseType = {};
const byZip = {};
const byRep = {};         // repId → {name, count, conversations, appointments, lastCreated}
const byCity = {};

for (const l of leads) {
  inc(byStatus, l.status ?? '(none)');
  inc(byPriority, l.priority ?? '(none)');
  inc(byState, l.state ?? '(none)');
  inc(byReferral, l.referralMethod ?? '(none)');
  inc(byHouseType, l.houseType ?? '(none)');
  inc(byZip, l.zipCode ?? '(none)');
  inc(byCity, `${l.city ?? '(none)'}, ${l.state ?? ''}`);

  const repId = l.repId;
  if (repId) {
    if (!byRep[repId]) {
      const repName = l.salesRep ? `${l.salesRep.firstName ?? ''} ${l.salesRep.lastName ?? ''}`.trim() : '(unknown)';
      byRep[repId] = { repId, repName, count: 0, conversations: 0, inspections: 0, appointments: 0, lastCreated: null };
    }
    const r = byRep[repId];
    r.count++;
    if (l.status === 'Conversation' || (STATUS_TIERS[l.status] ?? -2) >= 1) r.conversations++;
    if (l.status === 'Inspection' || (STATUS_TIERS[l.status] ?? -2) >= 2) r.inspections++;
    if (l.status === 'Appointment') r.appointments++;
    if (l.createdAt && (!r.lastCreated || l.createdAt > r.lastCreated)) r.lastCreated = l.createdAt;
  }
}

// ─── Stuck leads (Conversation status, no activity update for STUCK_DAYS) ──
// Caveat: lead records don't have lastModified timestamp in the captured shape;
// using createdAt as proxy — "lead created > N days ago and still in non-terminal status"
const stuck = [];
for (const l of leads) {
  if (!l.createdAt) continue;
  if (l.status !== 'Conversation') continue;
  const ageDays = (today - new Date(l.createdAt)) / (1000 * 60 * 60 * 24);
  if (ageDays > STUCK_DAYS) {
    stuck.push({
      leadID: l.leadID,
      name: `${l.firstName ?? ''} ${l.lastName ?? ''}`.trim(),
      addressLine1: l.addressLine1,
      city: l.city,
      state: l.state,
      zipCode: l.zipCode,
      status: l.status,
      ageDays: Math.round(ageDays),
      repName: l.salesRep ? `${l.salesRep.firstName ?? ''} ${l.salesRep.lastName ?? ''}`.trim() : null,
      createdAt: l.createdAt,
    });
  }
}
stuck.sort((a, b) => b.ageDays - a.ageDays);

// ─── Top zips by lead volume ───────────────────────────────────────────────
const topZips = toEntries(byZip).slice(0, 25);
const topCities = toEntries(byCity).slice(0, 15);

// ─── Rep leaderboard ───────────────────────────────────────────────────────
const repLeaderboard = Object.values(byRep)
  .map((r) => ({
    ...r,
    conversionPct: r.count > 0 ? +((r.conversations / r.count) * 100).toFixed(1) : 0,
    appointmentPct: r.count > 0 ? +((r.appointments / r.count) * 100).toFixed(1) : 0,
  }))
  .sort((a, b) => b.count - a.count);

// ─── Lead-eligible employees (by role) ─────────────────────────────────────
const eligibleByRole = {};
for (const e of emps) {
  const role = e.roleId ?? 'unknown';
  if (!eligibleByRole[role]) eligibleByRole[role] = { roleId: role, total: 0, usingPortal: 0, active: 0 };
  eligibleByRole[role].total++;
  if (e.usingPortal) eligibleByRole[role].usingPortal++;
  if (e.active) eligibleByRole[role].active++;
}

// ─── Coordinate density (for map heatmap) ──────────────────────────────────
const mapPoints = leads
  .filter((l) => l.coordinates?.coordinates && Array.isArray(l.coordinates.coordinates))
  .map((l) => ({
    leadID: l.leadID,
    lat: l.coordinates.coordinates[0],
    lng: l.coordinates.coordinates[1],
    status: l.status,
    zipCode: l.zipCode,
  }));

// ─── Output ────────────────────────────────────────────────────────────────
const out = {
  generated: new Date().toISOString(),
  source: 'admin/leads',
  totalLeads: leads.length,
  totalEmployees: emps.length,
  funnel,
  byStatus: toEntries(byStatus),
  byPriority: toEntries(byPriority),
  byState: toEntries(byState),
  byReferralMethod: toEntries(byReferral),
  byHouseType: toEntries(byHouseType),
  topZips,
  topCities,
  repLeaderboard,
  eligibleByRole: Object.values(eligibleByRole).sort((a, b) => b.total - a.total),
  stuckLeads: {
    threshold_days: STUCK_DAYS,
    count: stuck.length,
    leads: stuck.slice(0, 50),
  },
  mapPoints,
};

fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2));
const bytes = fs.statSync(OUT_FILE).size;
console.log(`✓ leads-rollup.json: ${(bytes / 1024).toFixed(1)} KB`);
console.log(`  Total leads: ${out.totalLeads} | Conversations: ${funnel.conversations} | Appointments: ${funnel.appointments}`);
console.log(`  Door-to-appt: ${funnel.totalToAppointmentPct}% | Conv-to-appt: ${funnel.conversationToAppointmentPct}%`);
console.log(`  Stuck (Conversation > ${STUCK_DAYS}d): ${stuck.length}`);
console.log(`  Reps with leads: ${repLeaderboard.length}`);
