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
import {
  CONTENT_FLAGS,
  DEPTHS,
  MODES,
  encodeAnswers,
  decodeProfile,
  profileFromAnswers,
  answersFromProfile,
} from '../src/core/profile.js';

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

test('a profile survives the round trip through a URL', async () => {
  const corpus = await loadCorpus();
  const entity = corpus.entities[0];
  const filmOrder = entity.films.map((pair) => pair.film);
  const random = mulberry32(7);

  for (let run = 0; run < 500; run += 1) {
    const answers = {
      depth: Math.floor(random() * DEPTHS.length),
      mode: Math.floor(random() * MODES.length),
      confusion: Math.floor(random() * 3),
      register: Math.floor(random() * 3),
    };
    const seen = filmOrder.filter(() => random() < 0.3);
    const blocked = CONTENT_FLAGS.filter(() => random() < 0.3);

    const seenIndices = seen.map((id) => filmOrder.indexOf(id));
    const encoded = encodeAnswers(answers, seenIndices, blocked);
    const decoded = decodeProfile(encoded.p, encoded.s, filmOrder, encoded.c);
    const direct = profileFromAnswers(answers, { seen, blocked });

    const context = `answers ${JSON.stringify(answers)}, blocked ${blocked}`;
    assert.equal(decoded.depth, direct.depth, `${context} — depth lost`);
    assert.equal(decoded.mode, direct.mode, `${context} — mode lost`);
    assert.equal(decoded.tolOpacity, direct.tolOpacity, `${context} — opacity tolerance lost`);
    assert.equal(decoded.tolBleakness, direct.tolBleakness, `${context} — bleakness tolerance lost`);
    // Exclusions surviving the trip matters most: a link that dropped them would show the
    // recipient precisely what the sender had asked not to see.
    assert.deepEqual([...decoded.blocked].sort(), [...blocked].sort(), `${context} — exclusions lost`);
    assert.deepEqual([...decoded.seen].sort(), [...seen].sort(), `${context} — seen set lost`);
    // The form has to be restorable from the profile, or a shared link reopens with the
    // controls disagreeing with the list beneath them.
    assert.deepEqual(answersFromProfile(decoded), answers, `${context} — form state not restorable`);
  }
});

test('a cameo never reaches a path unless everything was asked for', async () => {
  // Tested against a synthetic pair rather than the corpus, because nothing in the corpus is
  // currently tagged as a cameo — a test over real data would pass whether the rule worked or
  // not. The rule matters the moment anyone adds one, and "recommends a film the actor is in for
  // four minutes" is the single most credibility-destroying output this engine could produce.
  const corpus = await loadCorpus();
  const filmsById = new Map(corpus.films.map((film) => [film.id, film]));
  const cage = corpus.entities.find((entity) => entity.slug === 'nicolas-cage');

  const withCameo = {
    ...cage,
    films: cage.films.map((pair) =>
      pair.film === 'the-rock' ? { ...pair, role_size: 'cameo', signature: 5, showcase: 5 } : pair,
    ),
  };

  for (const depth of [0, 1, 2]) {
    const result = buildPath(withCameo, filmsById, profileFromAnswers({ depth, mode: 0, confusion: 1, register: 1 }));
    assert.ok(
      !result.films.some((entry) => entry.film.id === 'the-rock'),
      `depth index ${depth} recommended a cameo despite signature 5`,
    );
  }

  // The completist asked for the whole filmography and should get it, walk-ons included.
  const everything = buildPath(withCameo, filmsById, profileFromAnswers({ depth: 3, mode: 0, confusion: 1, register: 1 }));
  assert.ok(
    everything.films.some((entry) => entry.film.id === 'the-rock'),
    'the completist path should still include the cameo',
  );
});

