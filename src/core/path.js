// The one public entry point. buildPath(entity, profile) -> an ordered, annotated path.
//
// This file is imported unchanged by build.js under Node, to render the crawlable house pick, and
// by the browser after someone finishes the quiz. That is why nothing in src/core touches the
// filesystem, the DOM, or a dependency — see test/structure.test.js, which enforces it.
//
// The pipeline is P0-P8 from the plan. The invariant worth stating loudly: after selection,
// NOTHING is added to or removed from the list. P6 permutes, P7 annotates, P8 checks. Every
// constraint that can change membership has already run.

import { kindProfile, resolveMode } from './kinds.js';
import { inferFromSeen, CONTENT_FLAGS } from './profile.js';
import { entityStats, fit, difficulty, entryScore, slotCost } from './score.js';
import { selectFilms } from './select.js';
import { sequenceFilms, targetCurve } from './sequence.js';

/**
 * Content severity sliders are blocked at 3; the boolean triggers are blocked outright. The
 * booleans are the ones where a false negative harms a real person, so they are never soft.
 * @returns {string|null} the flag that blocks this film, or null
 */
function blockingFlag(film, blocked) {
  for (const flag of blocked) {
    if (CONTENT_FLAGS.includes(flag) && film.content[flag] === true) return flag;
    if (!CONTENT_FLAGS.includes(flag) && film.content[flag] >= 3) return flag;
  }
  return null;
}

/**
 * @param {object} entity parsed entity YAML
 * @param {Map<string, object>} filmsById
 * @param {import('./profile.js').Profile} rawProfile
 * @returns {{status: string, reason: string|null, films: Array<object>, seenAnchors: Array<object>}}
 */
