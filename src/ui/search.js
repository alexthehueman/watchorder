// Search and kind-tabs over the index page: directors, actors, studios, and every film in the
// corpus. Client-side and dependency-free, matching the quiz's shape — a JSON payload embedded at
// build time, read once, filtered in memory. Twenty-one entities and two hundred-odd films is a
// list a browser filters instantly; nothing here needs an index structure more complex than an
// array.
//
// Both ship hidden and are revealed by script, the same reasoning as the quiz form: without
// JavaScript there is no filtering to offer, so an inert search box or a set of tabs that switch
// nothing would be furniture. The three full rosters below them already list everything, so a
// no-JS visitor loses nothing but the shortcut.

const data = JSON.parse(document.getElementById('search-data').textContent);

const box = document.getElementById('search');
const input = document.getElementById('search-input');
const status = document.getElementById('search-status');
const results = document.getElementById('search-results');
const sections = [...document.querySelectorAll('.roster-section')];
const tabsBox = document.getElementById('kind-tabs');
const tabButtons = [...document.querySelectorAll('.kind-tab')];

const KIND_LABEL = { director: 'Director', actor: 'Actor', studio: 'Studio' };

// Whichever tab is marked selected in the markup — see indexPage() in pages.js — starts as the
// active kind, so server-rendered and script-driven state agree without a separate lookup.
let activeKind = tabButtons.find((tab) => tab.getAttribute('aria-selected') === 'true')?.dataset.kind;

function entityHref(kind, slug) {
  // Relative to the page the script is loaded from, which is always the site root for this page —
  // no base-path plumbing needed here the way layout.js needs it for absolute hrefs.
  return `${kind}/${slug}/`;
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function resultRow(primary, secondary, kind, href) {
  const item = element('li', 'result');
  const link = document.createElement('a');
  link.href = href;
  link.append(element('span', 'name', primary));
  if (secondary) link.append(element('span', 'blurb', secondary));
  link.append(element('span', 'badge kind', KIND_LABEL[kind] ?? kind));
  item.append(link);
  return item;
}

/**
 * Entity matches by name or blurb, film matches by title. Both return every hit — the list is
 * short enough that there is no reason to cap it, and a film like Wild at Heart genuinely does
 * belong under both David Lynch and Nicolas Cage.
 */
function search(query) {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return { entities: [], films: [] };

  const entities = data.entities.filter(
    (entity) => entity.name.toLowerCase().includes(q) || entity.blurb.toLowerCase().includes(q),
  );
  const films = data.films.filter((film) => film.title.toLowerCase().includes(q));
  return { entities, films };
}

/** Shows only the section for `kind`, leaving the others hidden — the tabbed-browsing state. */
function showOnlyActiveKind() {
  sections.forEach((section) => (section.hidden = section.dataset.kind !== activeKind));
}

function render(query) {
  const q = query.trim();
  results.replaceChildren();

  if (q.length < 2) {
    results.hidden = true;
    status.hidden = true;
    showOnlyActiveKind();
    return;
  }

  sections.forEach((section) => (section.hidden = true));
  const { entities, films } = search(q);

  for (const entity of entities) {
    results.append(resultRow(entity.name, entity.blurb, entity.kind, entityHref(entity.kind, entity.slug)));
  }
  for (const film of films) {
    results.append(
      resultRow(`${film.title} (${film.year})`, `via ${film.entity}`, film.kind, entityHref(film.kind, film.slug)),
    );
  }

  const total = entities.length + films.length;
  results.hidden = total === 0;
  status.hidden = total > 0;
  if (total === 0) status.textContent = `Nothing matches "${q}".`;
}

function selectTab(kind) {
  activeKind = kind;
  tabButtons.forEach((tab) => tab.setAttribute('aria-selected', String(tab.dataset.kind === kind)));
  // A tab click is a request to browse that kind specifically — clearing any in-progress search
  // avoids the confusing state of a query still filtering results while a tab looks selected.
  input.value = '';
  render('');
}

box.hidden = false;
input.addEventListener('input', () => render(input.value));

if (tabButtons.length > 0) {
  tabsBox.hidden = false;
  tabButtons.forEach((tab) => tab.addEventListener('click', () => selectTab(tab.dataset.kind)));
  showOnlyActiveKind();
}
