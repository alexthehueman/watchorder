// Letterboxd genre fetcher, run manually by you (`npm run ingest:letterboxd-genres`), the same
// convention as ingest-letterboxd-rating.mjs.
//
// Only ever touches films that already carry a letterboxd_slug — that slug was independently
// verified against the film's own title and year when ingest-letterboxd.mjs resolved it, so this
// tool trusts it rather than re-guessing. It fetches https://letterboxd.com/film/<slug>/ and reads
// the page's own JSON-LD "genre" array, storing it as genres: [...]. Letterboxd's genre taxonomy
// is a fixed, closed list (shared with TMDB's), so an unrecognised value means the page layout
// changed rather than a new genre existing — reported and skipped, never written blind.
//
// This is deliberately a separate crawl from ingest-letterboxd-rating.mjs rather than merged into
// it, even though both read the same pages: keeping one tool per concern means a rating-only or
// genre-only re-run later doesn't have to touch (or risk) the other field.
//
// Usage:
//   npm run ingest:letterboxd-genres                every film with a slug but no genres yet
//   npm run ingest:letterboxd-genres -- --refresh    also re-fetch films that already have genres
//   npm run ingest:letterboxd-genres -- --dry-run    report without writing

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { parseDocument } from 'yaml';

const FILM_DIR = new URL('../src/data/films/', import.meta.url);
const UA = 'Mozilla/5.0 (compatible; WatchOrder-personal-ingest/0.1; non-commercial)';
const REQUEST_GAP_MS = 500;

// Letterboxd's own genre list (mirrors TMDB's), used only to catch a parsing regression — a genre
// string outside this set means the page format changed, not that Letterboxd added a new genre
// mid-run.
const KNOWN_GENRES = new Set([
  'Action', 'Adventure', 'Animation', 'Comedy', 'Crime', 'Documentary', 'Drama', 'Family',
  'Fantasy', 'History', 'Horror', 'Music', 'Mystery', 'Romance', 'Science Fiction', 'TV Movie',
  'Thriller', 'War', 'Western',
]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {string} slug
 * @returns {Promise<{ok: true, genres: string[]} | {ok: false, reason: string}>}
 */
async function fetchGenres(slug) {
  let response;
  try {
    response = await fetch(`https://letterboxd.com/film/${slug}/`, { headers: { 'User-Agent': UA } });
  } catch (err) {
    return { ok: false, reason: `fetch failed: ${err.message}` };
  }
  if (!response.ok) return { ok: false, reason: `HTTP ${response.status}` };
  const html = await response.text();

  const match = html.match(/"genre":\[([^\]]*)\]/);
  if (!match) return { ok: false, reason: 'no genre array on page (layout changed?)' };
  const genres = [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  if (genres.length === 0) return { ok: false, reason: 'genre array is empty' };
  const unknown = genres.filter((g) => !KNOWN_GENRES.has(g));
  if (unknown.length > 0) return { ok: false, reason: `unrecognised genre(s): ${unknown.join(', ')}` };
  return { ok: true, genres };
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
      const hasGenres = Array.isArray(film.genres) && film.genres.length > 0;
      if (hasGenres && !refresh) continue;

      const result = await fetchGenres(film.letterboxd_slug);
      await sleep(REQUEST_GAP_MS);
      if (result.ok) {
        node.set('genres', result.genres);
        changed += 1;
        updated += 1;
        console.log(`  ok    ${file}: ${film.id} -> ${result.genres.join(', ')}`);
      } else {
        missed += 1;
        console.warn(`  MISS  ${file}: ${film.id} — ${result.reason}`);
      }
    }

    if (changed > 0 && !dryRun) {
      await writeFile(path, doc.toString({ lineWidth: 0 }), 'utf8');
      console.log(`  wrote ${file} (${changed} tagged)`);
    }
  }

  console.log(
    `\n${updated} tagged, ${missed} missed, ${skippedNoSlug} skipped (no letterboxd_slug)` +
      `${dryRun ? ' (dry run)' : ''}`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