export function buildPath(entity, filmsById, rawProfile) {
  const kind = kindProfile(entity.kind);
  if (!kind.ready) {
    return { status: 'unsupported_kind', reason: `${entity.kind} paths are not ready`, films: [], seenAnchors: [] };
  }

  const pairs = entity.films ?? [];
  const allFilms = pairs.map((pair) => filmsById.get(pair.film));

  // P0 — resolve. Revealed preference from the seen set outranks the stated answers.
  const seen = new Set(rawProfile.seen ?? []);
  const seenFilms = allFilms.filter((film) => seen.has(film.id));
  // The quiz encodes an answer index, not a mode name, so the same index means different things
  // for different kinds — "watch them develop" is a real question about a director and close to
  // meaningless about an actor. resolveMode does that translation.
  const profile = {
    ...inferFromSeen(rawProfile, seenFilms),
    mode: resolveMode(entity.kind, rawProfile.mode),
  };
  const stats = entityStats(allFilms);

  const prereqs = new Map();
  for (const edge of entity.prereqs ?? []) {
    if (!prereqs.has(edge.film)) prereqs.set(edge.film, []);
    prereqs.get(edge.film).push({ requires: edge.requires, strength: edge.strength });
  }

  // P1 — eligibility. Blocked films are MARKED, never deleted: prerequisite resolution still
  // has to be able to see them in order to refuse to inject them.
  const blockedIds = new Set();
  for (const pair of pairs) {
    const film = filmsById.get(pair.film);
    if (blockingFlag(film, profile.blocked ?? [])) blockedIds.add(film.id);
  }

  // P2/P3 — score, then resolve prerequisites against the content filter.
  //
  // A hard prerequisite that is blocked drops the dependent film. It is never injected. Injecting
  // it would hand someone precisely the content they asked not to see, which is a breach of trust
  // rather than a ranking mistake, and no amount of downstream cleverness makes it acceptable.
  //
  // Signature-1 credits are noise: work the entity is only incidentally attached to — a for-hire
  // job they disowned, an actor's four-minute cameo. They belong in the filmography and nowhere
  // near a recommended path.
  //
  // Without this floor the taste penalties bury the difficult masterpieces deep enough that an
  // inoffensive dud outscores them: at neutral tolerance Eraserhead carries about 8.4 in penalty
  // against 2.1 of signature reward, so Dune wins on being merely unobjectionable. Recommending
  // Dune over Eraserhead to someone asking where to start with Lynch is the kind of output that
  // ends a cinephile site's credibility on its first visit.
  //
  // The floor is flat, never scaled by depth. Gating on signature AND then taking the top N
  // truncates twice on the same axis and quietly collapses everyone onto the same canon. The one
  // exception is the completist, who asked for the whole filmography and should get the duds too.
  const wantsEverything = !Number.isFinite(rawProfile.depth);

  const softWarnings = new Map();
  const candidates = [];
  for (const pair of pairs) {
    const film = filmsById.get(pair.film);
    if (blockedIds.has(film.id) || seen.has(film.id)) continue;
    if (pair.signature <= 1 && !wantsEverything) continue;
    // A cameo is noise for the same reason a signature-1 credit is: someone who asked where to
    // start with an actor is not asking to watch a film that actor is in for four minutes. The
    // scoring penalty alone is not a guarantee, and this needs to be one.
    if (pair.role_size === 'cameo' && !wantsEverything) continue;

    let droppedByPrereq = false;
    for (const edge of prereqs.get(film.id) ?? []) {
      const requiredBlocked = blockedIds.has(edge.requires);
      if (edge.strength === 'hard' && requiredBlocked && !seen.has(edge.requires)) {
        droppedByPrereq = true;
      } else if (edge.strength === 'soft' && requiredBlocked) {
        const required = filmsById.get(edge.requires);
        softWarnings.set(film.id, `Builds on ${required.title}, which your content settings exclude.`);
      }
    }
    if (droppedByPrereq) continue;

    candidates.push({ film, pair, fit: fit(film, pair, profile, stats, entity.kind) });
  }

  if (candidates.length === 0) {
    return {
      status: 'no_path',
      reason: 'Your content settings exclude everything in this filmography.',
      films: [],
      seenAnchors: [],
    };
  }

  // P4 — constrained selection. All hard constraints are enforced here, not repaired later.
  //
  // Budget is measured in slots, so the unlimited case has to total the slots rather than count
  // the titles — otherwise a filmography containing series would silently truncate itself for the
  // one viewer who explicitly asked to see all of it.
  const totalSlots = candidates.reduce((sum, entry) => sum + slotCost(entry.film), 0);
  const budget = Number.isFinite(profile.depth) ? Math.min(profile.depth, totalSlots) : totalSlots;
  const { selected, reason } = selectFilms(candidates, {
    budget,
    prereqs,
    seen,
    diversityDelta: kind.diversityDelta,
  });

  if (selected.length === 0) {
    return { status: 'no_path', reason: reason ?? 'No path could be built.', films: [], seenAnchors: [] };
  }

  // P5 — the opener, decided explicitly. It is what a visitor judges the product on.
  const curve = targetCurve(profile);
  const legalOpeners = selected.filter((entry) => entry.pair.gateway > 0);
  const opener = legalOpeners
    .map((entry) => ({ entry, score: entryScore(entry.film, entry.pair, profile, curve(0)) }))
    .sort((a, b) => b.score - a.score || (a.entry.film.id < b.entry.film.id ? -1 : 1))[0];

  // P6 — sequence. Permutation only.
  const ordered = sequenceFilms(selected, {
    profile,
    prereqs,
    opener: opener ? opener.entry.film.id : null,
  });

  // P7 — annotate.
  const films = ordered.map((entry, index) => ({
    ...entry,
    position: index + 1,
    note: entry.pair.note ?? null,
    warning: softWarnings.get(entry.film.id) ?? null,
    why: whyHere(entry, index, ordered, profile, curve, prereqs),
  }));

  const seenAnchors = allFilms
    .filter((film) => seen.has(film.id))
    .map((film) => ({ film, pair: pairs.find((pair) => pair.film === film.id) }));

  // P8 — validate. A failure here is the caller's cue to serve the house pick instead.
  const problems = validatePath(films, { profile, prereqs, blockedIds, budget });
  if (problems.length > 0) {
    return { status: 'invalid', reason: problems.join('; '), films, seenAnchors };
  }

  return { status: 'ok', reason: null, films, seenAnchors };
}

