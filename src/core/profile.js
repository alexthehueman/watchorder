// Quiz answers in, a scoring profile out — plus the URL encoding that makes a path shareable.
//
// Sharing a path is the growth loop, so decode(encode(p)) must be exact and a mangled URL must
// degrade to the neutral profile rather than throw. A link that 500s is worse than a link that
// shows the default order.
//
// The five questions ask about tolerance and intent, never genre. Genre is what a streaming
// service asks. What actually reorders a filmography is how much confusion someone enjoys, how
// much bleakness they will sit through, and how many films they are realistically going to watch.

const VERSION = 'a';

export const DEPTHS = [3, 6, 12, Infinity];
export const MODES = ['ramp', 'chrono', 'peak'];

// Q3 "how much confusion is fun?" drives opacity and stillness together, deliberately. They
// correlate inside any one filmography, so splitting them across two questions would buy a
// dimension that does not exist and spend a question to do it.
const CONFUSION = [
  { tolOpacity: 2, tolStillness: 2 },
  { tolOpacity: 3, tolStillness: 3 },
  { tolOpacity: 5, tolStillness: 5 },
];

// Q4 is the axis that is not about difficulty, and it is where most of the real spread comes
// from. Comfort wants warmth and low bleakness; confrontation accepts the opposite.
const REGISTER = [
  { tolBleakness: 2, prefHumor: 4 },
  { tolBleakness: 3, prefHumor: 3 },
  { tolBleakness: 5, prefHumor: 2 },
];

export const CONTENT_FLAGS = ['sexual_violence', 'animal_harm', 'child_harm', 'suicide'];

/** @typedef {{depth: number, mode: string, tolOpacity: number, tolStillness: number,
 *             tolBleakness: number, prefHumor: number, blocked: string[], seen: string[]}} Profile */

/** The profile used for the house pick, for a mangled URL, and as the M9 reconstruction target. */
export function neutralProfile() {
  return {
    depth: Infinity,
    mode: 'ramp',
    tolOpacity: 3,
    tolStillness: 3,
    tolBleakness: 3,
    prefHumor: 3,
    blocked: [],
    seen: [],
  };
}

function clampIndex(value, length) {
  const index = Number(value);
  return Number.isInteger(index) && index >= 0 && index < length ? index : -1;
}

/**
 * @param {{depth: number, mode: number, confusion: number, register: number}} answers
 * @param {{blocked?: string[], seen?: string[]}} [extras]
 * @returns {Profile}
 */
export function profileFromAnswers(answers, extras = {}) {
  const base = neutralProfile();
  const depth = clampIndex(answers.depth, DEPTHS.length);
  const mode = clampIndex(answers.mode, MODES.length);
  const confusion = clampIndex(answers.confusion, CONFUSION.length);
  const register = clampIndex(answers.register, REGISTER.length);

  return {
    ...base,
    depth: depth === -1 ? base.depth : DEPTHS[depth],
    mode: mode === -1 ? base.mode : MODES[mode],
    ...(confusion === -1 ? {} : CONFUSION[confusion]),
    ...(register === -1 ? {} : REGISTER[register]),
    blocked: (extras.blocked ?? []).filter((flag) => CONTENT_FLAGS.includes(flag)),
    seen: extras.seen ?? [],
  };
}

/**
 * Someone who has already watched Inland Empire has demonstrated a tolerance for opacity
 * whatever they clicked on question three. Revealed preference outranks stated preference, so
 * the seen set raises tolerances — it never lowers them, because having seen a film is evidence
 * of capacity, not of appetite.
 * @param {Profile} profile
 * @param {Array<{tags: object}>} seenFilms
 * @returns {Profile}
 */
