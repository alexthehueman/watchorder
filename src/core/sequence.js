// Puts the selected films in order. Membership is frozen before this file runs and nothing here
// adds or removes anything — this stage only permutes.
//
// The bug this file was written to avoid: sorting by a column. Sort by year, by acclaim, or by
// how gentle a film is, and the profile has not been consulted at all — it only picked which of
// three canned sorts to run. Two viewers who disagree about every taste question but agree on
// depth and mode would receive byte-identical lists, and the personalisation would be theatre.
//
// Instead the profile defines a target difficulty CURVE — where it starts, how steeply it climbs,
// where it peaks — and ordering minimises deviation from that curve. A cautious viewer and a
// seasoned one get differently shaped curves and therefore genuinely different permutations of
// the same set, continuously rather than in three discrete flavours.

import { difficulty } from './score.js';

/**
 * The shape a viewing path should trace. Start where the viewer is comfortable, climb to
 * somewhat past it, and ease off at the very end so a path resolves rather than merely stopping.
 * Both the start and the peak scale with tolerance, which is what makes the curve profile-driven.
 * @param {import('./profile.js').Profile} profile
 * @returns {(t: number) => number}
 */
export function targetCurve(profile) {
  const normalised = (profile.tolOpacity - 1) / 4;
  const start = 0.15 + 0.35 * normalised;
  const peak = Math.min(1, 0.45 + 0.5 * normalised);
  const peakAt = 0.85;
  // How far the path eases off at the end. A cautious viewer wants to come back down; someone
  // who asked for confrontation does not want the hardest thing they will see to be third-last.
  const resolve = 0.3 * (1 - normalised);

  return function target(t) {
    if (t <= peakAt) return start + (peak - start) * (t / peakAt);
    return peak - (peak - start) * resolve * ((t - peakAt) / (1 - peakAt));
  };
}

/**
 * Normalised 0-1 rank of each film on the axis the chosen mode cares about. Lower is earlier.
 * @param {Array<{film: object}>} entries
 * @param {string} mode
 * @returns {Map<string, number>}
 */
function modeKeys(entries, mode) {
  const keys = new Map();
  if (entries.length <= 1) {
    for (const entry of entries) keys.set(entry.film.id, 0);
    return keys;
  }
  const sorted = [...entries].sort((a, b) => {
    if (mode === 'chrono') return a.film.year - b.film.year;
    if (mode === 'peak') return b.film.tags.acclaim - a.film.tags.acclaim;
    // Lead the range tour with the strongest showcase, so the first thing seen is the performance
    // that best answers "what can they actually do".
    if (mode === 'range') return (b.pair.showcase ?? 3) - (a.pair.showcase ?? 3);
    return 0;
  });
  sorted.forEach((entry, index) => keys.set(entry.film.id, index / (sorted.length - 1)));
  return keys;
}

// How much the curve matters against the mode's own axis.
//
// In ramp the curve is the whole point. In chrono and peak it must barely matter at all: mode
// keys are normalised ranks, so on a twelve-film path adjacent years sit only 1/11 = 0.09 apart,
// and a curve weight of 0.25 would happily reorder them. Someone who asked to watch a director
// develop would then get a shuffled list — which is not a subtler answer to their question, it
// is the wrong answer. At 0.02 the curve can only ever separate an exact tie.
//
// This is not the "canned sort" failure the curve exists to prevent. In these two modes the
// profile still fully determines *which* films are selected; the viewer has simply named the
// axis they want those films ordered on, and we owe them that axis.
const MODE_WEIGHTS = {
  ramp: { curve: 1.0, mode: 0.0 },
  chrono: { curve: 0.02, mode: 1.0 },
  peak: { curve: 0.02, mode: 1.0 },
  // `range` is an actor mode and it is about contrast between neighbours rather than any fixed
  // column, so most of its work happens in the adjacency penalty below rather than in a sort key.
  range: { curve: 0.15, mode: 0.35 },
};

// How much a film is penalised in `range` mode for repeating the register of the film before it.
// Large enough to dominate small score differences, because two identical performances back to
// back is exactly what someone asking to see an actor's range did not want.
const REPEAT_REGISTER_PENALTY = 0.6;