/**
 * The line the competitor structurally cannot write. Their blurb is fixed per film, so it can
 * describe the work but never account for its position. This one is computed from where the film
 * actually landed in *this* path.
 *
 * It has to be mode-aware. Describing a difficulty curve in peak mode would be describing
 * something that did not happen — peak order is driven by acclaim, and inventing a rationale
 * after the fact is how a site stops being trusted.
 *
 * The prerequisite case is checked first and deliberately. In peak mode a film with a hard
 * prerequisite gets pushed below something less acclaimed, so a viewer who asked for "best
 * first" sees position four outrank position three and reasonably concludes the ordering is
 * broken. Saying plainly why it moved is the difference between a visible bug and a visible
 * judgement.
 */
function whyHere(entry, index, ordered, profile, curve, prereqs) {
  const total = ordered.length;
  const placed = new Map(ordered.slice(0, index).map((other) => [other.film.id, other.film]));

  const gate = (prereqs.get(entry.film.id) ?? [])
    .filter((edge) => edge.strength === 'hard' && placed.has(edge.requires))
    .map((edge) => placed.get(edge.requires))[0];
  if (gate) return `Held until after ${gate.title} — it assumes it.`;

  if (index === 0) {
    if (profile.mode === 'peak') return 'Placed first — the high point, taken head on.';
    if (profile.mode === 'chrono') return 'Where it starts.';
    if (profile.mode === 'range') return 'Placed first — the widest thing they do.';
    // Generated copy never assumes a pronoun. The engine does not know one — entities carry a
    // name and nothing else — and guessing produces "the cleanest way into his work" on the
    // Agnès Varda page, which is how this was found.
    return entry.pair.gateway >= 4
      ? 'Placed first — the cleanest way into this work.'
      : 'Placed first — the gentlest thing here that still sounds like them.';
  }

  if (profile.mode === 'chrono') {
    const gap = entry.film.year - ordered[index - 1].film.year;
    if (gap >= 5) return `${gap} years on.`;
    return null; // The year is on the card; repeating it in prose adds nothing.
  }
  if (profile.mode === 'peak') return null;

  if (profile.mode === 'range') {
    const previous = ordered[index - 1];
    if (previous?.pair.register && previous.pair.register !== entry.pair.register) {
      return `A hard turn from ${previous.pair.register} to ${entry.pair.register}.`;
    }
    return entry.pair.against_type ? 'Cast against everything they are known for.' : null;
  }

  const t = total <= 1 ? 0 : index / (total - 1);
  const gap = difficulty(entry.film) - curve(t);
  if (index === total - 1) {
    return gap > 0.1
      ? 'Saved for last — it asks the most, and lands hardest here.'
      : 'A closing note rather than a climax.';
  }
  if (gap > 0.15) return 'A step up — it assumes what came before it.';
  if (gap < -0.15) return 'Placed here as relief, deliberately.';
  return 'Sits comfortably where the path has got to.';
}

/**
 * @returns {string[]} problems, empty when the path is sound
 */
function validatePath(films, { prereqs, blockedIds, budget }) {
  const problems = [];
  const positions = new Map(films.map((entry, index) => [entry.film.id, index]));

  if (Number.isFinite(budget) && films.length > budget) {
    problems.push(`path is ${films.length} films but the budget was ${budget}`);
  }
  for (const entry of films) {
    if (blockedIds.has(entry.film.id)) problems.push(`${entry.film.id} is content-blocked`);
  }
  if (films.length > 0 && films[0].pair.gateway === 0) {
    problems.push(`opens on ${films[0].film.id}, which has gateway 0`);
  }
  for (const entry of films) {
    for (const edge of prereqs.get(entry.film.id) ?? []) {
      if (edge.strength !== 'hard') continue;
      if (!positions.has(edge.requires)) continue;
      if (positions.get(edge.requires) > positions.get(entry.film.id)) {
        problems.push(`${entry.film.id} precedes its hard prereq ${edge.requires}`);
      }
    }
  }
  return problems;
}
