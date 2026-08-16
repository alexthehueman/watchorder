// Fallback poster/tmdb_id resolver for films OMDb couldn't match — run manually, by you, the same
// way project-hub's worker.js hits Letterboxd under your own account rather than mine. This is a
// tool for you to run (`npm run ingest:letterboxd`), not something invoked automatically.
//
// Letterboxd has no public search API, so there is no safe way to look up an arbitrary title. What
// this does instead: guess a handful of plausible slugs (the corpus id, a slugified title, title+year),
// fetch https://letterboxd.com/film/<slug>/ for each, and only accept a match when the page's own
// og:title metadata agrees on BOTH normalised title and year (±1) — the same never-guess discipline
// as tools/ingest-omdb.mjs. A wrong guess is a real risk here: letterboxd.com/film/dr-strangelove/
// is an unrelated 2026 stage adaptation, not Kubrick's 1964 film of the same slug — this check is
// what catches that instead of silently writing the wrong poster.
//
// Fills letterboxd_slug (the confirmed match — what lets the site link out to the film's own
// page), poster_url, and opportunistically tmdb_id. Letterboxd film pages link out to TMDB but
// never to IMDb, so imdb_id stays null and these films remain flagged for OMDb/TMDB review.
//
// Usage:
//   npm run ingest:letterboxd                try every film still missing both imdb_id and letterboxd_slug
//   npm run ingest:letterboxd -- --dry-run    report matches without writing

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { parseDocument } from 'yaml';

const FILM_DIR = new URL('../src/data/films/', import.meta.url);
const UA = 'Mozilla/5.0 (compatible; WatchOrder-personal-ingest/0.1; non-commercial, low-volume)';

// No published rate limit because there's no public API here at all — this is a personal script
// making a couple hundred requests once, not a recurring crawl, so a conservative gap is just
// good manners rather than a compliance requirement.
const REQUEST_GAP_MS = 500;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalise(title) {
  return title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function slugify(title) {
  return title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * @param {{id: string, title: string, year: number}} film
 * @returns {string[]}
 */
function candidateSlugs(film) {
  const fromTitle = slugify(film.title);
  return [...new Set([film.id, fromTitle, `${fromTitle}-${film.year}`])];
}

/**
 * @param {string} slug
 * @param {{title: string, year: number}} film
 * @returns {Promise<{poster: string|null, tmdbId: number|null}|null>}
 */
async function tryCandidate(slug, film) {
  const response = await fetch(`https://letterboxd.com/film/${slug}/`, { headers: { 'User-Agent': UA } });
  if (!response.ok) return null;
  const html = await response.text();

  const titleMeta = html.match(/<meta property="og:title" content="([^"]*)"/)?.[1];
  if (!titleMeta) return null;
  const yearMatch = titleMeta.match(/\((\d{4})\)\s*$/);
  if (!yearMatch) return null;
  const pageTitle = titleMeta.replace(/\s*\(\d{4}\)\s*$/, '');
  const pageYear = Number(yearMatch[1]);

  // The confidence gate: both title and year must agree, mirroring ingest-omdb.mjs's tolerance.
  if (normalise(pageTitle) !== normalise(film.title)) return null;
  if (Math.abs(pageYear - film.year) > 1) return null;

  const poster = html.match(/<meta property="og:image" content="([^"]*)"/)?.[1] ?? null;
  const tmdbId = html.match(/href="https:\/\/(?:www\.)?themoviedb\.org\/movie\/(\d+)/)?.[1];

  return { slug, poster, tmdbId: tmdbId ? Number(tmdbId) : null };
}

/**
 * @param {{id: string, title: string, year: number}} film
 * @returns {Promise<{slug: string, poster: string|null, tmdbId: number|null}|null>}
 */
async function resolveFilm(film) {
  for (const slug of candidateSlugs(film)) {
    const match = await tryCandidate(slug, film);
    if (match) return match;
    await sleep(REQUEST_GAP_MS);
  }
  return null;
}

async function resolveMissingPosters(dryRun) {
  const files = (await readdir(FILM_DIR)).filter((name) => name.endsWith('.yaml')).sort();
  let resolved = 0;
  let unresolved = 0;

  for (const file of files) {
    const path = new URL(file, FILM_DIR);
    const doc = parseDocument(await readFile(path, 'utf8'));
    const items = doc.contents?.items ?? [];
    let changed = 0;

    for (const node of items) {
      const film = node.toJSON();
      const hasImdb = film.imdb_id !== null && film.imdb_id !== undefined;
      const hasSlug = film.letterboxd_slug !== null && film.letterboxd_slug !== undefined;
      if (hasImdb || hasSlug) continue;

      const match = await resolveFilm(film);
      if (match) {
        node.set('letterboxd_slug', match.slug);
        if (match.poster) node.set('poster_url', match.poster);
        if (match.tmdbId && (film.tmdb_id === null || film.tmdb_id === undefined)) {
          node.set('tmdb_id', match.tmdbId);
        }
        changed += 1;
        resolved += 1;
        const parts = ['slug', match.poster ? 'poster' : null, match.tmdbId ? `tmdb:${match.tmdbId}` : null].filter(Boolean);
        console.log(`  ok    ${file}: ${film.id} -> ${parts.join(', ')}`);
      } else {
        unresolved += 1;
        console.warn(`  MISS  ${file}: ${film.id} — no confident slug match`);
      }
    }

    if (changed > 0 && !dryRun) {
      await writeFile(path, doc.toString({ lineWidth: 0 }), 'utf8');
      console.log(`  wrote ${file} (${changed} resolved)`);
    }
  }

  console.log(`\n${resolved} resolved, ${unresolved} still unmatched${dryRun ? ' (dry run)' : ''}`);
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  await resolveMissingPosters(dryRun);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
