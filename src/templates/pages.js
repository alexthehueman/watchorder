// The two page types. Both render fully server-side.
//
// The house pick is the crawlable surface and it must be complete without JavaScript: "david
// lynch watch order" is the query this site has to win, and a page whose content only appears
// after a quiz has nothing for a crawler to index. The quiz recomputes the list client-side in
// Phase 4, on top of a page that already said something.

import { esc, formatRuntime, layout, url } from './layout.js';

/**
 * One entry in an ordered path. `why` is deliberately absent in modes where the ordering speaks
 * for itself, so the line is omitted rather than filled with something invented.
 */
function filmCard(entry, index) {
  const { film, pair } = entry;
  const series = film.medium === 'series';
  return `        <li class="film">
          <div class="rank">${index + 1}</div>
          <div class="body">
            <h3>${esc(film.title)} <span class="year">${film.year}</span></h3>
            <p class="meta">
              ${esc(formatRuntime(film))}${series ? ' <span class="badge">series</span>' : ''}${
                pair.must_see ? ' <span class="badge must">must see</span>' : ''
              }
            </p>
            ${pair.note ? `<p class="note">${esc(pair.note)}</p>` : ''}
            ${entry.why ? `<p class="why">${esc(entry.why)}</p>` : ''}
            ${entry.warning ? `<p class="warn">${esc(entry.warning)}</p>` : ''}
          </div>
        </li>`;
}

const QUESTIONS = [
  {
    name: 'depth',
    legend: 'How many will you actually watch?',
    options: ['Three', 'Six', 'Twelve', 'Everything'],
  },
  {
    name: 'mode',
    legend: 'How should it be ordered?',
    // The middle option keeps its index across kinds so a shared URL stays stable, but it asks a
    // different question: chronology is artistic development for a director and mostly hiring
    // order for an actor, where what matters is how far the performances travel.
    options: ['Ease me in', 'Watch them develop', 'Best work first'],
    byKind: {
      actor: ['Ease me in', 'Show me their range', 'Best work first'],
      studio: ['Ease me in', 'Trace the eras', 'Best work first'],
    },
  },
  {
    name: 'confusion',
    legend: 'How much confusion is fun?',
    options: ['Keep me oriented', 'Some is fine', 'Lose me entirely'],
  },
  {
    name: 'register',
    legend: 'Comfort or confrontation?',
    options: ['Comfort', 'Either', 'Confrontation'],
  },
];

const CONTENT_LABELS = {
  sexual_violence: 'Sexual violence',
  animal_harm: 'Harm to animals',
  child_harm: 'Harm to children',
  suicide: 'Suicide',
};

/**
 * The form ships hidden and the script reveals it.
 *
 * Without JavaScript there is no server to submit to, so a visible form would be furniture that
 * does nothing — worse than absent. Hidden, a no-JS visitor simply gets the house pick, which is
 * a complete answer to the question they came with. The default radio selections mirror the
 * neutral profile so the form is never in a state the engine has not been asked about.
 */
function quizForm(entity, filmsById) {
  const films = (entity.films ?? []).map((pair) => filmsById.get(pair.film));

  const fieldsets = QUESTIONS.map(
    (question) => `          <fieldset>
            <legend>${esc(question.legend)}</legend>
${(question.byKind?.[entity.kind] ?? question.options)
  .map(
    (label, index) => `            <label><input type="radio" name="${question.name}" value="${index}"${
      index === (question.name === 'depth' ? 1 : question.name === 'mode' ? 0 : 1) ? ' checked' : ''
    }> ${esc(label)}</label>`,
  )
  .join('\n')}
          </fieldset>`,
  ).join('\n');

  return `      <section class="quiz" id="quiz" hidden>
        <h2>Or answer five questions</h2>
        <form id="quiz-form">
${fieldsets}
          <details>
            <summary>Seen any already?</summary>
            <div class="checks">
${films
  .map(
    (film) => `              <label><input type="checkbox" name="seen" value="${esc(film.id)}"> ${esc(film.title)}</label>`,
  )
  .join('\n')}
            </div>
          </details>
          <details>
            <summary>Anything to avoid?</summary>
            <div class="checks">
${Object.entries(CONTENT_LABELS)
  .map(
    ([flag, label]) => `              <label><input type="checkbox" name="blocked" value="${flag}"> ${esc(label)}</label>`,
  )
  .join('\n')}
            </div>
          </details>
          <button type="button" id="reset">Back to the house pick</button>
        </form>
      </section>`;
}

