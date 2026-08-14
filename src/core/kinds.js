// Per-entity-kind configuration, kept as data rather than as branches in the pipeline.
//
// Directors, actors and studios need different weights, different ordering modes and different
// composition rules, but roughly 85% of the pipeline is genuinely identical across them. Three
// code paths would triplicate the constraint logic — which is the part that must never diverge,
// because that is where the content filters live. So the pipeline stays single and the
// differences live here.
//
// Only `director` is real today. Actor and studio are declared so the shape is fixed and the
// pipeline can already refuse to run against a kind whose data model is not ready — see the
// `ready` flag. Actors additionally need role_size/register on the pair, and studios need an era
// concept; neither exists yet, and shipping them on the director model produces output a
// cinephile audience correctly reads as unserious.

/** @typedef {{opacity: number, stillness: number, bleakness: number, humor: number}} TagWeights */

export const KINDS = {
  director: {
    ready: true,
    modes: ['chrono', 'peak', 'ramp'],
    // opacity carries the most weight because it is the axis viewers actually bounce off.
    weights: { opacity: 1.6, stillness: 1.3, bleakness: 0.9, humor: 1.1 },
    // How hard to push apart films that feel alike. Studios need far more of this than
    // directors, because a studio's catalogue clusters much harder.
    diversityDelta: 0.8,
    // Chronology means artistic development for a director, so it is worth weighting.
    chronoIsMeaningful: true,
  },

  actor: {
    ready: false,
    modes: ['range', 'peak', 'ramp'],
    weights: { opacity: 1.1, stillness: 0.9, bleakness: 0.9, humor: 1.3 },
    diversityDelta: 1.2,
    chronoIsMeaningful: false,
  },

  studio: {
    ready: false,
    modes: ['era', 'peak', 'ramp'],
    weights: { opacity: 1.2, stillness: 1.0, bleakness: 0.9, humor: 1.2 },
    diversityDelta: 1.4,
    chronoIsMeaningful: false,
  },
};

/**
 * @param {string} kind
 * @returns {typeof KINDS.director}
 */
export function kindProfile(kind) {
  const profile = KINDS[kind];
  if (!profile) throw new Error(`unknown entity kind: ${kind}`);
  return profile;
}
