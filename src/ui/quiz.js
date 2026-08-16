// The quiz island. Progressive enhancement over a page that already answered the question.
//
// The point of this file is how little of it there is. It imports ../core/path.js — the exact
// module build.js used to render the house pick, byte for byte, over native ESM with no bundler
// between them. There is no second implementation of the ranking rules to drift out of sync with
// the first, which is the whole reason src/core/ is kept pure and why a test enforces it.
//
// Everything here is DOM plumbing: read the form, call buildPath, paint the result, keep the URL
// in step so the path can be shared.

import { buildPath } from '../core/path.js';
import { profileFromAnswers, encodeAnswers, decodeProfile, answersFromProfile } from '../core/profile.js';

const data = JSON.parse(document.getElementById('data').textContent);
const filmsById = new Map(data.films.map((film) => [film.id, film]));
const filmOrder = data.entity.films.map((pair) => pair.film);

const form = document.getElementById('quiz-form');
const list = document.getElementById('path');
const heading = document.getElementById('pick');
const rationale = document.getElementById('rationale');
const status = document.getElementById('status');
const resetButton = document.getElementById('reset');

const houseMarkup = list.innerHTML;
const houseHeading = heading.textContent;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function formatRuntime(film) {
  const hours = Math.floor(film.runtime / 60);
  const minutes = film.runtime % 60;
  const span = hours > 0 ? `${hours}h${minutes > 0 ? ` ${minutes}m` : ''}` : `${minutes}m`;
  return film.medium === 'series' ? `${span} across ${film.episodes} episodes` : span;
}

/**
 * Builds the same card shape as filmCard in src/templates/pages.js.
 *
 * The structure is parallel by necessity — one renders at build time to a string, the other at
 * runtime to nodes — but the risk that usually comes with duplicated rendering does not apply
 * here: this path sets textContent, so corpus data can never be interpreted as markup no matter
 * what a film title contains.
 */
function card(entry, index) {
  const item = element('li', 'film');
  item.append(element('div', 'rank', String(index + 1)));

  if (entry.film.poster_url) {
    const poster = element('img', 'poster');
    poster.src = entry.film.poster_url; // a DOM property assignment, not markup — never interpreted as HTML
    poster.alt = '';
    poster.loading = 'lazy';
    poster.width = 56;
    poster.height = 84;
    item.append(poster);
  } else {
    const placeholder = element('div', 'poster-placeholder');
    placeholder.setAttribute('aria-hidden', 'true');
    item.append(placeholder);
  }

  const body = element('div', 'body');
  const title = element('h3', null, entry.film.title + ' ');
  title.append(element('span', 'year', String(entry.film.year)));
  body.append(title);

  const meta = element('p', 'meta', formatRuntime(entry.film));
  if (entry.film.medium === 'series') {
    meta.append(' ', element('span', 'badge', 'series'));
  }
  if (entry.pair.must_see) {
    meta.append(' ', element('span', 'badge must', 'must see'));
  }
  body.append(meta);

  if (entry.note) body.append(element('p', 'note', entry.note));
  if (entry.why) body.append(element('p', 'why', entry.why));
  if (entry.warning) body.append(element('p', 'warn', entry.warning));

  item.append(body);
  return item;
}

function readForm() {
  const values = new FormData(form);
  const answers = {
    depth: Number(values.get('depth') ?? 1),
    mode: Number(values.get('mode') ?? 0),
    confusion: Number(values.get('confusion') ?? 1),
    register: Number(values.get('register') ?? 1),
  };
  return {
    answers,
    seen: values.getAll('seen'),
    blocked: values.getAll('blocked'),
  };
}

/**
 * Why the list is the length it is.
 *
 * A short list has several possible causes and they are not interchangeable. Blaming the slot
 * accounting when the real reason was a content filter tells the reader something false about
 * their own settings, which is worse than saying nothing — so the series line is only used when
 * the path actually contains a series.
 */
function explain(films, profile, blocked) {
  const titles = films.length;
  const slots = Number.isFinite(profile.depth) ? profile.depth : null;
  if (!slots || titles >= slots) return `${titles} titles.`;

  if (films.some((entry) => entry.film.medium === 'series')) {
    return `${titles} titles — a series counts for several, so this is ${slots} films' worth.`;
  }
  if (blocked.length > 0) {
    return `${titles} titles — that is everything left once your exclusions are applied.`;
  }
  return `${titles} titles — that is the whole filmography that suits those answers.`;
}

function showHousePick() {
  list.innerHTML = houseMarkup;
  heading.textContent = houseHeading;
  rationale.hidden = false;
  status.hidden = true;
  resetButton.hidden = true;
  history.replaceState(null, '', location.pathname);
}

function render() {
  const { answers, seen, blocked } = readForm();
  const profile = profileFromAnswers(answers, { seen, blocked });
  const result = buildPath(data.entity, filmsById, profile);

  heading.textContent = 'Your order';
  rationale.hidden = true;
  resetButton.hidden = false;

  list.replaceChildren();
  if (result.status !== 'ok') {
    // The no-path case is a designed state, not an error to swallow: aggressive content filters
    // on a filmography like this one genuinely can exclude everything, and a silent empty list
    // would read as a broken page rather than an answered question.
    status.hidden = false;
    status.textContent = result.reason ?? 'No path could be built from those answers.';
  } else {
    status.hidden = false;
    status.textContent = explain(result.films, profile, blocked);
    result.films.forEach((entry, index) => list.append(card(entry, index)));
  }

  const seenIndices = seen.map((id) => filmOrder.indexOf(id)).filter((index) => index >= 0);
  const encoded = encodeAnswers(answers, seenIndices, blocked);
  const query = new URLSearchParams(encoded).toString();
  history.replaceState(null, '', `${location.pathname}?${query}`);
}

/** Restore the form from a shared link, so the same URL always shows the same path. */
function restoreFromUrl() {
  const params = new URLSearchParams(location.search);
  if (!params.has('p')) return false;

  const profile = decodeProfile(params.get('p'), params.get('s'), filmOrder, params.get('c'));
  const answers = answersFromProfile(profile);

  for (const [name, value] of Object.entries(answers)) {
    const input = form.querySelector(`input[name="${name}"][value="${value}"]`);
    if (input) input.checked = true;
  }
  for (const id of profile.seen) {
    const input = form.querySelector(`input[name="seen"][value="${CSS.escape(id)}"]`);
    if (input) input.checked = true;
  }
  for (const flag of profile.blocked) {
    const input = form.querySelector(`input[name="blocked"][value="${CSS.escape(flag)}"]`);
    if (input) input.checked = true;
  }
  return true;
}

document.getElementById('quiz').hidden = false;
resetButton.hidden = true;
form.addEventListener('change', render);
resetButton.addEventListener('click', showHousePick);

if (restoreFromUrl()) render();
