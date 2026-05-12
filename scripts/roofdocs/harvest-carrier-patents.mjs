// Fetches carrier-AI patents from Google Patents and saves raw text to disk.
// Each patent is fetched once and cached. The extractor runs on these cached
// raw files so we don't re-hit Google Patents on every refresh.
//
// Seed list: scripts/roofdocs/carrier-patents-seed.json
// Output:    data/carrier-patents-raw/<patentId>.json

import fs from 'node:fs';
import path from 'node:path';

const RIQ_BASE = process.env.RIQ_BASE || '/Users/a21/Desktop/storm-maps';
const SEED = `${RIQ_BASE}/scripts/roofdocs/carrier-patents-seed.json`;
const OUT_DIR = `${RIQ_BASE}/data/carrier-patents-raw`;

fs.mkdirSync(OUT_DIR, { recursive: true });

const seeds = JSON.parse(fs.readFileSync(SEED, 'utf8'));

// Strip HTML tags + collapse whitespace. Google Patents HTML is fairly clean
// already — we just want plain text for the LLM.
function htmlToText(html) {
  return html
    .replace(/<script[^]*?<\/script>/gi, '')
    .replace(/<style[^]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// Pull abstract + claims + description from Google Patents HTML. The page
// uses Schema.org itemprop attributes, which gives us stable anchors.
function extractPatentSections(html) {
  const grab = (re) => {
    const m = html.match(re);
    return m ? htmlToText(m[1]) : '';
  };
  // Title (h1)
  const title = grab(/<h1[^>]*itemprop="?title"?[^>]*>([\s\S]*?)<\/h1>/i) || grab(/<title>([\s\S]*?)<\/title>/i);
  // Abstract
  const abstract = grab(/<abstract[\s\S]*?>([\s\S]*?)<\/abstract>/i) || grab(/itemprop="abstract"[^>]*>([\s\S]*?)<\/(section|div)>/i);
  // Claims
  const claims = grab(/itemprop="claims"[^>]*>([\s\S]*?)<\/section>/i);
  // Description (capped — these can be huge)
  const descRaw = grab(/itemprop="description"[^>]*>([\s\S]*?)<\/section>/i);
  const description = descRaw.slice(0, 30000); // first ~30k chars
  return { title, abstract, claims, description };
}

async function fetchPatent(id, url) {
  const target = url || `https://patents.google.com/patent/${id}/en`;
  const res = await fetch(target, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${target}`);
  return await res.text();
}

(async () => {
  console.log(`Harvesting ${seeds.length} carrier patents → ${OUT_DIR}\n`);
  let ok = 0, skipped = 0, failed = 0;
  for (const seed of seeds) {
    const outFile = path.join(OUT_DIR, `${seed.id}.json`);
    if (fs.existsSync(outFile)) {
      console.log(`  ⊙ ${seed.id} cached (skip)`);
      skipped++;
      continue;
    }
    try {
      const html = await fetchPatent(seed.id, seed.url);
      const sections = extractPatentSections(html);
      const wordCount = (sections.abstract + sections.claims + sections.description).split(/\s+/).length;
      const out = { ...seed, fetched: new Date().toISOString(), wordCount, ...sections };
      fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
      console.log(`  ✓ ${seed.id} (${seed.carrier}) — ${wordCount.toLocaleString()} words`);
      ok++;
      // Polite delay — don't hammer
      await new Promise((r) => setTimeout(r, 800));
    } catch (e) {
      console.log(`  ✗ ${seed.id} FAILED: ${e.message}`);
      failed++;
    }
  }
  console.log(`\nDone: ${ok} fetched, ${skipped} cached, ${failed} failed`);
})();
