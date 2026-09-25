// Corpus-wide check that every letterboxd_slug actually points at the film it's supposed to.
//
// Every other ingest tool here verifies a slug once, at the moment it's assigned, and then trusts
// it forever — including this project's own genre and rating scrapers. That trust was misplaced at
// least five times: Ray, The Fighter, The Informant, The Bank Job and Nineteen Eighty-Four had all
// resolved to a different, unrelated film sharing the same short/generic title, discovered only
// because those particular wrong pages happened to also lack a rating. A wrong page that DOES have
// a rating produces no symptom at all — a confidently wrong number sitting on the site with nothing
// to flag it. This tool is the general check: re-fetch every slug already on file and confirm its
// title still means the film we think it does, the same title+year discipline candidateSlugs() in
// ingest-letterboxd.mjs uses when a slug is first assigned.
//
// This never writes anything by itself. It only reports. Fixing a confirmed-wrong slug is a
// judgment call (find the real slug, verify it independently, decide what to do with data that was
// scraped from the wrong page) that belongs to a person, not a script running unattended overnight.
//
// Usage:
//   npm run audit:letterboxd-slugs                check every film with a letterboxd_slug
//   npm run audit:letterboxd-slugs -- --limit=50   only check the first 50 (for a quick test run)

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { parseDocument } from 'yaml';

const FILM_DIR = new URL('../src/data/films/', import.meta.url);
const UA = 'Mozilla/5.0 (compatible; WatchOrder-personal-ingest/0.1; non-commercial)';
const REQUEST_GAP_MS = 500;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

// Identical to ingest-letterboxd.mjs's titlesMatch — a page whose title is a colon-truncated
// prefix of ours, or differs only by a leading article, is the same film Letterboxd files
// slightly differently, not a mismatch worth flagging.
function titlesMatch(a, b) {
  const strip = (t) => normalise(t.split(':')[0]).replace(/^(the|a|an) /, '');
  if (normalise(a) === normalise(b)) return true;
  const coreA = strip(a);
  const coreB = strip(b);
  return coreA.length > 0 && coreA === coreB;
}

async function checkFilm(film) {
  let response;
  try {
    response = await fetch(`https://letterboxd.com/film/${film.letterboxd_slug}/`, { headers: { 'User-Agent': UA } });
  } catch (err) {
    return { status: 'error', reason: `fetch failed: ${err.message}` };
  }
  if (!response.ok) return { status: 'error', reason: `HTTP ${response.status}` };
  const html = await response.text();

  const rawTitleMeta = html.match(/<meta property="og:title" content="([^"]*)"/)?.[1];
  if (!rawTitleMeta) return { status: 'error', reason: 'page has no og:title' };
  const titleMeta = decodeHtmlEntities(rawTitleMeta);
  const yearMatch = titleMeta.match(/\((\d{4})\)\s*$/);
  if (!yearMatch) return { status: 'unverifiable', reason: `og:title has no year: "${titleMeta}"` };

  const pageTitle = titleMeta.replace(/\s*\(\d{4}\)\s*$/, '');
  const pageYear = Number(yearMatch[1]);
  const expectedTitle = film.letterboxd_title ?? film.title;

  if (!titlesMatch(pageTitle, expectedTitle)) {
    return { status: 'mismatch', reason: `page is "${pageTitle}" (${pageYear}), expected "${expectedTitle}" (${film.year})` };
  }
  if (Math.abs(pageYear - film.year) > 1) {
    return { status: 'mismatch', reason: `page year ${pageYear} vs. expected ${film.year} (title matched: "${pageTitle}")` };
  }
  return { status: 'ok' };
}

async function main() {
  const args = process.argv.slice(2);
  const limitArg = args.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.split('=')[1]) : Infinity;

  const files = (await readdir(FILM_DIR)).filter((name) => name.endsWith('.yaml')).sort();
  const flagged = [];
  let checked = 0;
  let ok = 0;
  let unverifiable = 0;
  let errors = 0;

  outer: for (const file of files) {
    const path = new URL(file, FILM_DIR);
    const doc = parseDocument(await readFile(path, 'utf8'));
    for (const node of doc.contents?.items ?? []) {
      const film = node.toJSON();
      if (!film.letterboxd_slug) continue;
      if (checked >= limit) break outer;

      const result = await checkFilm(film);
      checked += 1;
      await sleep(REQUEST_GAP_MS);

      if (result.status === 'ok') {
        ok += 1;
      } else if (result.status === 'unverifiable') {
        unverifiable += 1;
        console.log(`  ?     ${file}: ${film.id} (${film.letterboxd_slug}) — ${result.reason}`);
      } else if (result.status === 'mismatch') {
        flagged.push({ file, id: film.id, slug: film.letterboxd_slug, title: film.title, year: film.year, reason: result.reason });
        console.log(`  MISMATCH  ${file}: ${film.id} (${film.letterboxd_slug}) — ${result.reason}`);
      } else {
        errors += 1;
        console.log(`  ERROR ${file}: ${film.id} (${film.letterboxd_slug}) — ${result.reason}`);
      }
    }
  }

  console.log(`\n${checked} checked, ${ok} ok, ${flagged.length} mismatched, ${unverifiable} unverifiable, ${errors} errors`);

  if (flagged.length > 0) {
    const report = [
      '# Letterboxd slug audit — mismatches found',
      '',
      'Not committed to the repo; local working list. Each of these currently has a letterboxd_slug',
      'whose page title/year does not match our own — the same failure mode as Ray, The Fighter, The',
      'Informant, The Bank Job and Nineteen Eighty-Four, found by hand before this tool existed.',
      '',
      'For each: find the real slug (WebSearch + direct fetch verification, title+year+director',
      'agreement, never guess), then re-scrape genres/rating/poster/tmdb_id from the corrected page —',
      'the old ones were contaminated from the wrong page. If no real Letterboxd page can be found at',
      'all, leave the current (wrong) data in place and note that here rather than guessing further.',
      '',
      ...flagged.map((f) => `- [ ] ${f.file} : ${f.id} (currently \`${f.slug}\`) — ${f.reason}`),
    ].join('\n');
    await writeFile(new URL('../LETTERBOXD_SLUG_AUDIT.md', import.meta.url), report, 'utf8');
    console.log(`\nWrote LETTERBOXD_SLUG_AUDIT.md (${flagged.length} films to review)`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
