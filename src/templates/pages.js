// The two page types. Both render fully server-side.
//
// The house pick is the crawlable surface and it must be complete without JavaScript: "david
// lynch watch order" is the query this site has to win, and a page whose content only appears
// after a quiz has nothing for a crawler to index. The quiz recomputes the list client-side in
// Phase 4, on top of a page that already said something.

import { esc, formatRuntime, layout } from './layout.js';

const SITE = 'https://alexthehueman.github.io/watchorder';

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
              ${esc(formatRuntime(film))}${series ? ' <span class="badge">series</span>' : ''}
            </p>
            ${pair.note ? `<p class="note">${esc(pair.note)}</p>` : ''}
            ${entry.why ? `<p class="why">${esc(entry.why)}</p>` : ''}
            ${entry.warning ? `<p class="warn">${esc(entry.warning)}</p>` : ''}
          </div>
        </li>`;
}

/**
 * @param {object} entity
 * @param {Map<string, object>} filmsById
 * @param {Array<object>} housePath the curated order, resolved and annotated
 * @returns {string}
 */
export function entityPage(entity, filmsById, housePath) {
  const canonical = `${SITE}/${entity.kind}/${entity.slug}/`;
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

  const body = `    <main class="entity">
      <nav class="crumbs"><a href="/">All filmmakers</a></nav>
      <h1>${esc(entity.name)}</h1>
      <p class="blurb">${esc(entity.blurb)}</p>

      <section aria-labelledby="pick">
        <h2 id="pick">The house pick</h2>
        <p class="rationale">${esc(entity.curated?.rationale ?? '')}</p>
        ${
          seriesSlots > 0
            ? `<p class="aside">One of these is a series, so it asks for several evenings rather
          than one. It is counted accordingly when you set a length.</p>`
            : ''
        }
        <ol class="films">
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
    </main>`;

  return layout({ title, description, canonical, body, jsonLd });
}

/**
 * @param {Array<object>} entities
 * @returns {string}
 */
export function indexPage(entities) {
  const title = 'WatchOrder — viewing orders for filmmakers worth the trouble';
  const description =
    'Curated and personalised viewing orders for filmmakers, computed from hand-written tags ' +
    'rather than scraped ratings.';

  const body = `    <main class="home">
      <h1>Where do you start with a filmmaker?</h1>
      <p class="lede">
        Not with their first film, usually. Not with their best either. Every path here is built
        from tags written by hand — how much a film explains, how still it is, how bleak, how
        funny — so the order can suit how you actually watch rather than how a ranking sorts.
      </p>

      <h2>Filmmakers</h2>
      <ul class="roster">
${entities
  .map(
    (entity) => `        <li>
          <a href="/${entity.kind}/${entity.slug}/">
            <span class="name">${esc(entity.name)}</span>
            <span class="blurb">${esc(entity.blurb)}</span>
          </a>
        </li>`,
  )
  .join('\n')}
      </ul>
    </main>`;

  return layout({ title, description, canonical: `${SITE}/`, body });
}

/**
 * @param {string[]} paths site-root-relative, each ending in a slash
 * @returns {string}
 */
export function sitemap(paths) {
  const today = new Date().toISOString().slice(0, 10);
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${paths
  .map((path) => `  <url><loc>${SITE}${path}</loc><lastmod>${today}</lastmod></url>`)
  .join('\n')}
</urlset>
`;
}
