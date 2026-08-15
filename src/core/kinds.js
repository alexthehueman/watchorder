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
    ready: true,
    // No chrono. For a director, release order is artistic development; for an actor it is mostly
    // the order other people happened to hire them, which is not a viewing principle. `range`
    // takes its place — the axis that actually matters here is how far the performances travel.
    modes: ['range', 'peak', 'ramp'],
    // Taste weights are lower across the board because the film's qualities are less of the
    // reason someone is here. The formalism of Mandy is not why anyone watches Cage.
    weights: { opacity: 1.1, stillness: 0.9, bleakness: 0.9, humor: 1.3 },
    // A far harder diversity push than directors get. An actor's filmography clusters hard
    // around whatever they were typecast into, and without this every path is ten variations of
    // the same performance.
    diversityDelta: 1.2,
    chronoIsMeaningful: false,
    // The quiz encodes an answer INDEX, so index 1 must stay index 1 in a shared URL whatever the
    // entity kind. Rather than fork the wire format, the middle ordering option keeps its slot and
    // changes meaning: "watch them develop" is a real question about a director and close to
    // meaningless about an actor, where release order is mostly the order other people hired them.
    modeAliases: { chrono: 'range' },
  },

  studio: {
    ready: true,
    // `era` rather than `chrono`. A studio's output across decades is not development, it is
    // several different companies wearing one name — Cannon in 1980 and Cannon in 1987 shared a
    // logo and almost nothing else. Sorting sixty years by release date is a random walk.
    modes: ['era', 'peak', 'ramp'],
    weights: { opacity: 1.2, stillness: 1.0, bleakness: 0.9, humor: 1.2 },
    // The hardest diversity push of the three kinds. A studio catalogue clusters harder than
    // anything else here, because the whole point of a studio is a house style.
    diversityDelta: 1.4,
    chronoIsMeaningful: false,
    modeAliases: { chrono: 'era' },
    // Without this, Ghibli returns eight Miyazaki films and A24 returns Ari Aster twice in six.
    // A studio path that is really one director's path has answered the wrong question.
    quotas: { perDirector: 2 },
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

/**
 * The ordering mode this kind will actually run, given what the quiz asked for.
 * @param {string} kind
 * @param {string} requested
 * @returns {string}
 */
export function resolveMode(kind, requested) {
  const profile = kindProfile(kind);
  if (profile.modes.includes(requested)) return requested;
  return profile.modeAliases?.[requested] ?? profile.modes[0];
}