test('a studio path is not one director wearing a studio name', async () => {
  const corpus = await loadCorpus();
  const filmsById = new Map(corpus.films.map((film) => [film.id, film]));
  const studios = corpus.entities.filter((entity) => entity.kind === 'studio');

  for (const studio of studios) {
    const directors = new Set(
      studio.films.map((pair) => filmsById.get(pair.film).director).filter(Boolean),
    );

    for (const depth of [0, 1, 2]) {
      const result = buildPath(studio, filmsById, profileFromAnswers({ depth, mode: 1, confusion: 1, register: 1 }));
      const counts = new Map();
      for (const entry of result.films) {
        counts.set(entry.film.director, (counts.get(entry.film.director) ?? 0) + 1);
      }
      const most = Math.max(0, ...counts.values());
      // The cap scales with how much diversity the catalogue has: two directors made every Ghibli
      // film, so an even share of the request is the fairest the rule can be. What must never
      // happen is a path being STARVED by its own quota — asking for six and receiving four.
      //
      // Derived from the budget REQUESTED rather than the films returned, matching the engine.
      // Using the result length would let a short path retroactively tighten its own cap.
      const budget = Math.min(DEPTHS[depth], studio.films.length);
      const allowed = Math.max(2, Math.ceil(budget / directors.size));
      assert.ok(
        most <= allowed,
        `${studio.slug} depth ${depth}: ${most} films by one director, over the cap of ${allowed}`,
      );
    }

    // And the completist gets the catalogue, quota or not.
    const everything = buildPath(studio, filmsById, profileFromAnswers({ depth: 3, mode: 1, confusion: 1, register: 1 }));
    assert.equal(
      everything.films.length,
      studio.films.length,
      `${studio.slug}: asked for everything, got ${everything.films.length} of ${studio.films.length}`,
    );
  }
});

test('range mode puts contrasting performances next to each other', async () => {
  const corpus = await loadCorpus();
  const filmsById = new Map(corpus.films.map((film) => [film.id, film]));
  const actors = corpus.entities.filter((entity) => entity.kind === 'actor');

  for (const actor of actors) {
    // Mode index 1 is "watch them develop" for a director and resolves to `range` for an actor,
    // since release order is mostly the order other people hired them.
    const ranged = buildPath(actor, filmsById, profileFromAnswers({ depth: 2, mode: 1, confusion: 2, register: 1 }));
    const registers = ranged.films.map((entry) => entry.pair.register);
    let repeats = 0;
    for (let i = 1; i < registers.length; i += 1) {
      if (registers[i] === registers[i - 1]) repeats += 1;
    }
    const rate = registers.length > 1 ? repeats / (registers.length - 1) : 0;
    console.log(
      `    ${actor.slug}: ${new Set(registers).size} registers over ${registers.length} films, ` +
        `${(rate * 100).toFixed(0)}% adjacent repeats`,
    );
    assert.ok(
      rate <= 0.4,
      `${actor.slug}: ${(rate * 100).toFixed(0)}% of adjacent pairs repeat a register in range mode`,
    );
  }
});

test('generated copy never assumes a pronoun', async () => {
  // Hand-written notes and blurbs in the corpus name a real person and may of course use their
  // pronouns. Generated copy cannot: the engine knows a slug and a name, nothing more. The first
  // draft said "the cleanest way into his work" on every page, which is correct for eleven of the
  // fifteen directors and wrong on Varda, Denis, Akerman and Ramsay.
  const corpus = await loadCorpus();
  const filmsById = new Map(corpus.films.map((film) => [film.id, film]));
  const gendered = /\b(his|him|her|hers|she|he)\b/i;

  for (const entity of corpus.entities) {
    for (const answers of [
      { depth: 0, mode: 0, confusion: 0, register: 0 },
      { depth: 1, mode: 1, confusion: 1, register: 1 },
      { depth: 2, mode: 2, confusion: 2, register: 2 },
      { depth: 3, mode: 0, confusion: 2, register: 0 },
    ]) {
      const result = buildPath(entity, filmsById, profileFromAnswers(answers));
      for (const entry of result.films) {
        if (!entry.why) continue;
        assert.ok(
          !gendered.test(entry.why),
          `${entity.slug}: generated line assumes a pronoun — "${entry.why}"`,
        );
      }
    }
  }
});

test('a mangled URL degrades to the neutral profile rather than throwing', () => {
  for (const bad of ['', 'x', 'a12', 'a12345', 'zzzz', '!!!', 'a12x4']) {
    const profile = decodeProfile(bad, 'nonsense', ['a', 'b']);
    assert.equal(profile.mode, 'ramp', `"${bad}" should fall back to the neutral profile`);
    assert.ok(Array.isArray(profile.seen));
  }
});

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