/**
 * @param {object} entity
 * @param {Map<string, object>} filmsById
 * @param {Array<object>} housePath the curated order, resolved and annotated
 * @returns {string}
 */
export function entityPage(entity, filmsById, housePath, site) {
  const { base, origin } = site;
  const canonical = `${origin}${base}/${entity.kind}/${entity.slug}/`;
  const title = `${entity.name} — where to start, and what comes next`;
  const description = `A curated viewing order for ${entity.name}. ${entity.blurb}`;

  const seriesSlots = housePath.filter((entry) => entry.film.medium === 'series').length;
  const inHousePick = new Set(housePath.map((entry) => entry.film.id));

  // Release order doubles as the completeness the house pick deliberately lacks: the curated path
  // omits the duds, and a filmography page that hid them would be lying by omission.
  const everything = [...(entity.films ?? [])]
    .map((pair) => ({ pair, film: filmsById.get(pair.film) }))
    .sort((a, b) => a.film.year - b.film.year);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: title,
    description,
    itemListOrder: 'https://schema.org/ItemListOrderAscending',
    numberOfItems: housePath.length,
    itemListElement: housePath.map((entry, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      item: {
        '@type': entry.film.medium === 'series' ? 'TVSeries' : 'Movie',
        name: entry.film.title,
        datePublished: String(entry.film.year),
      },
    })),
  };

  const KIND_LABEL = { director: 'Director', actor: 'Actor', studio: 'Studio' };

  const body = `    <main class="entity" data-kind="${esc(entity.kind)}">
      <nav class="crumbs"><a href="${esc(url(base, '/'))}">← Directors, actors &amp; studios</a></nav>
      <p class="kind-label">${esc(KIND_LABEL[entity.kind] ?? entity.kind)}</p>
      <h1>${esc(entity.name)}</h1>
      <p class="blurb">${esc(entity.blurb)}</p>

${quizForm(entity, filmsById)}

      <section aria-labelledby="pick">
        <h2 id="pick">The house pick</h2>
        <p class="rationale" id="rationale">${esc(entity.curated?.rationale ?? '')}</p>
        <p class="status" id="status" hidden></p>
        ${
          seriesSlots > 0
            ? `<p class="aside">One of these is a series, so it asks for several evenings rather
          than one. It is counted accordingly when you set a length.</p>`
            : ''
        }
        <ol class="films" id="path">
${housePath.map(filmCard).join('\n')}
        </ol>
      </section>

      <section aria-labelledby="all">
        <h2 id="all">Everything, in release order</h2>
        <p class="aside">Including the ones the path above leaves out, and why.</p>
        <ul class="filmography">
${everything
  .map(({ film, pair }) => {
    // The heading promises a reason for each omission, so an omitted film shows its note. A
    // section that says "and why" and then prints only badges is making a promise it does not
    // keep, and this is the page's most sceptical audience.
    const omitted = !inHousePick.has(film.id);
    return `          <li${omitted ? ' class="omitted"' : ''}>
            <span class="t">${esc(film.title)}</span>
            <span class="year">${film.year}</span>
            ${pair.gateway === 0 ? '<span class="badge quiet">never first</span>' : ''}
            ${pair.signature <= 1 ? '<span class="badge quiet">outlier</span>' : ''}
            ${omitted && pair.note ? `<span class="reason">${esc(pair.note)}</span>` : ''}
          </li>`;
  })
  .join('\n')}
        </ul>
      </section>
    </main>
    <script type="application/json" id="data">${JSON.stringify({
      entity,
      // sourceFile is a build-time bookkeeping field; the browser has no use for it and it would
      // only leak the corpus layout into every page.
      films: everything.map(({ film }) => {
        const { sourceFile, ...rest } = film;
        return rest;
      }),
    }).replace(/</g, '\\u003c')}</script>
    <script type="module" src="${esc(url(base, '/ui/quiz.js'))}"></script>`;

  return layout({ title, description, canonical, body, jsonLd, base });
}

