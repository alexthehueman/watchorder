// Chooses WHICH films are in the path. Every hard constraint lives here, and that placement is
// the single most important structural decision in the engine.
//
// The obvious pipeline — score, take the top N, sort them, then fix up anything illegal — is
// wrong in a way that is hard to see and easy to ship. Fixing up afterwards means evicting a film
// from a list whose length is already promised, injecting a prerequisite the content filter had
// excluded, or discovering that every film chosen is one that must never open a path. Each of
// those is a bug with no good repair at that point, because the set is already frozen.
//
// So selection is constrained rather than corrected. A film is never added without its hard
// prerequisites, prerequisites consume budget like anything else, and a set that cannot legally
// open is never formed. Downstream, sequence.js only permutes: nothing enters or leaves the list
// after this file returns.

import { similarity, slotCost } from './score.js';

/**
 * Transitive hard prerequisites of a film that are not already satisfied.
 * @param {string} filmId
 * @param {Map<string, Array<{requires: string, strength: string}>>} prereqs
 * @param {Set<string>} satisfied ids already seen by the viewer or already selected
 * @returns {string[]}
 */
export function hardClosure(filmId, prereqs, satisfied) {
  const needed = [];
  const stack = [filmId];
  const visited = new Set([filmId]);

  while (stack.length > 0) {
    const current = stack.pop();
    for (const edge of prereqs.get(current) ?? []) {
      if (edge.strength !== 'hard') continue;
      if (satisfied.has(edge.requires) || visited.has(edge.requires)) continue;
      visited.add(edge.requires);
      needed.push(edge.requires);
      stack.push(edge.requires);
    }
  }
  return needed;
}

/**
 * Deterministic ordering. Integer tags tie constantly, and an unstable tiebreak would mean the
 * same shared URL renders a different path on a refresh — fatal for a product whose growth loop
 * is people passing their path around.
 */
function compareCandidates(a, b) {
  if (b.value !== a.value) return b.value - a.value;
  if (b.pair.signature !== a.pair.signature) return b.pair.signature - a.pair.signature;
  if (b.film.tags.acclaim !== a.film.tags.acclaim) return b.film.tags.acclaim - a.film.tags.acclaim;
  if (a.film.year !== b.film.year) return a.film.year - b.film.year;
  return a.film.id < b.film.id ? -1 : 1;
}

/**
 * @param {Array<{film: object, pair: object, fit: number}>} candidates eligible, unseen films
 * @param {object} options
 * @param {number} options.budget
 * @param {Map<string, Array<{requires: string, strength: string}>>} options.prereqs
 * @param {Set<string>} options.seen
 * @param {number} options.diversityDelta
 * @returns {{selected: Array<{film: object, pair: object, fit: number}>, reason: string|null}}
 */
export function selectFilms(candidates, options) {
  const { budget, prereqs, seen, diversityDelta } = options;
  const byId = new Map(candidates.map((entry) => [entry.film.id, entry]));

  const selected = [];
  const chosen = new Set();
  const satisfied = new Set(seen);
  // Budget is counted in slots rather than titles, because a series is several films' worth of
  // someone's evening. See slotCost in score.js.
  let spent = 0;

  function marginalValue(entry) {
    if (selected.length === 0) return entry.fit;
    let closest = 0;
    for (const already of selected) {
      closest = Math.max(closest, similarity(entry.film, already.film));
    }
    return entry.fit - diversityDelta * closest;
  }

  /** Adding a film means adding everything it hard-requires, so cost is closure size. */
  function closureFor(entry) {
    const needed = hardClosure(entry.film.id, prereqs, new Set([...satisfied, ...chosen]));
    // A prerequisite outside the candidate pool was filtered out upstream — blocked on content,
    // most likely. The dependent film cannot be taken at all.
    if (needed.some((id) => !byId.has(id))) return null;
    return needed;
  }

  while (spent < budget) {
    let best = null;
    let bestClosure = null;

    for (const entry of candidates) {
      if (chosen.has(entry.film.id)) continue;
      const closure = closureFor(entry);
      if (closure === null) continue;
      const cost =
        slotCost(entry.film) +
        closure.reduce((sum, id) => sum + slotCost(byId.get(id).film), 0);
      if (spent + cost > budget) continue;

      // The closure is valued as a unit: a film worth taking can carry a weak prerequisite.
      let value = marginalValue(entry);
      for (const id of closure) value += marginalValue(byId.get(id));
      const scored = { ...entry, value };

      if (best === null || compareCandidates(scored, best) < 0) {
        best = scored;
        bestClosure = closure;
      }
    }

    if (best === null) break;

    // Prerequisites first — they are prerequisites.
    for (const id of bestClosure) {
      const entry = byId.get(id);
      selected.push(entry);
      chosen.add(id);
      satisfied.add(id);
      spent += slotCost(entry.film);
    }
    selected.push(byId.get(best.film.id));
    chosen.add(best.film.id);
    satisfied.add(best.film.id);
    spent += slotCost(best.film);
  }

  if (selected.length === 0) {
    return { selected: [], reason: 'no eligible films remain' };
  }

  // A path with nothing legal to open on is not a path. Trade the weakest selection for the best
  // available opener rather than returning something that cannot be presented.
  if (!selected.some((entry) => entry.pair.gateway > 0)) {
    const opener = candidates
      .filter((entry) => entry.pair.gateway > 0 && !chosen.has(entry.film.id))
      .filter((entry) => (closureFor(entry) ?? []).length === 0)
      .sort(compareCandidates)[0];

    if (!opener) {
      return { selected: [], reason: 'no film here can legally open a path' };
    }
    // Drop the lowest-value film that nothing else depends on.
    const droppable = [...selected]
      .reverse()
      .find((entry) => !selected.some((other) => (prereqs.get(other.film.id) ?? []).some(
        (edge) => edge.strength === 'hard' && edge.requires === entry.film.id,
      )));
    if (droppable) {
      selected.splice(selected.indexOf(droppable), 1);
      chosen.delete(droppable.film.id);
    }
    selected.push(opener);
    chosen.add(opener.film.id);
  }

  return { selected, reason: null };
}
