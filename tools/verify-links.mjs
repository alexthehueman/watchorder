// Checks that every poster_url and letterboxd_slug in the corpus actually resolves — validate.mjs
// only checks these fields are well-formed, which says nothing about whether the URL still serves
// anything. A poster that 404s renders as a broken image and a dead slug is a link to nowhere;
// both look fine to every other check we have.
//
// Run manually, by you, like ingest-letterboxd.mjs — it makes one HEAD request per poster and one
// per Letterboxd page.
//
// Usage:
//   npm run verify:links              check everything
//   npm run verify:links -- --posters only poster_url
//   npm run verify:links -- --slugs   only letterboxd_slug

import { readdir, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { parse } from 'yaml';

const FILM_DIR = new URL('../src/data/films/', import.meta.url);
const UA = 'Mozilla/5.0 (compatible; WatchOrder-personal-verify/0.1; non-commercial)';
const REQUEST_GAP_MS = 250;
const CONCURRENCY = 4;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function head(url) {
  try {
    // Some CDNs reject HEAD but serve GET; a failed HEAD is retried as a ranged GET before it
    // counts as a real failure, so the report doesn't fill up with false alarms.
    const res = await fetch(url, { method: 'HEAD', headers: { 'User-Agent': UA } });
    if (res.ok) return { ok: true };
    const retry = await fetch(url, { method: 'GET', headers: { 'User-Agent': UA, Range: 'bytes=0-0' } });
    return retry.ok ? { ok: true } : { ok: false, status: retry.status };
  } catch (err) {
    return { ok: false, status: err.message };
  }
}

async function loadFilms() {
  const files = (await readdir(FILM_DIR)).filter((n) => n.endsWith('.yaml')).sort();
  const films = [];
  for (const file of files) {
    for (const film of parse(await readFile(new URL(file, FILM_DIR), 'utf8')) ?? []) {
      films.push({ ...film, file });
    }
  }
  return films;
}

/** Runs `worker` over `items` a few at a time, so a full-corpus pass isn't strictly serial. */
async function pooled(items, worker) {
  const queue = [...items];
  const failures = [];
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (queue.length > 0) {
        const item = queue.shift();
        const failure = await worker(item);
        if (failure) failures.push(failure);
        await sleep(REQUEST_GAP_MS);
      }
    }),
  );
  return failures;
}

async function main() {
  const args = process.argv.slice(2);
  const only = args.includes('--posters') ? 'posters' : args.includes('--slugs') ? 'slugs' : 'all';
  const films = await loadFilms();

  let failed = 0;

  if (only === 'all' || only === 'posters') {
    const withPoster = films.filter((f) => f.poster_url);
    console.log(`Checking ${withPoster.length} poster URLs...`);
    const failures = await pooled(withPoster, async (film) => {
      const result = await head(film.poster_url);
      if (!result.ok) return `  DEAD  ${film.file}: ${film.id} — poster ${result.status}\n        ${film.poster_url}`;
      return null;
    });
    failures.sort().forEach((f) => console.error(f));
    console.log(`  ${withPoster.length - failures.length}/${withPoster.length} posters OK\n`);
    failed += failures.length;
  }

  if (only === 'all' || only === 'slugs') {
    const withSlug = films.filter((f) => f.letterboxd_slug);
    console.log(`Checking ${withSlug.length} Letterboxd slugs...`);
    const failures = await pooled(withSlug, async (film) => {
      const result = await head(`https://letterboxd.com/film/${film.letterboxd_slug}/`);
      if (!result.ok) return `  DEAD  ${film.file}: ${film.id} — slug ${result.status}\n        ${film.letterboxd_slug}`;
      return null;
    });
    failures.sort().forEach((f) => console.error(f));
    console.log(`  ${withSlug.length - failures.length}/${withSlug.length} slugs OK\n`);
    failed += failures.length;
  }

  const missingPoster = films.filter((f) => !f.poster_url);
  const missingSlug = films.filter((f) => !f.letterboxd_slug);
  console.log(`Coverage: ${films.length - missingPoster.length}/${films.length} have a poster, ${films.length - missingSlug.length}/${films.length} have a Letterboxd link`);
  if (missingPoster.length > 0) {
    console.log(`\nNo poster (${missingPoster.length}):`);
    for (const f of missingPoster) console.log(`  ${f.file}: ${f.id}`);
  }
  if (missingSlug.length > 0) {
    console.log(`\nNo Letterboxd link (${missingSlug.length}):`);
    for (const f of missingSlug) console.log(`  ${f.file}: ${f.id}`);
  }

  if (failed > 0) {
    console.error(`\n${failed} dead link(s) — these render as broken images or dead links on the site.`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
