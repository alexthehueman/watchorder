// The corpus is hand-authored YAML, so typos are the failure mode that matters most — a
// misspelled film id in a curated order is invisible until a page renders short, and a cycle in
// the prereq graph is an infinite loop in production rather than a wrong answer.
//
// Everything here is checked at build time and in CI, never at runtime. The engine is allowed to
// assume a valid corpus precisely because this file refuses to let an invalid one through.
//
// Exports loadCorpus/validateCorpus for test/data.test.js; runs as a CLI via `npm run validate`.

import { readdir, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { parse } from 'yaml';

const DATA_DIR = new URL('../src/data/', import.meta.url);
const ENTITY_DIR = new URL('entities/', DATA_DIR);
// Films are split across files purely so they stay editable by hand — ids remain global, and a
// film can be referenced by any entity regardless of which file it happens to live in. Duplicate
// ids across files are caught below, which is what keeps the split from becoming a trap.
const FILM_DIR = new URL('films/', DATA_DIR);

const TASTE_TAGS = ['opacity', 'stillness', 'bleakness', 'humor'];
const CONTENT_BOOLEANS = ['sexual_violence', 'animal_harm', 'child_harm', 'suicide'];
const CONTENT_SEVERITIES = ['violence', 'sex'];
const ENTITY_KINDS = ['director', 'actor', 'studio'];
const MEDIA = ['film', 'series'];
// The shortest non-completist depth the quiz offers. A must-see is pinned "no matter what", and
// the engine reserves one slot of the budget for the algorithm rather than letting pins consume
// it entirely — so an entity declaring more must-sees than this can hold, minus that reservation,
// would silently break its own promise the first time someone asked for a short path. Caught here
// rather than discovered empirically, the way the original three-per-entity tagging was.
const MIN_DEPTH = 3;

// Actor-only relationship fields.
//
// role_size is the one that cannot be skipped. Without it the engine will confidently recommend a
// film in which the actor appears for four minutes, which is the fastest way to lose a viewer who
// came here because they trusted the list.
const ROLE_SIZES = ['lead', 'supporting', 'cameo'];
// The tonal register of the performance, not of the film. It is what the `range` mode maximises
// diversity across, and it is why an actor path can be interesting where a difficulty axis alone
// would flatten it.
const REGISTERS = ['restrained', 'unhinged', 'comic', 'menacing', 'warm'];

/**
 * @returns {Promise<{films: object[], entities: object[]}>}
 */
export async function loadCorpus() {
  const films = [];
  const filmFiles = (await readdir(FILM_DIR)).filter((name) => name.endsWith('.yaml')).sort();
  for (const name of filmFiles) {
    const parsed = parse(await readFile(new URL(name, FILM_DIR), 'utf8')) ?? [];
    for (const film of parsed) films.push({ ...film, sourceFile: `films/${name}` });
  }

  const entries = (await readdir(ENTITY_DIR)).filter((name) => name.endsWith('.yaml')).sort();
  const entities = [];
  for (const name of entries) {
    const entity = parse(await readFile(new URL(name, ENTITY_DIR), 'utf8'));
    entities.push({ ...entity, sourceFile: name });
  }
  return { films, entities };
}

function isInteger(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max;
}

/**
 * Depth-first cycle detection over an entity's prereq edges. A hand-authored prereq table will
 * eventually contain two films that "benefit from" each other; that is a cycle, and a cycle is
 * an infinite loop in the sequencing stage rather than a merely wrong order.
 * @param {Array<{film: string, requires: string}>} prereqs
 * @returns {string[]|null} the cycle path, or null if the graph is acyclic
 */
function findCycle(prereqs) {
  const edges = new Map();
  for (const edge of prereqs) {
    if (!edges.has(edge.film)) edges.set(edge.film, []);
    edges.get(edge.film).push(edge.requires);
  }
  const VISITING = 1;
  const DONE = 2;
  const state = new Map();
  const stack = [];

  function walk(node) {
    if (state.get(node) === DONE) return null;
    if (state.get(node) === VISITING) return [...stack.slice(stack.indexOf(node)), node];
    state.set(node, VISITING);
    stack.push(node);
    for (const next of edges.get(node) ?? []) {
      const cycle = walk(next);
      if (cycle) return cycle;
    }
    stack.pop();
    state.set(node, DONE);
    return null;
  }

  for (const node of edges.keys()) {
    const cycle = walk(node);
    if (cycle) return cycle;
  }
  return null;
}

/**
 * @param {{films: object[], entities: object[]}} corpus
 * @returns {{errors: string[], warnings: string[]}}
 */
export function validateCorpus(corpus) {
  const errors = [];
  const warnings = [];
  const filmsById = new Map();

  for (const film of corpus.films) {
    const where = `${film.sourceFile}: ${film.id ?? '(missing id)'}`;
    if (!film.id) {
      errors.push(`${where} — every film needs an id`);
      continue;
    }
    if (filmsById.has(film.id)) {
      // Naming both files matters: with the corpus split, a duplicate id is most likely the same
      // film added twice by two different people, and the fix depends on which copy is better.
      errors.push(
        `${where} — duplicate film id, already defined in ${filmsById.get(film.id).sourceFile}`,
      );
    }
    filmsById.set(film.id, film);

    if (typeof film.title !== 'string' || !film.title) errors.push(`${where} — missing title`);
    if (!isInteger(film.year, 1878, 2100)) errors.push(`${where} — implausible year: ${film.year}`);
    if (!isInteger(film.runtime, 1, 10000)) {
      errors.push(`${where} — implausible runtime: ${film.runtime}`);
    }
    // Defaults to film. Series resolve against a different TMDB endpoint, and their runtime is
    // the whole run — which is why the runtime penalty correctly buries them at low depth.
    if (film.medium !== undefined && !MEDIA.includes(film.medium)) {
      errors.push(`${where} — medium must be one of ${MEDIA.join(', ')}, got ${film.medium}`);
    }
    // Endurance is scored per episode, so a series without an episode count would be divided by
    // undefined and score NaN — which propagates silently through every comparison downstream.
    if (film.medium === 'series' && !isInteger(film.episodes, 1, 1000)) {
      errors.push(`${where} — a series needs an episodes count, got ${film.episodes}`);
    }
    if (film.medium !== 'series' && film.episodes !== undefined) {
      errors.push(`${where} — episodes only applies to a series`);
    }
    if (film.tmdb_id === null || film.tmdb_id === undefined) {
      warnings.push(`${where} — tmdb_id not yet resolved; run \`npm run ingest\``);
    }
    // Both optional and independent of tmdb_id — OMDb is the ingest path that actually works
    // while a TMDB key is pending. Not warned on when absent the way tmdb_id is: unlike tmdb_id,
    // which every film is expected to eventually carry, these are opportunistic and nobody should
    // see roughly a thousand more warning lines for a field with no consumer yet.
    if (film.imdb_id !== null && film.imdb_id !== undefined && !/^tt\d+$/.test(film.imdb_id)) {
      errors.push(`${where} — imdb_id must look like "tt1234567", got ${JSON.stringify(film.imdb_id)}`);
    }
    if (film.poster_url !== null && film.poster_url !== undefined) {
      if (typeof film.poster_url !== 'string' || !/^https?:\/\//.test(film.poster_url)) {
        errors.push(`${where} — poster_url must be a full http(s) URL, got ${JSON.stringify(film.poster_url)}`);
      }
    }
    if (film.letterboxd_slug !== null && film.letterboxd_slug !== undefined && !/^[a-z0-9-]+$/.test(film.letterboxd_slug)) {
      errors.push(`${where} — letterboxd_slug must look like "the-master", got ${JSON.stringify(film.letterboxd_slug)}`);
    }

    for (const tag of TASTE_TAGS) {
      if (!isInteger(film.tags?.[tag], 1, 5)) {
        errors.push(`${where} — tags.${tag} must be an integer 1-5, got ${film.tags?.[tag]}`);
      }
    }
    const acclaim = film.tags?.acclaim;
    if (typeof acclaim !== 'number' || acclaim < 0 || acclaim > 1) {
      errors.push(`${where} — tags.acclaim must be a number 0-1, got ${acclaim}`);
    }
    for (const flag of CONTENT_BOOLEANS) {
      if (typeof film.content?.[flag] !== 'boolean') {
        errors.push(`${where} — content.${flag} must be true or false`);
      }
    }
    for (const flag of CONTENT_SEVERITIES) {
      if (!isInteger(film.content?.[flag], 0, 3)) {
        errors.push(`${where} — content.${flag} must be an integer 0-3`);
      }
    }
  }

  for (const entity of corpus.entities) {
    const where = `${entity.sourceFile}`;
    if (!entity.slug) errors.push(`${where} — missing slug`);
    if (!ENTITY_KINDS.includes(entity.kind)) {
      errors.push(`${where} — kind must be one of ${ENTITY_KINDS.join(', ')}, got ${entity.kind}`);
    }
    if (!entity.name) errors.push(`${where} — missing name`);
    if (!entity.blurb) warnings.push(`${where} — no blurb; the entity page will read thin`);

    // Declared in order of start year, because that declared order IS the chronological order the
    // era mode sequences by.
    const eraIds = new Set((entity.eras ?? []).map((era) => era.id));
    if (entity.kind === 'studio') {
      if (eraIds.size === 0) errors.push(`${where} — a studio needs at least one era`);
      const years = (entity.eras ?? []).map((era) => era.from);
      for (let i = 1; i < years.length; i += 1) {
        if (years[i] < years[i - 1]) {
          errors.push(`${where} — eras must be declared in order of their start year`);
          break;
        }
      }
    } else if (entity.eras) {
      errors.push(`${where} — eras apply to studios only`);
    }

    const entityFilms = entity.films ?? [];
    const referenced = new Set();
    for (const pair of entityFilms) {
      if (!filmsById.has(pair.film)) {
        errors.push(`${where} — references unknown film "${pair.film}"`);
        continue;
      }
      if (referenced.has(pair.film)) errors.push(`${where} — film "${pair.film}" listed twice`);
      referenced.add(pair.film);

      if (!isInteger(pair.signature, 1, 5)) {
        errors.push(`${where}: ${pair.film} — signature must be an integer 1-5`);
      }
      if (!isInteger(pair.gateway, 0, 5)) {
        errors.push(`${where}: ${pair.film} — gateway must be an integer 0-5`);
      }
      if (!pair.note) warnings.push(`${where}: ${pair.film} — no note; the film card will be bare`);

      if (pair.must_see !== undefined && typeof pair.must_see !== 'boolean') {
        errors.push(`${where}: ${pair.film} — must_see must be true or false`);
      }
      // A must-see that can never open is fine — plenty of essential films are terrible
      // introductions — but a must-see nobody should watch is a contradiction in the tagging.
      if (pair.must_see && pair.signature <= 1) {
        errors.push(
          `${where}: ${pair.film} — marked must_see with signature ${pair.signature}; a film ` +
            'the entity is only incidentally attached to cannot also be essential to them',
        );
      }

      // For a director, `signature` means "exemplifies their style" and one number is enough. For
      // an actor it would be doing two jobs at once: persona ("is this the De Niro people mean")
      // and showcase ("does this show what they can do"). Taxi Driver is both; Silver Linings is
      // showcase and not persona. Collapsing them returns nothing but the famous roles, so
      // `signature` carries persona and `showcase` is stored separately.
      // Studios need an era per film and a director on the film itself — not to constrain
      // selection, only so a reader can see whose work a path is actually made of.
      if (entity.kind === 'studio') {
        const film = filmsById.get(pair.film);
        if (film && !film.director) {
          errors.push(`${where}: ${pair.film} — a studio's films need a director on the film`);
        }
        if (!eraIds.has(pair.era)) {
          errors.push(
            `${where}: ${pair.film} — era "${pair.era}" is not declared in this entity's eras`,
          );
        }
      } else if ('era' in pair) {
        errors.push(`${where}: ${pair.film} — era applies to studios only`);
      }

      if (entity.kind === 'actor') {
        if (!ROLE_SIZES.includes(pair.role_size)) {
          errors.push(
            `${where}: ${pair.film} — role_size must be one of ${ROLE_SIZES.join(', ')}; without ` +
              'it the engine will recommend films the actor is barely in',
          );
        }
        if (!REGISTERS.includes(pair.register)) {
          errors.push(`${where}: ${pair.film} — register must be one of ${REGISTERS.join(', ')}`);
        }
        if (!isInteger(pair.showcase, 1, 5)) {
          errors.push(`${where}: ${pair.film} — showcase must be an integer 1-5`);
        }
        if (pair.against_type !== undefined && typeof pair.against_type !== 'boolean') {
          errors.push(`${where}: ${pair.film} — against_type must be true or false`);
        }
      } else {
        for (const field of ['role_size', 'register', 'showcase', 'against_type']) {
          if (field in pair) {
            errors.push(`${where}: ${pair.film} — ${field} applies to actors only`);
          }
        }
      }

      if ('essential' in pair) {
        errors.push(
          `${where}: ${pair.film} — \`essential\` was removed from the schema; it correlates ` +
            'with signature and double-counts it. Use signature 4-5 instead',
        );
      }
    }

    // Without a legal opener there is no path to build at any depth, for any profile.
    if (entityFilms.length > 0 && !entityFilms.some((pair) => pair.gateway > 0)) {
      errors.push(`${where} — every film has gateway 0, so no path can ever open`);
    }

    const mustSeeCount = entityFilms.filter((pair) => pair.must_see).length;
    if (mustSeeCount > MIN_DEPTH - 1) {
      errors.push(
        `${where} — ${mustSeeCount} films marked must_see, but a depth-${MIN_DEPTH} request ` +
          `only ever guarantees ${MIN_DEPTH - 1} of them a slot; the "no matter what" promise ` +
          'would be broken for whichever one loses the tie. Mark fewer',
      );
    }

    const prereqs = entity.prereqs ?? [];
    for (const edge of prereqs) {
      if (!referenced.has(edge.film)) {
        errors.push(`${where} — prereq for "${edge.film}", which this entity does not list`);
      }
      if (!referenced.has(edge.requires)) {
        errors.push(`${where} — prereq requires "${edge.requires}", which this entity does not list`);
      }
      if (!['hard', 'soft'].includes(edge.strength)) {
        errors.push(`${where} — prereq strength must be hard or soft, got ${edge.strength}`);
      }
    }
    const cycle = findCycle(prereqs);
    if (cycle) errors.push(`${where} — prereq cycle: ${cycle.join(' -> ')}`);

    const curatedOrder = entity.curated?.order ?? [];
    if (curatedOrder.length === 0) {
      warnings.push(`${where} — no curated house pick; it is the fallback when the engine fails`);
    }
    for (const id of curatedOrder) {
      if (!referenced.has(id)) {
        errors.push(`${where} — curated order includes "${id}", which this entity does not list`);
      }
    }
    if (new Set(curatedOrder).size !== curatedOrder.length) {
      errors.push(`${where} — curated order repeats a film`);
    }
    // The house pick doubles as the M9 expressiveness target, so it must itself be legal.
    if (curatedOrder.length > 0) {
      const opener = entityFilms.find((pair) => pair.film === curatedOrder[0]);
      if (opener && opener.gateway === 0) {
        errors.push(
          `${where} — curated order opens on "${curatedOrder[0]}", which has gateway 0`,
        );
      }
      const position = new Map(curatedOrder.map((id, index) => [id, index]));
      for (const edge of prereqs) {
        if (edge.strength !== 'hard') continue;
        if (!position.has(edge.film)) continue;
        if (!position.has(edge.requires)) {
          errors.push(
            `${where} — curated order includes "${edge.film}" but omits its hard prereq ` +
              `"${edge.requires}"`,
          );
        } else if (position.get(edge.requires) > position.get(edge.film)) {
          errors.push(
            `${where} — curated order places "${edge.film}" before its hard prereq ` +
              `"${edge.requires}"`,
          );
        }
      }
    }
  }

  return { errors, warnings };
}

async function main() {
  const corpus = await loadCorpus();
  const { errors, warnings } = validateCorpus(corpus);

  for (const warning of warnings) console.warn(`warn  ${warning}`);
  for (const error of errors) console.error(`ERROR ${error}`);

  const filmCount = corpus.films.length;
  const entityCount = corpus.entities.length;
  console.log(
    `\n${filmCount} films, ${entityCount} entities — ` +
      `${errors.length} errors, ${warnings.length} warnings`,
  );
  if (errors.length > 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
