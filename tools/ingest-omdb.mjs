// Fills in imdb_id (and, where OMDb has one, a poster_url) from OMDb — the practical alternative
// while a TMDB key is still pending. OMDb wraps IMDb data behind a free, instant-signup key,
// unlike TMDB's application process, but it cannot do what `--person` in ingest.mjs does: there is
// no filmography-by-person endpoint, only title lookup. New entities still get their film list
// hand-assembled; this tool only backfills ids and posters for titles already in the corpus.
//
// Usage:
//   npm run ingest:omdb                resolve null imdb_id in films.yaml
//   npm run ingest:omdb -- --dry-run   report matches without writing
//
// Same two rules as tools/ingest.mjs:
// 1. Never guess. Anything short of a confident title+year match is left null and reported —
//    OMDb's own fuzzy title lookup is a candidate, not an answer, until checked here.
// 2. Round-trips through the YAML Document API rather than parse-then-stringify, so the comments
//    that record why each tag holds its value survive.

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { parseDocument } from 'yaml';

const FILM_DIR = new URL('../src/data/films/', import.meta.url);
const ENV_PATH = new URL('../.env', import.meta.url);
const API = 'https://www.omdbapi.com/';

// OMDb's free tier is 1,000 requests/day with no documented per-second cap. This is nowhere near
// aggressive enough to matter, but a small gap is free insurance against nothing in particular.
const REQUEST_GAP_MS = 120;

class OmdbQuotaError extends Error {}

/**
 * OMDB_API_KEY from the environment, falling back to a .env file (which .gitignore excludes).
 * @returns {Promise<string|null>}
 */
