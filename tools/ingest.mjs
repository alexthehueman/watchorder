// Fills in the objective half of the corpus from TMDB so the subjective half stays hand-authored.
//
// Two jobs:
//   npm run ingest                        resolve null tmdb_id in films.yaml
//   npm run ingest -- --person "Name"     print a filmography skeleton for a new entity
//
// Two rules this tool follows strictly:
//
// 1. It never guesses. A wrong tmdb_id silently attaches the wrong poster, runtime and year to a
//    film and nothing downstream will ever notice. Anything short of a confident match is
//    reported and left null for a human.
// 2. It round-trips through the YAML Document API rather than parse-then-stringify, because the
//    comments in films.yaml record why each tag holds the value it does. Losing them would cost
//    more than the ids are worth.

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { parseDocument } from 'yaml';

const FILM_DIR = new URL('../src/data/films/', import.meta.url);
const ENV_PATH = new URL('../.env', import.meta.url);
const API = 'https://api.themoviedb.org/3';

// TMDB tolerates roughly 40-50 requests/second. We are nowhere near that, but a small gap keeps
// us clearly inside it and costs nothing on a corpus this size.
const REQUEST_GAP_MS = 60;

/**
 * TMDB_API_KEY from the environment, falling back to a .env file (which .gitignore excludes).
 * @returns {Promise<string|null>}
 */
async function readApiKey() {
  if (process.env.TMDB_API_KEY) return process.env.TMDB_API_KEY;
  try {
    const text = await readFile(ENV_PATH, 'utf8');
    for (const line of text.split('\n')) {
      const match = line.match(/^\s*TMDB_API_KEY\s*=\s*(.+?)\s*$/);
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

/**
 * @param {string} path
 * @param {Record<string, string>} params
 * @param {string} apiKey
 * @returns {Promise<object>}
 */
async function tmdb(path, params, apiKey) {
  const url = new URL(API + path);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.searchParams.set('api_key', apiKey);

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(url);
    if (response.status === 429) {
      const wait = Number(response.headers.get('retry-after') ?? 2) * 1000;
      console.warn(`  rate limited, waiting ${wait}ms`);
      await sleep(wait);
      continue;
    }
    if (!response.ok) throw new Error(`TMDB ${response.status} for ${path}`);
    return response.json();
  }
  throw new Error(`TMDB kept rate limiting ${path}`);
}

function normalise(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * A match is only accepted when the normalised titles agree exactly and the year is within a
 * year of ours — release years legitimately differ by one across territories, but no further.
 * Everything else is reported as ambiguous rather than picked.
 * @param {{title: string, year: number, medium?: string}} film
 * @param {string} apiKey
 * @returns {Promise<{id: number|null, reason: string, candidates: string[]}>}
 */
async function resolveFilm(film, apiKey) {
  const isSeries = film.medium === 'series';
  const path = isSeries ? '/search/tv' : '/search/movie';
  const yearParam = isSeries ? 'first_air_date_year' : 'year';
  const data = await tmdb(path, { query: film.title, [yearParam]: String(film.year) }, apiKey);
  const results = data.results ?? [];

  const candidates = results.slice(0, 5).map((result) => {
    const name = isSeries ? result.name : result.title;
    const date = (isSeries ? result.first_air_date : result.release_date) ?? '';
    return `${name} (${date.slice(0, 4) || '????'}) #${result.id}`;
  });

  const wanted = normalise(film.title);
  const confident = results.filter((result) => {
    const name = isSeries ? result.name : result.title;
    const date = (isSeries ? result.first_air_date : result.release_date) ?? '';
    const year = Number(date.slice(0, 4));
    return normalise(name ?? '') === wanted && Math.abs(year - film.year) <= 1;
  });

  if (confident.length === 1) return { id: confident[0].id, reason: 'exact', candidates };
  if (confident.length > 1) {
    return { id: null, reason: 'several exact matches', candidates };
  }
  return { id: null, reason: results.length ? 'no exact title match' : 'no results', candidates };
}

async function resolveMissingIds(apiKey, dryRun) {
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
      if (film.tmdb_id !== null && film.tmdb_id !== undefined) continue;

      const { id, reason, candidates } = await resolveFilm(film, apiKey);
      if (id) {
        node.set('tmdb_id', id);
        changed += 1;
        resolved += 1;
        console.log(`  ok    ${file}: ${film.id} -> ${id}`);
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
  if (unresolved > 0) process.exitCode = 1;
}

/**
 * Prints a filmography skeleton for a new entity. Objective fields only — every subjective tag
 * comes out null on purpose, because that is the work this tool must not pretend to do.
 */
async function scaffoldPerson(name, apiKey) {
  const search = await tmdb('/search/person', { query: name }, apiKey);
  const person = search.results?.[0];
  if (!person) {
    console.error(`no person found for "${name}"`);
    process.exitCode = 1;
    return;
  }
  console.log(`# ${person.name} — TMDB #${person.id}\n`);

  const credits = await tmdb(`/person/${person.id}/movie_credits`, {}, apiKey);
  const directed = (credits.crew ?? [])
    .filter((credit) => credit.job === 'Director')
    .sort((a, b) => (a.release_date ?? '').localeCompare(b.release_date ?? ''));

  for (const credit of directed) {
    const year = (credit.release_date ?? '').slice(0, 4) || 'null';
    const slug = normalise(credit.title).replace(/ /g, '-');
    console.log(`- id: ${slug}`);
    console.log(`  tmdb_id: ${credit.id}`);
    console.log(`  title: ${JSON.stringify(credit.title)}`);
    console.log(`  year: ${year}`);
    console.log('  runtime: null   # /movie/{id} has it; filled on the next ingest pass');
    console.log('  tags:');
    for (const tag of ['opacity', 'stillness', 'bleakness', 'humor']) {
      console.log(`    ${tag}: null`);
    }
    console.log('    acclaim: null\n');
  }
  console.error(`\n${directed.length} directing credits — tags left null for a human`);
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const personIndex = args.indexOf('--person');

  const apiKey = await readApiKey();
  if (!apiKey) {
    console.error(
      'TMDB_API_KEY is not set.\n' +
        '  Get a key at https://www.themoviedb.org/settings/api, then either export it or put\n' +
        '  TMDB_API_KEY=... in a .env file at the repo root (.gitignore already excludes it).',
    );
    process.exitCode = 1;
    return;
  }

  if (personIndex !== -1) {
    const name = args[personIndex + 1];
    if (!name) {
      console.error('--person needs a name, e.g. --person "David Lynch"');
      process.exitCode = 1;
      return;
    }
    await scaffoldPerson(name, apiKey);
    return;
  }

  await resolveMissingIds(apiKey, dryRun);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
