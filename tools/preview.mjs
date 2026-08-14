// Prints an entity's path under contrasting profiles, side by side.
//
// This is the Phase 2 go/no-go check, and it is meant to be read by a human rather than asserted
// by a test. The spread suite measures divergence numerically; this shows whether the divergence
// is any *good*. A high spread score on lists a cinephile would not defend is worse than no
// personalisation at all — a converged-but-correct product is merely unremarkable, whereas a
// spread-but-wrong one is embarrassing to exactly the audience we want.
//
//   npm run preview -- david-lynch

import { pathToFileURL } from 'node:url';
import { loadCorpus } from './validate.mjs';
import { buildPath } from '../src/core/path.js';
import { profileFromAnswers } from '../src/core/profile.js';

const ARCHETYPES = [
  { label: 'Cautious newcomer', answers: { depth: 0, mode: 0, confusion: 0, register: 0 } },
  { label: 'Seasoned head', answers: { depth: 0, mode: 2, confusion: 2, register: 2 } },
  { label: 'Comfort, six films', answers: { depth: 1, mode: 0, confusion: 0, register: 0 } },
  { label: 'Confrontation, six', answers: { depth: 1, mode: 0, confusion: 2, register: 2 } },
  { label: 'Chronological, all', answers: { depth: 3, mode: 1, confusion: 1, register: 1 } },
];

async function main() {
  const slug = process.argv[2] ?? 'david-lynch';
  const corpus = await loadCorpus();
  const entity = corpus.entities.find((candidate) => candidate.slug === slug);
  if (!entity) {
    console.error(`no entity "${slug}"`);
    process.exitCode = 1;
    return;
  }
  const filmsById = new Map(corpus.films.map((film) => [film.id, film]));
  const titles = new Map(corpus.films.map((film) => [film.id, film.title]));

  console.log(`\n${entity.name} — ${entity.blurb}\n`);
  console.log(`house pick: ${entity.curated.order.map((id) => titles.get(id)).join(' -> ')}\n`);

  const openers = new Map();
  for (const archetype of ARCHETYPES) {
    const profile = profileFromAnswers(archetype.answers);
    const result = buildPath(entity, filmsById, profile);

    console.log(`${archetype.label}  [${result.status}]`);
    if (result.status !== 'ok') console.log(`  ${result.reason}`);
    result.films.forEach((entry) => {
      console.log(`  ${String(entry.position).padStart(2)}. ${entry.film.title}`);
      // `why` is deliberately null where the ordering speaks for itself, e.g. mid-path in
      // chronological mode, where the year on the card already says it.
      if (entry.why) console.log(`      ${entry.why}`);
    });
    if (result.films.length > 0) {
      const opener = result.films[0].film.title;
      openers.set(opener, (openers.get(opener) ?? 0) + 1);
    }
    console.log('');
  }

  console.log('distinct openers across the archetypes:');
  for (const [title, count] of openers) console.log(`  ${count}x  ${title}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