/**
 * Kahn's algorithm with a priority queue, rather than a generic topological sort.
 *
 * A dependency graph has many valid linearisations and a generic topological sort returns an
 * arbitrary one — which would silently discard the requested order. Choosing greedily by
 * position cost at each step instead yields the legal linearisation closest to what the profile
 * actually asked for.
 *
 * @param {Array<{film: object, pair: object}>} entries
 * @param {object} options
 * @param {import('./profile.js').Profile} options.profile
 * @param {Map<string, Array<{requires: string, strength: string}>>} options.prereqs
 * @param {string|null} options.opener film id to force into position one
 * @returns {Array<{film: object, pair: object}>}
 */
export function sequenceFilms(entries, options) {
  const { profile, prereqs, opener } = options;
  const weights = MODE_WEIGHTS[profile.mode] ?? MODE_WEIGHTS.ramp;
  const curve = targetCurve(profile);
  const keys = modeKeys(entries, profile.mode);
  const present = new Set(entries.map((entry) => entry.film.id));

  // Only edges whose prerequisite is actually in this path can constrain it.
  const outstanding = new Map();
  for (const entry of entries) {
    const required = (prereqs.get(entry.film.id) ?? [])
      .filter((edge) => edge.strength === 'hard' && present.has(edge.requires))
      .map((edge) => edge.requires);
    outstanding.set(entry.film.id, new Set(required));
  }

  const remaining = new Map(entries.map((entry) => [entry.film.id, entry]));
  const ordered = [];
  const total = entries.length;

  function place(entry) {
    ordered.push(entry);
    remaining.delete(entry.film.id);
    for (const pending of outstanding.values()) pending.delete(entry.film.id);
  }

  // The explicitly chosen opener leads only in ramp, where no other axis was requested. In
  // chrono and peak, honouring it would override the very ordering the viewer asked for — so
  // there, position one is simply the first legal film on their chosen axis.
  if (profile.mode === 'ramp' && opener && remaining.has(opener) && outstanding.get(opener).size === 0) {
    place(remaining.get(opener));
  }

  while (remaining.size > 0) {
    const t = total <= 1 ? 0 : ordered.length / (total - 1);
    const target = curve(t);
    // "Never open on a gateway-0 film" is universal, so it is enforced here for every mode
    // rather than relying on the opener having been forced in.
    const openingSlot = ordered.length === 0;

    let best = null;
    let bestCost = Infinity;
    for (const entry of remaining.values()) {
      if (outstanding.get(entry.film.id).size > 0) continue;
      if (openingSlot && entry.pair.gateway === 0) continue;
      const previous = ordered[ordered.length - 1];
      const repeatsRegister =
        profile.mode === 'range' &&
        previous &&
        previous.pair.register &&
        previous.pair.register === entry.pair.register;

      const cost =
        weights.curve * Math.abs(difficulty(entry.film) - target) +
        weights.mode * keys.get(entry.film.id) +
        (repeatsRegister ? REPEAT_REGISTER_PENALTY : 0);

      // Deterministic: ties fall to acclaim, then year, then id. Never to insertion order.
      if (
        cost < bestCost - 1e-9 ||
        (Math.abs(cost - bestCost) <= 1e-9 &&
          best !== null &&
          (entry.film.tags.acclaim > best.film.tags.acclaim ||
            (entry.film.tags.acclaim === best.film.tags.acclaim &&
              (entry.film.year < best.film.year ||
                (entry.film.year === best.film.year && entry.film.id < best.film.id)))))
      ) {
        best = entry;
        bestCost = cost;
      }
    }

    // A gateway-0 film can be the root of every prerequisite chain in the set, in which case
    // nothing legal is available to open and the filter above deadlocks. Opening on a weak film
    // is a worse path; returning no path at all is not a path. So the rule relaxes, and the
    // caller's P8 check reports it.
    if (best === null && openingSlot) {
      for (const entry of remaining.values()) {
        if (outstanding.get(entry.film.id).size > 0) continue;
        if (best === null || entry.pair.gateway > best.pair.gateway) best = entry;
      }
    }

    // Unreachable on a validated corpus — every cycle is rejected by tools/validate.mjs — but
    // returning a partial order beats looping forever if a cycle ever slips through.
    if (best === null) break;
    place(best);
  }

  return ordered;
}
