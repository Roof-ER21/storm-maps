#!/usr/bin/env node
// Pull /v1/invoices/{jobID} for every job — ACV, depreciation, line items, payment flow.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const RIQ_BASE = process.env.RIQ_BASE || "/Users/a21/Desktop/storm-maps";

const SESSION_FILE = '/Users/a21/web-recon/data/sessions/theroofdocs.json';
const EXPORT_CACHE = '/tmp/jobs-export.json';
const OUT_DIR = `${RIQ_BASE}/data/roofdocs-invoices`;
const FAILED_FILE = path.join(OUT_DIR, '_failed.jsonl');
const CONCURRENCY = 12;
const RETRY_MAX = 3;

const session = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
const token = session.origins
  .find((o) => o.origin === 'https://portal.theroofdocs.com')
  ?.localStorage.find((kv) => kv.name === 'token')?.value;

await fsp.mkdir(OUT_DIR, { recursive: true });
const exp = JSON.parse(fs.readFileSync(EXPORT_CACHE, 'utf8')).data;
const jobIds = exp.map((r) => r.jobID).filter(Boolean);

const existing = new Set(
  (await fsp.readdir(OUT_DIR))
    .filter((f) => f.endsWith('.json') && !f.startsWith('_'))
    .map((f) => Number(f.replace('.json', ''))),
);
const todo = jobIds.filter((id) => !existing.has(id));
console.log(`Total ${jobIds.length}, existing ${existing.size}, todo ${todo.length}`);

let done = 0, ok = 0, fail = 0, notFound = 0;
const startedAt = Date.now();

async function fetchOne(id) {
  for (let attempt = 1; attempt <= RETRY_MAX; attempt++) {
    try {
      const res = await fetch(`https://api.theroofdocs.com/v1/invoices/${id}`, {
        headers: { 'x-access-token': token, 'Origin': 'https://portal.theroofdocs.com' },
      });
      if (res.status === 404) return { ok: false, reason: '404' };
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      await fsp.writeFile(path.join(OUT_DIR, `${id}.json`), JSON.stringify(body));
      return { ok: true };
    } catch (e) {
      if (attempt === RETRY_MAX) return { ok: false, reason: String(e) };
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
}

async function worker(q) {
  while (q.length > 0) {
    const id = q.shift();
    if (id === undefined) break;
    const r = await fetchOne(id);
    done++;
    if (r.ok) ok++;
    else if (r.reason === '404') { fail++; notFound++; }
    else {
      fail++;
      await fsp.appendFile(FAILED_FILE, JSON.stringify({ id, reason: r.reason }) + '\n');
    }
    if (done % 200 === 0 || done === todo.length) {
      const elapsed = (Date.now() - startedAt) / 1000;
      const rate = done / elapsed;
      const eta = Math.max(0, (todo.length - done) / rate);
      console.log(`[${done}/${todo.length}] ok=${ok} 404=${notFound} fail=${fail - notFound} rate=${rate.toFixed(0)}/s eta=${(eta / 60).toFixed(1)}min`);
    }
  }
}

const q = [...todo];
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(q)));
const elapsed = (Date.now() - startedAt) / 1000;
console.log(`\nDone. ${ok} OK, ${notFound} 404, ${fail - notFound} fail in ${(elapsed / 60).toFixed(1)} min.`);
