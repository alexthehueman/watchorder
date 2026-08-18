// Letterboxd-link resolver, run manually by you, the same way project-hub's worker.js hits
// Letterboxd under your own account rather than mine. This is a tool for you to run
// (`npm run ingest:letterboxd`), not something invoked automatically.
//
// Letterboxd has no public search API, so there is no safe way to look up an arbitrary title. What
// this does instead: guess a handful of plausible slugs (the corpus id, a slugified title, title+year),
// fetch https://letterboxd.com/film/<slug>/ for each, and only accept a match when the page's own
// og:title metadata agrees on BOTH normalised title and year (±1) — the same never-guess discipline
// as tools/ingest-omdb.mjs. A wrong guess is a real risk here: letterboxd.com/film/dr-strangelove/
// is an unrelated 2026 stage adaptation, not Kubrick's 1964 film of the same slug — this check is
// what catches that instead of silently writing the wrong poster.
//
// Runs against every film in the corpus, not only ones OMDb missed — the point is a Letterboxd
// link on every film page, not just a poster fallback. It never overwrites an existing poster_url
// or tmdb_id (those stay whatever OMDb already resolved); it only ever adds letterboxd_slug plus
// poster_url/tmdb_id for films that didn't already have them. Letterboxd film pages link out to
// TMDB but never to IMDb, so imdb_id is untouched by this tool entirely.
//
// Usage:
//   npm run ingest:letterboxd                try every film still missing letterboxd_slug
//   npm run ingest:letterboxd -- --dry-run    report matches without writing

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { parseDocument } from 'yaml';

const FILM_DIR = new URL('../src/data/films/', import.meta.url);
const UA = 'Mozilla/5.0 (compatible; WatchOrder-personal-ingest/0.1; non-commercial)';

// No published rate limit because there's no public API here at all — this is a personal script,
// not a recurring crawl, so a conservative fixed gap after every request (hit or miss) is just
// good manners rather than a compliance requirement. Applied unconditionally, not only on retry,
// now that a run covers the whole corpus rather than a few dozen films.
const REQUEST_GAP_MS = 500;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The og:title attribute comes back HTML-entity-encoded ("Adam&#039;s Rib"), and comparing that
 * raw against a plain-text corpus title ("Adam's Rib") fails even on an exact page match — every
 * apostrophe-title film hit this before it was caught.
 */
function decodeHtmlEntities(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCodePoint(parseInt(code, 16)));
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

const NUMBER_WORDS = { one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10' };

function withDigits(title) {
  return title.replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten)\b/gi, (w) => NUMBER_WORDS[w.toLowerCase()]);
}

/**
 * Every candidate carries the title it should be checked against — almost always the corpus
 * title, but film.letterboxd_title (a human-supplied alternate/translated title, e.g. "Nenette
 * and Boni" for a corpus entry titled "Nénette et Boni") lets a specific known-tricky film get
 * more chances without changing what "confident" means: every one of these is still independently
 * verified against the live page before anything is accepted, exactly like the plain corpus-title
 * candidates always were.
 * film.letterboxd_slug_hint is the last resort, for slugs no rule can derive: Letterboxd files 8½
 * at /film/8-half/, which no amount of slugifying "8½" will ever produce. It supplies only the URL
 * to try — the page still has to match the film's own title and year, so a mistyped hint fails
 * exactly as loudly as a bad guess would.
 * @param {{id: string, title: string, year: number, letterboxd_title?: string, letterboxd_slug_hint?: string}} film
 * @returns {Array<{slug: string, expectedTitle: string}>}
 */
function candidateSlugs(film) {
  const candidates = [];
  const seen = new Set();
  const add = (slug, expectedTitle) => {
    if (!slug || seen.has(slug)) return;
    seen.add(slug);
    candidates.push({ slug, expectedTitle });
  };

  if (film.letterboxd_slug_hint) add(film.letterboxd_slug_hint, film.letterboxd_title ?? film.title);

  // Hints go FIRST. add() dedupes by slug and keeps whichever entry claimed it, so when a hint and
  // a generated variant produce the same slug, the one that arrives first decides which title the
  // page is checked against. A hint is the higher-confidence claim, and putting it last meant
  // 2-or-3-things-i-know-about-her landed on exactly the right page and was rejected for not
  // matching a title nobody had asked it to match.
  if (film.letterboxd_title) {
    const slug = slugify(film.letterboxd_title);
    add(slug, film.letterboxd_title);
    add(`${slug}-${film.year}`, film.letterboxd_title);
  }

  const fromTitle = slugify(film.title);
  add(film.id, film.title);
  add(fromTitle, film.title);
  add(`${fromTitle}-${film.year}`, film.title);

  const noArticle = film.title.replace(/^(the|a|an)\s+/i, '');
  if (noArticle !== film.title) {
    const slug = slugify(noArticle);
    add(slug, film.title);
    add(`${slug}-${film.year}`, film.title);
  }

  // Expect the digit spelling, not the original. Deriving the slug from "2 or 3 Things" and then
  // checking the page against "Two or Three Things" is a guaranteed mismatch on the exact films
  // this variant exists to catch.
  const digitTitle = withDigits(film.title);
  if (digitTitle !== film.title) {
    const slug = slugify(digitTitle);
    add(slug, digitTitle);
    add(`${slug}-${film.year}`, digitTitle);
  }

  return candidates;
}

