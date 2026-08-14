// M5 — constraint invariants under fuzzing. Correctness, not quality.
//
// The spread suite asks whether the paths are interesting. This one asks whether they are legal,
// across thousands of profiles nobody would think to click through by hand. The distinction
// matters because the interesting failures here are all invisible from the happy path: they need
// an unusual content filter, or a viewer who has already seen most of the filmography.
//
// The content assertion is the one that must never be allowed to go yellow. A viewer excludes
// sexual violence, some film they picked hard-requires another that contains it, and a naive
// pipeline injects the prerequisite to satisfy the dependency — handing them exactly what they
// asked not to see. That is a breach of trust rather than a ranking mistake, and no downstream
// cleverness makes it recoverable.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCorpus } from '../tools/validate.mjs';
import { buildPath } from '../src/core/path.js';
import { CONTENT_FLAGS, DEPTHS, MODES } from '../src/core/profile.js';

const RUNS = 10000;

/** Deterministic PRNG so a failure is reproducible from the seed alone. */
function mulberry32(seed) {
  return function random() {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomProfile(random, filmIds) {
  const pick = (list) => list[Math.floor(random() * list.length)];
  const blocked = [...CONTENT_FLAGS, 'violence', 'sex'].filter(() => random() < 0.25);
  const seen = filmIds.filter(() => random() < 0.3);
  return {
    depth: pick(DEPTHS),
    mode: pick(MODES),
    tolOpacity: 1 + Math.floor(random() * 5),
    tolStillness: 1 + Math.floor(random() * 5),
    tolBleakness: 1 + Math.floor(random() * 5),
    prefHumor: 1 + Math.floor(random() * 5),
    blocked,
    seen,
  };
}

function blocks(film, blocked) {
  for (const flag of blocked) {
    if (CONTENT_FLAGS.includes(flag) && film.content[flag] === true) return true;
    if (!CONTENT_FLAGS.includes(flag) && film.content[flag] >= 3) return true;
  }
  return false;
}

test(`M5 — path invariants hold across ${RUNS} fuzzed profiles`, async () => {
  const corpus = await loadCorpus();
  const filmsById = new Map(corpus.films.map((film) => [film.id, film]));
  const entities = corpus.entities.filter((entity) => entity.kind === 'director');
  const random = mulberry32(20260813);

  let built = 0;
  let noPath = 0;

  for (let run = 0; run < RUNS; run += 1) {
    const entity = entities[Math.floor(random() * entities.length)];
    const filmIds = entity.films.map((pair) => pair.film);
    const profile = randomProfile(random, filmIds);
    const result = buildPath(entity, filmsById, profile);
    const context = `run ${run}, ${entity.slug}, profile ${JSON.stringify(profile)}`;

    assert.ok(
      ['ok', 'no_path'].includes(result.status),
      `${context} — unexpected status ${result.status}: ${result.reason}`,
    );

    if (result.status === 'no_path') {
      noPath += 1;
      // An empty result is only acceptable when it is explained. A bare empty list is a bug
      // wearing the costume of an edge case.
      assert.ok(result.reason, `${context} — no_path with no reason given`);
      assert.equal(result.films.length, 0, `${context} — no_path but films were returned`);
      continue;
    }
    built += 1;
    const path = result.films;
    assert.ok(path.length > 0, `${context} — status ok but the path is empty`);

    // Never exceed what was asked for. Prerequisites consume budget like anything else.
    if (Number.isFinite(profile.depth)) {
      assert.ok(
        path.length <= profile.depth,
        `${context} — asked for ${profile.depth}, got ${path.length}`,
      );
    }

    // THE safety invariant.
    for (const entry of path) {
      assert.ok(
        !blocks(entry.film, profile.blocked),
        `${context} — returned "${entry.film.id}", which the content filter excludes`,
      );
    }

    // Nothing already seen should be recommended again.
    for (const entry of path) {
      assert.ok(
        !profile.seen.includes(entry.film.id),
        `${context} — recommended "${entry.film.id}", which was marked as already seen`,
      );
    }

    // No repeats.
    const ids = path.map((entry) => entry.film.id);
    assert.equal(new Set(ids).size, ids.length, `${context} — a film appears twice`);

    // Hard prerequisites precede their dependents, or were already seen.
    const position = new Map(ids.map((id, index) => [id, index]));
    for (const edge of entity.prereqs ?? []) {
      if (edge.strength !== 'hard' || !position.has(edge.film)) continue;
      const satisfied =
        profile.seen.includes(edge.requires) ||
        (position.has(edge.requires) && position.get(edge.requires) < position.get(edge.film));
      assert.ok(satisfied, `${context} — "${edge.film}" precedes its hard prereq "${edge.requires}"`);
    }

    // Determinism. The growth loop is people sharing a path URL, so the same inputs must render
    // the same path on every load — an unstable tiebreak would quietly break that.
    const again = buildPath(entity, filmsById, profile).films.map((entry) => entry.film.id);
    assert.deepEqual(again, ids, `${context} — same input produced a different path`);
  }

  console.log(`    ${built} paths built, ${noPath} explicit no_path, ${RUNS} runs`);
  // A suite where everything filters down to nothing would pass every assertion above while
  // testing nothing at all.
  assert.ok(built > RUNS * 0.5, `only ${built}/${RUNS} runs produced a path; the fuzz is too harsh`);
});
