// How well one film suits one viewer. Everything downstream is selection and permutation.
//
// The design problem this file exists to solve: a naive score lets `signature` dominate. Give
// signature a linear reward with weight 2 and the tag penalties linear weights below 1, and a
// two-point signature gap beats any plausible taste mismatch, so every profile converges on the
// same canon and the quiz becomes decoration. Two mechanisms prevent that here.
//
// First, the over-tolerance penalty is superlinear (^1.5). One notch too slow is fine; three
// notches is abandonment, and the arithmetic has to say so.
//
// Second, penalties are asymmetric across two different normalisations. Over-tolerance is scored
// against ABSOLUTE tag values, so someone with low tolerance is genuinely protected. Under-
// tolerance is scored against ENTITY-RELATIVE values, so the quiz still discriminates inside a
// filmography whose absolute range is narrow. Using absolute alone makes the quiz inert for a
// consistent director; using relative alone throws a cautious viewer at Inland Empire on the
// grounds that it is "normal for Lynch". Both failures are real, so both normalisations are kept.

import { kindProfile } from './kinds.js';

const TASTE_TAGS = ['opacity', 'stillness', 'bleakness', 'humor'];

// Signature matters most when the list is short — at three films you want the canon, by twelve
// you already have it and what you want is range.
//
// Interpolated rather than looked up. A lookup keyed on {3, 6, 12} silently hands every other
// depth the tail weight, so a nine-film path would score as though signature barely mattered and
// quietly return a comfort list instead of a canon. The quiz only emits the four keyed values
// today, which is exactly what made that bug invisible until a test asked for depth 9.
const SIGNATURE_POINTS = [
  [3, 2.0],
  [6, 1.4],
  [12, 0.9],
];
const SIGNATURE_TAIL = 0.5;

/**
 * Piecewise-linear across the anchor points, flat outside them.
 * @param {number} depth
 * @returns {number}
 */
function signatureWeight(depth) {
  if (!Number.isFinite(depth)) return SIGNATURE_TAIL;
  if (depth <= SIGNATURE_POINTS[0][0]) return SIGNATURE_POINTS[0][1];
  for (let i = 0; i < SIGNATURE_POINTS.length - 1; i += 1) {
    const [x0, y0] = SIGNATURE_POINTS[i];
    const [x1, y1] = SIGNATURE_POINTS[i + 1];
    if (depth <= x1) return y0 + ((y1 - y0) * (depth - x0)) / (x1 - x0);
  }
  return SIGNATURE_TAIL;
}

// Runtime bites hardest on a short path, where one long work eats the whole budget.
function runtimeWeight(depth) {
  return Number.isFinite(depth) && depth <= 3 ? 2.0 : 1.0;
}

/**
 * What a work costs a viewer in time. Two different costs, because a series is not simply a very
 * long film and scoring it as one is wrong in both directions.
 *
 * ENDURANCE is "can you sit through this in one go", and for a series the honest measure is the
 * episode, not the run. Seventeen hours of Twin Peaks watched over a month asks nothing like what
 * a seventeen-hour film would ask, and charging it as though it did buried both Twin Peaks
 * entries beneath films nobody would rank above them.
 *
 * COMMITMENT is "how much of your life does this claim", which is real and which a per-episode
 * measure alone would ignore entirely. It grows with the log of total length rather than
 * linearly, because a long work amortises — the tenth hour of a series you are enjoying costs far
 * less than the first.
 *
 * The commitment coefficient carries more weight than it first looks like it should, because a
 * budget of "three films" is a TIME budget expressed as a COUNT, and a count under-prices long
 * work badly: a twenty-one hour series takes one slot of three while quietly consuming ten times
 * the implied time. At 0.15 the penalty was weak enough that a three-film introduction to Lynch
 * came back with all of Twin Peaks as its second entry, which is not what anyone asking that
 * question meant. At 0.35 a series costs roughly one quality point more than a feature, so it
 * earns a slot in a short list only by being substantially better — which is the right bar.
 *
 * @param {{runtime: number, medium?: string, episodes?: number}} film
 * @returns {number}
 */
/**
 * How many slots of the viewer's budget this work consumes.
 *
 * "Three films" is a TIME budget wearing a count's clothing, and no penalty coefficient fixes
 * that, because it is a unit error rather than a weighting one. Twenty-one hours of Twin Peaks
 * occupying one slot of three is simply a false statement about what was asked for — and it kept
 * happening no matter how the commitment penalty was tuned, because the series was genuinely
 * winning on merit. It is warm, funny and acclaimed, which is exactly what a viewer asking for
 * comfort wants. The scoring was right; the arithmetic of the budget was wrong.
 *
 * A slot is roughly one film, so a series costs roughly as many films' worth of time as it runs.
 * Capped at three so a long series remains reachable at depth six rather than being priced out
 * of every path that is not unlimited.
 *
 * @param {{runtime: number, medium?: string}} film
 * @returns {number}
 */
export function slotCost(film) {
  if (film.medium !== 'series') return 1;
  return Math.min(3, Math.max(1, Math.round(film.runtime / 200)));
}