/**
 * Two titles match if they're equal outright, if one is a colon-truncated prefix of the other —
 * "Twin Peaks" (the page) vs. "Twin Peaks: Seasons 1-2" (the corpus) — or if they differ only by a
 * leading article, which is how Letterboxd files "Kid with the Golden Arm" against our "The Kid
 * with the Golden Arm".
 *
 * All three are still gated by the year check alongside this, so a different film sharing a title
 * prefix needs a near-matching year too, not just the words.
 */
function titlesMatch(a, b) {
  const strip = (t) => normalise(t.split(':')[0]).replace(/^(the|a|an) /, '');
  if (normalise(a) === normalise(b)) return true;
  const coreA = strip(a);
  const coreB = strip(b);
  return coreA.length > 0 && coreA === coreB;
}

/**
 * Every rejection carries a reason rather than collapsing to null — a candidate slug that 404s,
 * one whose page has no year, and one whose page names a different film are three different
 * findings, and only the log line was ever telling them apart before this.
 * @param {{slug: string, expectedTitle: string}} candidate
 * @param {{year: number}} film
 * @returns {Promise<{ok: true, slug: string, poster: string|null, tmdbId: number|null} | {ok: false, slug: string, reason: string}>}
 */
async function tryCandidate(candidate, film) {
  const { slug, expectedTitle } = candidate;
  let response;
  try {
    response = await fetch(`https://letterboxd.com/film/${slug}/`, { headers: { 'User-Agent': UA } });
  } catch (err) {
    return { ok: false, slug, reason: `fetch failed: ${err.message}` };
  }
  if (!response.ok) return { ok: false, slug, reason: `HTTP ${response.status}` };
  const html = await response.text();

  const rawTitleMeta = html.match(/<meta property="og:title" content="([^"]*)"/)?.[1];
  if (!rawTitleMeta) return { ok: false, slug, reason: 'page has no og:title' };
  const titleMeta = decodeHtmlEntities(rawTitleMeta);
  const yearMatch = titleMeta.match(/\((\d{4})\)\s*$/);
  if (!yearMatch) return { ok: false, slug, reason: `og:title has no year: "${titleMeta}"` };
  const pageTitle = titleMeta.replace(/\s*\(\d{4}\)\s*$/, '');
  const pageYear = Number(yearMatch[1]);

  // The confidence gate: both title and year must agree, mirroring ingest-omdb.mjs's tolerance.
  if (!titlesMatch(pageTitle, expectedTitle)) {
    return { ok: false, slug, reason: `page is "${pageTitle}" (${pageYear}), not a title match` };
  }
  if (Math.abs(pageYear - film.year) > 1) {
    return { ok: false, slug, reason: `page year ${pageYear} vs. expected ${film.year}` };
  }

  const rawPoster = html.match(/<meta property="og:image" content="([^"]*)"/)?.[1];
  const poster = rawPoster ? decodeHtmlEntities(rawPoster) : null;
  const tmdbId = html.match(/href="https:\/\/(?:www\.)?themoviedb\.org\/movie\/(\d+)/)?.[1];

  return { ok: true, slug, poster, tmdbId: tmdbId ? Number(tmdbId) : null };
}

/**
 * @param {{id: string, title: string, year: number}} film
 * @returns {Promise<{ok: true, slug: string, poster: string|null, tmdbId: number|null} | {ok: false, attempts: string[]}>}
 */
async function resolveFilm(film) {
  const attempts = [];
  for (const candidate of candidateSlugs(film)) {
    const result = await tryCandidate(candidate, film);
    await sleep(REQUEST_GAP_MS);
    if (result.ok) return result;
    attempts.push(`${result.slug}: ${result.reason}`);
  }
  return { ok: false, attempts };
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
      if (film.letterboxd_slug !== null && film.letterboxd_slug !== undefined) continue;

      const match = await resolveFilm(film);
      if (match.ok) {
        node.set('letterboxd_slug', match.slug);
        const parts = ['slug'];
        // Never overwrites a poster or tmdb_id OMDb already resolved — this tool only adds what's
        // still missing.
        if (match.poster && (film.poster_url === null || film.poster_url === undefined)) {
          node.set('poster_url', match.poster);
          parts.push('poster');
        }
        if (match.tmdbId && (film.tmdb_id === null || film.tmdb_id === undefined)) {
          node.set('tmdb_id', match.tmdbId);
          parts.push(`tmdb:${match.tmdbId}`);
        }
        changed += 1;
        resolved += 1;
        console.log(`  ok    ${file}: ${film.id} -> ${parts.join(', ')}`);
      } else {
        unresolved += 1;
        console.warn(`  MISS  ${file}: ${film.id}`);
        for (const attempt of match.attempts) console.warn(`          ${attempt}`);
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