const KIND_SECTIONS = [
  { kind: 'director', heading: 'Directors' },
  { kind: 'actor', heading: 'Actors' },
  { kind: 'studio', heading: 'Studios' },
];

/**
 * One roster entry. `data-name`/`data-blurb` duplicate visible text into attributes rather than
 * re-reading textContent at search time — cheap, and it keeps the matching logic in search.js
 * from caring about the markup inside the card.
 */
function entityCard(entity, base) {
  return `          <li data-name="${esc(entity.name.toLowerCase())}" data-blurb="${esc(entity.blurb.toLowerCase())}">
            <a href="${esc(url(base, `/${entity.kind}/${entity.slug}/`))}">
              <span class="name">${esc(entity.name)}</span>
              <span class="blurb">${esc(entity.blurb)}</span>
            </a>
          </li>`;
}

/**
 * @param {Array<object>} entities
 * @param {Map<string, object>} filmsById
 * @param {{base: string, origin: string}} site
 * @returns {string}
 */
export function indexPage(entities, filmsById, site) {
  const { base, origin } = site;
  const title = 'WatchOrder — viewing orders for filmmakers worth the trouble';
  const description =
    'Curated and personalised viewing orders for directors, actors and studios, computed from ' +
    'hand-written tags rather than scraped ratings.';

  const byKind = new Map(KIND_SECTIONS.map((section) => [section.kind, []]));
  for (const entity of entities) byKind.get(entity.kind)?.push(entity);

  const sections = KIND_SECTIONS.filter((section) => byKind.get(section.kind).length > 0)
    .map(
      (section) => `      <section class="roster-section" aria-labelledby="${section.kind}s" data-kind="${section.kind}">
        <h2 id="${section.kind}s">${section.heading}</h2>
        <ul class="roster">
${byKind
  .get(section.kind)
  .map((entity) => entityCard(entity, base))
  .join('\n')}
        </ul>
      </section>`,
    )
    .join('\n');

  // Search matches films as well as entities, and a film can belong to more than one — Wild at
  // Heart is a Lynch film and a Cage performance, and a search for it should offer both. One row
  // per (film, entity) pair, rather than per film, is what makes that possible without the client
  // needing to know anything about how the corpus is shaped.
  const searchIndex = {
    entities: entities.map((entity) => ({
      kind: entity.kind,
      slug: entity.slug,
      name: entity.name,
      blurb: entity.blurb,
    })),
    films: entities.flatMap((entity) =>
      (entity.films ?? []).map((pair) => {
        const film = filmsById.get(pair.film);
        return { title: film.title, year: film.year, kind: entity.kind, slug: entity.slug, entity: entity.name };
      }),
    ),
  };

  const body = `    <main class="home">
      <h1>Where do you start?</h1>
      <p class="lede">
        Not with the first film, usually. Not with the best either. Every path here is built from
        tags written by hand — how much a film explains, how still it is, how bleak, how funny —
        so the order can suit how you actually watch rather than how a ranking sorts.
      </p>

      <div class="search" id="search" hidden>
        <label for="search-input" class="visually-hidden">Search directors, actors, studios and films</label>
        <input type="search" id="search-input" placeholder="Search a name or a film…" autocomplete="off">
        <p class="search-status" id="search-status" hidden></p>
        <ul class="search-results" id="search-results" hidden></ul>
      </div>

${sections}
    </main>
    <script type="application/json" id="search-data">${JSON.stringify(searchIndex).replace(/</g, '\\u003c')}</script>
    <script type="module" src="${esc(url(base, '/ui/search.js'))}"></script>`;

  return layout({ title, description, canonical: `${origin}${base}/`, body, base });
}

/**
 * @param {string[]} paths site-root-relative, each ending in a slash
 * @returns {string}
 */
export function sitemap(paths, site) {
  const today = new Date().toISOString().slice(0, 10);
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${paths
  .map(
    (path) =>
      `  <url><loc>${esc(site.origin + site.base + path)}</loc><lastmod>${today}</lastmod></url>`,
  )
  .join('\n')}
</urlset>
`;
}
