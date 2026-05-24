#!/usr/bin/env node
// Extract notes, installNotes, upsellNotes from per-job detail.
// Surface install gotchas, customer flags, upsell hints.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const RIQ_BASE = process.env.RIQ_BASE || "/Users/a21/RIQ21";

const DETAIL_DIR = `${RIQ_BASE}/data/roofdocs-pull`;
const PROJECTS_FILE = `${RIQ_BASE}/data/projects.json`;
const OUT = `${RIQ_BASE}/data/notes.json`;

const projects = JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf8'));
const projById = new Map(projects.map((p) => [p.id, p]));

const files = (await fsp.readdir(DETAIL_DIR)).filter((f) => f.endsWith('.json') && !f.startsWith('_'));
const out = [];

for (const f of files) {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(DETAIL_DIR, f), 'utf8')).data;
    if (!d) continue;
    const notes = d.notes;
    const installNotes = d.installNotes;
    const upsellNotes = d.upsellNotes;
    const statusUpdate = d.statusUpdate;
    if (!notes && !installNotes && !upsellNotes && !statusUpdate) continue;
    const proj = projById.get(d.jobID);
    if (!proj) continue;
    out.push({
      id: d.jobID,
      customer: proj.customer,
      address: [proj.addressLine1, proj.city, proj.state, proj.zip].filter(Boolean).join(', '),
      state: proj.state,
      city: proj.city,
      zip: proj.zip,
      stage: proj.stage,
      insurance: proj.insurance,
      salesRep: proj.salesRep,
      signedDate: proj.signedDate,
      jobTotal: proj.jobTotal,
      notes: notes || null,
      installNotes: installNotes || null,
      upsellNotes: upsellNotes || null,
      statusUpdate: statusUpdate || null,
      lat: proj.lat,
      lng: proj.lng,
    });
  } catch {}
}

fs.writeFileSync(OUT, JSON.stringify(out));
console.log(`${out.length} jobs with notes`);
console.log(`  with notes: ${out.filter((n) => n.notes).length}`);
console.log(`  with installNotes: ${out.filter((n) => n.installNotes).length}`);
console.log(`  with upsellNotes: ${out.filter((n) => n.upsellNotes).length}`);
console.log(`  with statusUpdate: ${out.filter((n) => n.statusUpdate).length}`);