async function readApiKey() {
  if (process.env.OMDB_API_KEY) return process.env.OMDB_API_KEY;
  try {
    const text = await readFile(ENV_PATH, 'utf8');
    for (const line of text.split('\n')) {
      const match = line.match(/^\s*OMDB_API_KEY\s*=\s*(.+?)\s*$/);
      if (match) return match[1].replace(/^['"]|['"]$/g, '');
    }
  } catch {
    // No .env is the normal case; the caller reports the missing key.
  }
  return null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalise(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function posterOf(result) {
  return result?.Poster && result.Poster !== 'N/A' ? result.Poster : null;
}

function yearOf(result) {
  // Year comes back as "2001" for a film but sometimes "2001–2003" for a series; only the first
  // four digits are ever the value worth comparing against ours.
  return Number(String(result?.Year ?? '').slice(0, 4));
}

/**
 * @param {Record<string, string>} params
 * @param {string} apiKey
 * @returns {Promise<object>}
 */
async function omdb(params, apiKey) {
  const url = new URL(API);
  url.searchParams.set('apikey', apiKey);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  const response = await fetch(url);
  if (!response.ok) throw new Error(`OMDb ${response.status}`);
  const body = await response.json();

  if (body.Response === 'False' && body.Error === 'Request limit reached!') {
    throw new OmdbQuotaError('daily request limit reached');
  }
  if (body.Response === 'False' && body.Error === 'Invalid API key!') {
    throw new OmdbQuotaError('invalid API key');
  }
  return body;
}

/**
 * A match is only accepted when the normalised titles agree exactly and the year is within a
 * year of ours — release years legitimately differ by one across territories and festival vs.
 * wide release dates, but no further. Everything else is reported as ambiguous rather than picked.
 * @param {{title: string, year: number, medium?: string}} film
 * @param {string} apiKey
 * @returns {Promise<{id: string|null, poster: string|null, reason: string, candidates: string[]}>}
 */
async function resolveFilm(film, apiKey) {
  const type = film.medium === 'series' ? 'series' : 'movie';
  const wanted = normalise(film.title);

  // Direct title lookup first — OMDb's own matching, gated behind our own confidence check
  // rather than trusted outright.
  const direct = await omdb({ t: film.title, y: String(film.year), type }, apiKey);
  if (direct.Response === 'True' && normalise(direct.Title) === wanted) {
    return { id: direct.imdbID, poster: posterOf(direct), reason: 'exact', candidates: [] };
  }

  // Retry without the year filter — some entries are dated by festival premiere in our data and
  // by wide release in OMDb's, a full year apart in edge cases the year filter would reject.
  await sleep(REQUEST_GAP_MS);
  const retry = await omdb({ t: film.title, type }, apiKey);
  if (retry.Response === 'True' && normalise(retry.Title) === wanted && Math.abs(yearOf(retry) - film.year) <= 1) {
    return { id: retry.imdbID, poster: posterOf(retry), reason: 'exact (year relaxed)', candidates: [] };
  }

  await sleep(REQUEST_GAP_MS);
  const search = await omdb({ s: film.title, type }, apiKey);
  const results = search.Search ?? [];
  const candidates = results.slice(0, 5).map((r) => `${r.Title} (${r.Year}) ${r.imdbID}`);
  const confident = results.filter((r) => normalise(r.Title) === wanted && Math.abs(yearOf(r) - film.year) <= 1);

  if (confident.length === 1) {
    return { id: confident[0].imdbID, poster: posterOf(confident[0]), reason: 'exact via search', candidates };
  }
  if (confident.length > 1) return { id: null, poster: null, reason: 'several exact matches', candidates };
  return { id: null, poster: null, reason: results.length ? 'no exact title match' : 'no results', candidates };
}

async function resolveMissingIds(apiKey, dryRun) {
  const files = (await readdir(FILM_DIR)).filter((name) => name.endsWith('.yaml')).sort();
  let resolved = 0;
  let unresolved = 0;
  let quotaStopped = false;

  outer: for (const file of files) {
    const path = new URL(file, FILM_DIR);
    const doc = parseDocument(await readFile(path, 'utf8'));
    const items = doc.contents?.items ?? [];
    let changed = 0;

    for (const node of items) {
      const film = node.toJSON();
      if (film.imdb_id !== null && film.imdb_id !== undefined) continue;

      let outcome;
      try {
        outcome = await resolveFilm(film, apiKey);
      } catch (err) {
        if (err instanceof OmdbQuotaError) {
          console.error(`\nStopping: ${err.message}. ${resolved} resolved so far, the rest left for next time.`);
          quotaStopped = true;
          if (changed > 0 && !dryRun) {
            await writeFile(path, doc.toString({ lineWidth: 0 }), 'utf8');
            console.log(`  wrote ${file} (${changed} resolved before stopping)`);
          }
          break outer;
        }
        throw err;
      }

      const { id, poster, reason, candidates } = outcome;
      if (id) {
        node.set('imdb_id', id);
        if (poster) node.set('poster_url', poster);
        changed += 1;
        resolved += 1;
        console.log(`  ok    ${file}: ${film.id} -> ${id}${poster ? ' (+poster)' : ''}`);
      } else {
        unresolved += 1;
        console.warn(`  MISS  ${file}: ${film.id} — ${reason}`);
        for (const candidate of candidates) console.warn(`          candidate: ${candidate}`);
      }
      await sleep(REQUEST_GAP_MS);
    }

    // Each file is written only if it changed, and only via the Document API — stringify()
    // preserves every comment, which is where the reasoning behind each tag lives.
    if (changed > 0 && !dryRun) {
      await writeFile(path, doc.toString({ lineWidth: 0 }), 'utf8');
      console.log(`  wrote ${file} (${changed} resolved)`);
    }
  }

  console.log(`\n${resolved} resolved, ${unresolved} left for a human${dryRun ? ' (dry run)' : ''}`);
  if (unresolved > 0 && !quotaStopped) process.exitCode = 1;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  const apiKey = await readApiKey();
  if (!apiKey) {
    console.error(
      'OMDB_API_KEY is not set.\n' +
        '  Get a free key at https://www.omdbapi.com/apikey.aspx (instant, by email), then either\n' +
        '  export it or put OMDB_API_KEY=... in a .env file at the repo root (.gitignore already\n' +
        '  excludes it).',
    );
    process.exitCode = 1;
    return;
  }

  await resolveMissingIds(apiKey, dryRun);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
