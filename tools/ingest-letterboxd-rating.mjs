// Letterboxd average-rating fetcher, run manually by you (`npm run ingest:letterboxd-rating`),
// the same convention as ingest-letterboxd.mjs.
//
// Only ever touches films that already carry a letterboxd_slug — that slug was independently
// verified against the film's own title and year when ingest-letterboxd.mjs resolved it, so this
// tool trusts it rather than re-guessing. It fetches https://letterboxd.com/film/<slug>/ and reads
// the page's own JSON-LD AggregateRating (ratingValue, 0-5), storing it as letterboxd_rating. A
// missing or unparsable rating block is reported and skipped, never guessed.
//
// Usage:
//   npm run ingest:letterboxd-rating                every film with a slug but no rating yet
//   npm run ingest:letterboxd-rating -- --refresh    also re-fetch films that already have a rating
//   npm run ingest:letterboxd-rating -- --dry-run    report without writing

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { parseDocument } from 'yaml';

const FILM_DIR = new URL('../src/data/films/', import.meta.url);
const UA = 'Mozilla/5.0 (compatible; WatchOrder-personal-ingest/0.1; non-commercial)';

// Same courtesy gap as ingest-letterboxd.mjs — no public API, so a fixed pause after every
// request, hit or miss, applied unconditionally.
const REQUEST_GAP_MS = 500;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {string} slug
 * @returns {Promise<{ok: true, rating: number} | {ok: false, reason: string}>}
 */
async function fetchRating(slug) {
  let response;
  try {
    response = await fetch(`https://letterboxd.com/film/${slug}/`, { headers: { 'User-Agent': UA } });
  } catch (err) {
    return { ok: false, reason: `fetch failed: ${err.message}` };
  }
  if (!response.ok) return { ok: false, reason: `HTTP ${response.status}` };
  const html = await response.text();

  // Letterboxd embeds this as inline JSON-LD on every film page; ratingValue is on a 0-5 scale
  // with quarter-star precision. A film with too few ratings to show a score omits the block
  // entirely rather than reporting a misleading number, so absence is a legitimate outcome here.
  const match = html.match(/"aggregateRating":\{[^}]*"ratingValue":([\d.]+)[^}]*\}/);
  if (!match) return { ok: false, reason: 'no aggregateRating on page (too few ratings, or layout changed)' };
  const rating = Number(match[1]);
  if (!(rating > 0 && rating <= 5)) return { ok: false, reason: `ratingValue out of range: ${match[1]}` };
  return { ok: true, rating };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const refresh = args.includes('--refresh');

  const files = (await readdir(FILM_DIR)).filter((name) => name.endsWith('.yaml')).sort();
  let updated = 0;
  let skippedNoSlug = 0;
  let missed = 0;

  for (const file of files) {
    const path = new URL(file, FILM_DIR);
    const doc = parseDocument(await readFile(path, 'utf8'));
    const items = doc.contents?.items ?? [];
    let changed = 0;

    for (const node of items) {
      const film = node.toJSON();
      if (!film.letterboxd_slug) {
        skippedNoSlug += 1;
        continue;
      }
      const hasRating = film.letterboxd_rating !== null && film.letterboxd_rating !== undefined;
      if (hasRating && !refresh) continue;

      const result = await fetchRating(film.letterboxd_slug);
      await sleep(REQUEST_GAP_MS);
      if (result.ok) {
        node.set('letterboxd_rating', result.rating);
        changed += 1;
        updated += 1;
        console.log(`  ok    ${file}: ${film.id} -> ${result.rating}`);
      } else {
        missed += 1;
        console.warn(`  MISS  ${file}: ${film.id} — ${result.reason}`);
      }
    }

    if (changed > 0 && !dryRun) {
      await writeFile(path, doc.toString({ lineWidth: 0 }), 'utf8');
      console.log(`  wrote ${file} (${changed} rated)`);
    }
  }

  console.log(
    `\n${updated} rated, ${missed} missed, ${skippedNoSlug} skipped (no letterboxd_slug)` +
      `${dryRun ? ' (dry run)' : ''}`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