export function inferFromSeen(profile, seenFilms) {
  if (seenFilms.length === 0) return profile;

  function percentile75(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.75));
    return sorted[index];
  }

  const raise = (stated, tag) => Math.max(stated, percentile75(seenFilms.map((f) => f.tags[tag])) - 0.5);

  return {
    ...profile,
    tolOpacity: raise(profile.tolOpacity, 'opacity'),
    tolStillness: raise(profile.tolStillness, 'stillness'),
    tolBleakness: raise(profile.tolBleakness, 'bleakness'),
  };
}

/**
 * `?p=a0213` plus an optional `&s=` base36 bitmask of seen films, indexed against the entity's
 * own film order. The bitmask keeps the URL short and stable — film ids in a query string would
 * be both enormous and fragile against a slug rename.
 * @param {{depth: number, mode: number, confusion: number, register: number}} answers
 * @param {number[]} seenIndices
 * @returns {{p: string, s?: string}}
 */
export function encodeAnswers(answers, seenIndices = [], blocked = []) {
  const digits = [answers.depth, answers.mode, answers.confusion, answers.register]
    .map((value) => (Number.isInteger(value) && value >= 0 && value <= 9 ? value : 0))
    .join('');
  const encoded = { p: VERSION + digits };

  if (seenIndices.length > 0) {
    let mask = 0n;
    for (const index of seenIndices) mask |= 1n << BigInt(index);
    encoded.s = mask.toString(36);
  }

  // Content exclusions travel in the URL as well. A shared link that quietly dropped them would
  // show the recipient exactly what the sender had excluded, which is the same breach of trust
  // the engine refuses to commit internally.
  const flags = blocked.filter((flag) => CONTENT_FLAGS.includes(flag));
  if (flags.length > 0) {
    let mask = 0;
    for (const flag of flags) mask |= 1 << CONTENT_FLAGS.indexOf(flag);
    encoded.c = mask.toString(36);
  }
  return encoded;
}

/**
 * @param {string|null|undefined} p
 * @param {string|null|undefined} s
 * @param {string[]} filmOrder ids in the entity's own order, to resolve the seen bitmask
 * @returns {Profile}
 */
export function decodeProfile(p, s, filmOrder = [], c = null) {
  const blocked = [];
  if (typeof c === 'string' && /^[0-9a-z]+$/.test(c)) {
    const mask = parseInt(c, 36);
    if (Number.isFinite(mask)) {
      CONTENT_FLAGS.forEach((flag, index) => {
        if ((mask >> index) & 1) blocked.push(flag);
      });
    }
  }

  const seen = [];
  if (typeof s === 'string' && /^[0-9a-z]+$/.test(s)) {
    try {
      let mask = BigInt(0);
      for (const character of s) mask = mask * 36n + BigInt(parseInt(character, 36));
      for (let i = 0; i < filmOrder.length; i += 1) {
        if ((mask >> BigInt(i)) & 1n) seen.push(filmOrder[i]);
      }
    } catch {
      // A malformed mask means we simply know of nothing seen. Never fatal.
    }
  }

  if (typeof p !== 'string' || p[0] !== VERSION || !/^[0-9]{4}$/.test(p.slice(1))) {
    return { ...neutralProfile(), seen, blocked };
  }
  const [depth, mode, confusion, register] = [...p.slice(1)].map(Number);
  return profileFromAnswers({ depth, mode, confusion, register }, { seen, blocked });
}

/**
 * The answer indices that produced a profile, for restoring the form from a URL.
 * @param {Profile} profile
 * @returns {{depth: number, mode: number, confusion: number, register: number}}
 */
export function answersFromProfile(profile) {
  const confusion = CONFUSION.findIndex((option) => option.tolOpacity === profile.tolOpacity);
  const register = REGISTER.findIndex((option) => option.tolBleakness === profile.tolBleakness);
  return {
    depth: Math.max(0, DEPTHS.indexOf(profile.depth)),
    mode: Math.max(0, MODES.indexOf(profile.mode)),
    confusion: confusion === -1 ? 1 : confusion,
    register: register === -1 ? 1 : register,
  };
}
