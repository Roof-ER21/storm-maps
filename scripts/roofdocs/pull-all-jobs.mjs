#!/usr/bin/env node
// Concurrent pull of every job detail record from portal.theroofdocs.com.
// Resumable: skips files already present. PII goes to data/roofdocs-pull/ (gitignored).

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const SESSION_FILE = '/Users/a21/web-recon/data/sessions/theroofdocs.json';
const EXPORT_CACHE = '/tmp/jobs-export.json';
const OUT_DIR = '/Users/a21/Desktop/storm-maps/data/roofdocs-pull';
const PROGRESS_FILE = path.join(OUT_DIR, '_progress.json');
const FAILED_FILE = path.join(OUT_DIR, '_failed.jsonl');

const CONCURRENCY = 10;
const RETRY_MAX = 3;
const RETRY_BACKOFF_MS = 1500;

const session = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
const token = session.origins
  .find((o) => o.origin === 'https://portal.theroofdocs.com')
  ?.localStorage.find((kv) => kv.name === 'token')?.value;
if (!token) {
  console.error('No token in session file');
  process.exit(1);
}

await fsp.mkdir(OUT_DIR, { recursive: true });

let jobIds;
if (fs.existsSync(EXPORT_CACHE)) {
  const exp = JSON.parse(fs.readFileSync(EXPORT_CACHE, 'utf8'));
  jobIds = exp.data.map((r) => r.jobID).filter(Boolean);
} else {
  console.log('Fetching jobs export…');
  const res = await fetch('https://api.theroofdocs.com/v1/admin/exports/report', {
    headers: {
      'x-access-token': token,
      'Origin': 'https://portal.theroofdocs.com',
    },
  });
  if (!res.ok) {
    console.error('Export failed:', res.status, await res.text());
    process.exit(1);
  }
  const body = await res.json();
  fs.writeFileSync(EXPORT_CACHE, JSON.stringify(body));
  jobIds = body.data.map((r) => r.jobID).filter(Boolean);
}

console.log(`Total jobs in export: ${jobIds.length}`);

// Skip already-fetched (resumable)
const existing = new Set(
  (await fsp.readdir(OUT_DIR))
    .filter((f) => f.endsWith('.json') && !f.startsWith('_'))
    .map((f) => Number(f.replace('.json', ''))),
);
const todo = jobIds.filter((id) => !existing.has(id));
console.log(`Already pulled: ${existing.size}.  To fetch: ${todo.length}.`);

if (todo.length === 0) {
  console.log('Nothing to do.');
  process.exit(0);
}

let done = 0;
let ok = 0;
let fail = 0;
const startedAt = Date.now();

async function fetchOne(jobID) {
  for (let attempt = 1; attempt <= RETRY_MAX; attempt++) {
    try {
      const res = await fetch(
        `https://api.theroofdocs.com/v1/dashboard/jobs/single/${jobID}`,
        {
          headers: {
            'x-access-token': token,
            'Origin': 'https://portal.theroofdocs.com',
          },
        },
      );
      if (res.status === 404) {
        return { ok: false, reason: '404' };
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const body = await res.json();
      await fsp.writeFile(
        path.join(OUT_DIR, `${jobID}.json`),
        JSON.stringify(body),
      );
      return { ok: true };
    } catch (err) {
      if (attempt === RETRY_MAX) {
        return { ok: false, reason: String(err) };
      }
      await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS * attempt));
    }
  }
  return { ok: false, reason: 'exhausted' };
}

async function worker(queue) {
  while (queue.length > 0) {
    const jobID = queue.shift();
    if (jobID === undefined) break;
    const r = await fetchOne(jobID);
    done++;
    if (r.ok) {
      ok++;
    } else {
      fail++;
      await fsp.appendFile(
        FAILED_FILE,
        JSON.stringify({ jobID, reason: r.reason, at: new Date().toISOString() }) + '\n',
      );
    }
    if (done % 100 === 0 || done === todo.length) {
      const elapsed = (Date.now() - startedAt) / 1000;
      const rate = done / elapsed;
      const eta = Math.max(0, (todo.length - done) / rate);
      console.log(
        `[${done}/${todo.length}] ok=${ok} fail=${fail} rate=${rate.toFixed(1)}/s eta=${(eta / 60).toFixed(1)}min`,
      );
      await fsp.writeFile(
        PROGRESS_FILE,
        JSON.stringify({ done, ok, fail, total: todo.length, startedAt }),
      );
    }
  }
}

const queue = [...todo];
const workers = Array.from({ length: CONCURRENCY }, () => worker(queue));
await Promise.all(workers);

const elapsed = (Date.now() - startedAt) / 1000;
console.log(`\nDone. ${ok} OK, ${fail} failed in ${(elapsed / 60).toFixed(1)} min.`);
if (fail > 0) console.log(`Failures logged to ${FAILED_FILE}`);
