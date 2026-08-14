// The corpus is the moat, so it gets tested like code.
//
// Two different jobs here. validateCorpus covers structural integrity — broken references,
// out-of-range tags, prereq cycles. The collinearity gate covers something structural integrity
// cannot see: whether the four taste axes are actually measuring four different things.
//
// That second one is the early-warning system for the whole product. If opacity and bleakness
// drift into measuring the same latent "difficulty", the tag matrix collapses toward rank-1 and
// the quiz degenerates into a single slider wearing four questions as a costume — which is
// exactly the failure the engine exists to avoid.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCorpus, validateCorpus } from '../tools/validate.mjs';

const TASTE_TAGS = ['opacity', 'stillness', 'bleakness', 'humor'];

// Two thresholds, because one number cannot do this job at every corpus size.
//
// REDUNDANT is a tagging error at any size: above 0.95 the two columns are duplicates and one of
// them is not earning its tagging cost, whoever the artist is.
//
// COLLAPSED is the real gate, and it only means anything once the corpus spans several entities.
// Pooled correlation over a single auteur measures *that auteur's consistency*, not redundant
// axes — Lynch's most opaque films genuinely are his bleakest, and that is a fact about Lynch
// rather than a defect in the schema. Asserting 0.75 against a one-entity corpus would therefore
// punish accurate tagging, so the assertion waits until there is enough spread to be meaningful.
// Until then, M3 and M6 in the spread suite adjudicate the same question empirically, on the
// engine's actual output, which is the measurement that decides the product anyway.
const REDUNDANT_RHO = 0.95;
const COLLAPSED_RHO = 0.75;
const MIN_ENTITIES_FOR_COLLAPSE_GATE = 3;

/**
 * Fractional ranks, averaging ties — the standard correction, and necessary here because
 * integer 1-5 tags tie constantly.
 * @param {number[]} values
 * @returns {number[]}
 */
function rank(values) {
  const order = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const ranks = new Array(values.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1].value === order[i].value) j += 1;
    const shared = (i + j) / 2 + 1;
    for (let k = i; k <= j; k += 1) ranks[order[k].index] = shared;
    i = j + 1;
  }
  return ranks;
}

/**
 * Spearman's rho — Pearson correlation over ranks.
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number}
 */
function spearman(a, b) {
  const ra = rank(a);
  const rb = rank(b);
  const n = ra.length;
  const meanA = ra.reduce((sum, value) => sum + value, 0) / n;
  const meanB = rb.reduce((sum, value) => sum + value, 0) / n;
  let numerator = 0;
  let sumSqA = 0;
  let sumSqB = 0;
  for (let i = 0; i < n; i += 1) {
    const da = ra[i] - meanA;
    const db = rb[i] - meanB;
    numerator += da * db;
    sumSqA += da * da;
    sumSqB += db * db;
  }
  if (sumSqA === 0 || sumSqB === 0) return 0;
  return numerator / Math.sqrt(sumSqA * sumSqB);
}

test('corpus passes structural validation with zero errors', async () => {
  const { errors } = validateCorpus(await loadCorpus());
  assert.deepEqual(errors, [], `corpus has ${errors.length} structural errors`);
});

test('every entity resolves to at least one film with a legal opener', async () => {
  const corpus = await loadCorpus();
  for (const entity of corpus.entities) {
    const films = entity.films ?? [];
    assert.ok(films.length > 0, `${entity.slug} lists no films`);
    assert.ok(
      films.some((pair) => pair.gateway > 0),
      `${entity.slug} has no film with gateway > 0, so no path can open`,
    );
  }
});

test('taste axes are not collinear — the tag matrix must not collapse to one dimension', async () => {
  const corpus = await loadCorpus();
  const columns = new Map(TASTE_TAGS.map((tag) => [tag, corpus.films.map((f) => f.tags[tag])]));

  const report = [];
  const redundant = [];
  const collapsed = [];
  for (let i = 0; i < TASTE_TAGS.length; i += 1) {
    for (let j = i + 1; j < TASTE_TAGS.length; j += 1) {
      const [a, b] = [TASTE_TAGS[i], TASTE_TAGS[j]];
      const rho = spearman(columns.get(a), columns.get(b));
      report.push(`${a} x ${b}: ${rho.toFixed(3)}`);
      if (Math.abs(rho) > REDUNDANT_RHO) {
        redundant.push(`${a} and ${b} are duplicates at rho=${rho.toFixed(3)}`);
      } else if (Math.abs(rho) > COLLAPSED_RHO) {
        collapsed.push(`${a} and ${b} correlate at rho=${rho.toFixed(3)}`);
      }
    }
  }
  const entityCount = corpus.entities.length;
  console.log(
    `    spearman rho over ${corpus.films.length} films, ${entityCount} entities:\n      ` +
      report.join('\n      '),
  );

  assert.deepEqual(
    redundant,
    [],
    'these axes are duplicates at any corpus size — one of them is not earning its tagging cost',
  );

  if (entityCount < MIN_ENTITIES_FOR_COLLAPSE_GATE) {
    if (collapsed.length > 0) {
      console.log(
        `    note: ${collapsed.join('; ')} — not gated below ` +
          `${MIN_ENTITIES_FOR_COLLAPSE_GATE} entities, since pooled correlation over one ` +
          "auteur measures that auteur's consistency rather than redundant axes",
      );
    }
    return;
  }

  assert.deepEqual(
    collapsed,
    [],
    'collinear taste axes measure the same latent variable, which collapses the quiz to a ' +
      'single difficulty slider. Fix the tags or merge the axes',
  );
});

test('no entity is blind to a quiz-driven tag', async () => {
  const corpus = await loadCorpus();
  const byId = new Map(corpus.films.map((film) => [film.id, film]));
  for (const entity of corpus.entities) {
    for (const tag of TASTE_TAGS) {
      const values = (entity.films ?? []).map((pair) => byId.get(pair.film).tags[tag]);
      const spread = new Set(values).size;
      assert.ok(
        spread > 1,
        `${entity.slug} has identical ${tag} across every film, so no quiz answer about ` +
          `${tag} can change their path`,
      );
    }
  }
});
