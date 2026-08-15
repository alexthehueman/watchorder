// Reads the corpus, writes dist/. Hand-written rather than configured, in the manner of
// Tab-Closer/scripts/build.mjs.
//
// The build refuses to run on an invalid corpus. That ordering is deliberate: a broken film
// reference renders a silently short page rather than an error, and a page that is quietly
// missing its best entry is the kind of defect nobody reports and everybody notices.

import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { loadCorpus, validateCorpus } from './tools/validate.mjs';
import { entityPage, indexPage, sitemap } from './src/templates/pages.js';

const DIST = new URL('./dist/', import.meta.url);

// Where the built site will be served from.
//
// A GitHub Pages *project* site lives at /<repo>/, so every absolute URL needs that prefix or the
// deploy has no stylesheet and no working links — a failure that is invisible locally, where the
// site is served from the root. BASE is set by the deploy workflow and empty everywhere else.
// ORIGIN only affects canonical tags and the sitemap.
const SITE = {
  base: (process.env.BASE ?? '').replace(/\/$/, ''),
  origin: process.env.ORIGIN ?? 'http://localhost:8123',
};

/**
 * Resolve a curated order into renderable entries.
 *
 * The house pick is a human's ordering, so it does not get the engine's "why here" lines — those
 * describe a computed placement against a viewer's curve, and attaching them to a hand-written
 * order would be narrating a decision that was never made that way. The one exception is a hard
 * prerequisite, which is a fact about the films rather than an inference about the ordering.
 */
function resolveCuratedPath(entity, filmsById) {
  const pairsById = new Map((entity.films ?? []).map((pair) => [pair.film, pair]));
  const order = entity.curated?.order ?? [];
  const positions = new Map(order.map((id, index) => [id, index]));

  return order.map((id) => {
    const prereq = (entity.prereqs ?? []).find(
      (edge) =>
        edge.film === id &&
        edge.strength === 'hard' &&
        positions.has(edge.requires) &&
        positions.get(edge.requires) < positions.get(id),
    );
    return {
      film: filmsById.get(id),
      pair: pairsById.get(id),
      why: prereq ? `Held until after ${filmsById.get(prereq.requires).title} — it assumes it.` : null,
      warning: null,
    };
  });
}

/**
 * Clear dist/ by emptying it rather than removing it.
 *
 * Removing the directory itself fails on Windows with EBUSY whenever anything holds a handle on
 * it — and the obvious thing holding one is the preview server you started to look at the last
 * build. A build that breaks because you are currently looking at the site is a bad build.
 */
async function emptyDist() {
  await mkdir(DIST, { recursive: true });
  for (const entry of await readdir(DIST)) {
    await rm(new URL(entry, DIST), { recursive: true, force: true });
  }
}

async function main() {
  const corpus = await loadCorpus();
  const { errors } = validateCorpus(corpus);
  if (errors.length > 0) {
    for (const error of errors) console.error(`ERROR ${error}`);
    console.error(`\nrefusing to build: ${errors.length} corpus errors`);
    process.exitCode = 1;
    return;
  }

  const filmsById = new Map(corpus.films.map((film) => [film.id, film]));
  await emptyDist();

  const written = [];
  const paths = ['/'];

  await writeFile(new URL('index.html', DIST), indexPage(corpus.entities, filmsById, SITE), 'utf8');
  written.push('index.html');

  for (const entity of corpus.entities) {
    const directory = new URL(`${entity.kind}/${entity.slug}/`, DIST);
    await mkdir(directory, { recursive: true });
    const housePath = resolveCuratedPath(entity, filmsById);
    await writeFile(
      new URL('index.html', directory),
      entityPage(entity, filmsById, housePath, SITE),
      'utf8',
    );
    written.push(`${entity.kind}/${entity.slug}/index.html`);
    paths.push(`/${entity.kind}/${entity.slug}/`);
  }

  await writeFile(new URL('sitemap.xml', DIST), sitemap(paths, SITE), 'utf8');
  written.push('sitemap.xml');

  // The browser loads src/core/ unchanged, over native ESM. Copying rather than bundling is the
  // point: the quiz runs the identical module this build just used for the house pick, so there
  // is no second implementation of the ranking rules to drift. Their relative imports keep
  // working because dist mirrors the source layout exactly — ../core/path.js resolves in both.
  for (const directory of ['core', 'ui']) {
    await mkdir(new URL(`${directory}/`, DIST), { recursive: true });
    const source = new URL(`./src/${directory}/`, import.meta.url);
    for (const name of await readdir(source)) {
      const contents = await readFile(new URL(name, source), 'utf8');
      await writeFile(new URL(`${directory}/${name}`, DIST), contents, 'utf8');
      written.push(`${directory}/${name}`);
    }
  }

  // GitHub Pages otherwise runs the output through Jekyll, which drops files beginning with an
  // underscore and does nothing else we want.
  await writeFile(new URL('.nojekyll', DIST), '', 'utf8');

  console.log(`built ${written.length} files into dist/`);
  for (const file of written) console.log(`  ${file}`);
}

await main();