function timeCost(film) {
  const perSitting = film.medium === 'series' ? film.runtime / film.episodes : film.runtime;
  const endurance = 0.004 * Math.max(0, perSitting - 130);
  const commitment = 0.35 * Math.log2(1 + film.runtime / 120);
  return endurance + commitment;
}

function quantile(sorted, q) {
  if (sorted.length === 0) return 0;
  const position = (sorted.length - 1) * q;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Median and a robust scale per tag, computed across this entity's films only. Robust statistics
 * rather than mean/sd because these samples are tiny and a single outlier would otherwise move
 * the whole scale.
 * @param {Array<{tags: object}>} films
 * @returns {Record<string, {median: number, scale: number}>}
 */
export function entityStats(films) {
  const stats = {};
  for (const tag of TASTE_TAGS) {
    const sorted = films.map((film) => film.tags[tag]).sort((a, b) => a - b);
    const iqr = quantile(sorted, 0.75) - quantile(sorted, 0.25);
    // The +0.5 floor keeps a filmography with almost no spread from producing enormous z-scores.
    stats[tag] = { median: quantile(sorted, 0.5), scale: iqr / 1.35 + 0.5 };
  }
  return stats;
}

/**
 * The tag value re-expressed on a 1-5 scale relative to this entity rather than to all cinema.
 * @returns {number}
 */
function relative(value, stat) {
  return 3 + clamp((value - stat.median) / stat.scale, -2, 2);
}

/**
 * Composite demand a film makes on a viewer, 0-1. Humor is deliberately excluded — it is the
 * axis that is not about difficulty, and folding it in here would undo the reason it exists.
 * Used by the sequencer to shape the difficulty curve.
 * @param {{tags: object}} film
 * @returns {number}
 */
export function difficulty(film) {
  const { opacity, stillness, bleakness } = film.tags;
  return clamp((0.5 * opacity + 0.3 * stillness + 0.2 * bleakness - 1) / 4, 0, 1);
}

/**
 * How alike two films feel, 0-1, over the taste axes. Feeds the diversity discount in selection
 * so a twelve-film path is not twelve variations of one film.
 * @returns {number}
 */
export function similarity(a, b) {
  let sumSq = 0;
  for (const tag of TASTE_TAGS) sumSq += (a.tags[tag] - b.tags[tag]) ** 2;
  return 1 - Math.sqrt(sumSq) / 8; // 8 is the maximum possible distance over four 1-5 axes
}

/**
 * @param {{tags: object, runtime: number}} film
 * @param {{signature: number}} pair the entity-film relationship
 * @param {import('./profile.js').Profile} profile
 * @param {Record<string, {median: number, scale: number}>} stats
 * @param {string} kind
 * @returns {number}
 */
export function fit(film, pair, profile, stats, kind) {
  const { weights } = kindProfile(kind);

  function penalty(tag, tolerance) {
    const absolute = film.tags[tag];
    const over = Math.max(0, absolute - tolerance);
    const under = Math.max(0, tolerance - relative(absolute, stats[tag]));
    return weights[tag] * (over ** 1.5 + 0.25 * under);
  }

  // Humor is a preference rather than a tolerance, so it is two-sided — but not symmetric.
  // Wanting warmth and getting none is a worse miss than getting a laugh you did not ask for.
  const humor = film.tags.humor;
  const humorPenalty =
    weights.humor *
    (0.6 * Math.max(0, profile.prefHumor - humor) ** 1.3 +
      0.15 * Math.max(0, humor - profile.prefHumor));

  const acclaimWeight = profile.mode === 'peak' ? 1.0 : 0.5;

  const rewardSignature = signatureWeight(profile.depth) * (pair.signature - 3);
  const rewardAcclaim = acclaimWeight * (film.tags.acclaim - 0.5) * 5;
  const runtimePenalty = runtimeWeight(profile.depth) * timeCost(film);

  return (
    rewardSignature +
    rewardAcclaim -
    penalty('opacity', profile.tolOpacity) -
    penalty('stillness', profile.tolStillness) -
    penalty('bleakness', profile.tolBleakness) -
    humorPenalty -
    runtimePenalty
  );
}

/**
 * Fitness as someone's first film by this entity. Deliberately a separate calculation from fit:
 * position one is what a visitor judges the entire product on, so it is decided explicitly
 * rather than falling out of a sort. `gateway` appears here and nowhere else — scoring it inside
 * fit as well would double-count it.
 * @returns {number}
 */
export function entryScore(film, pair, profile, targetDifficulty) {
  const curveFit = 1 - Math.abs(difficulty(film) - targetDifficulty);
  // Per-sitting again, for the same reason. Scoring a series on its total run here would make it
  // structurally impossible to open on one, and Twin Peaks was a great many people's actual first
  // encounter with Lynch — which is precisely why it carries gateway 4.
  const perSitting = film.medium === 'series' ? film.runtime / film.episodes : film.runtime;
  const runtimePenalty = clamp((perSitting - 130) / 200, 0, 1);
  return 0.5 * (pair.gateway / 5) + 0.3 * curveFit - 0.2 * runtimePenalty;
}
