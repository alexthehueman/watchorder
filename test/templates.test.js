// Guards the base path, which is the one bug class that is invisible until it is deployed.
//
// GitHub Pages serves a project site from /<repo>/. Every absolute URL the build emits therefore
// has to carry that prefix, and locally — where the site is served from the root — a missing
// prefix looks completely fine. The first version of these templates hardcoded "/ui/site.css" and
// would have shipped a site with no stylesheet and no working link on it.
//
// Note also that MSYS rewrites a leading-slash environment variable into a Windows path in Git
// Bash, so `BASE=/watchorder npm run build` silently produces C:/Program Files/Git/watchorder.
// Use MSYS_NO_PATHCONV=1 when testing a base path by hand there.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCorpus } from '../tools/validate.mjs';
import { entityPage, indexPage, sitemap } from '../src/templates/pages.js';
import { esc } from '../src/templates/layout.js';

const BASE = '/watchorder';
const ORIGIN = 'https://example.github.io';

async function render(site) {
  const corpus = await loadCorpus();
  const filmsById = new Map(corpus.films.map((film) => [film.id, film]));
  const entity = corpus.entities.find((candidate) => candidate.slug === 'david-lynch');
  const pairs = new Map(entity.films.map((pair) => [pair.film, pair]));
  const housePath = entity.curated.order.map((id) => ({
    film: filmsById.get(id),
    pair: pairs.get(id),
    why: null,
    warning: null,
  }));
  return {
    entity: entityPage(entity, filmsById, housePath, site),
    index: indexPage(corpus.entities, site),
    sitemap: sitemap(['/', '/director/david-lynch/'], site),
  };
}

test('every absolute URL carries the base path', async () => {
  const pages = await render({ base: BASE, origin: ORIGIN });

  for (const [name, html] of Object.entries(pages)) {
    // Any href or src starting with a slash that is not the base path would 404 on a project
    // site. Protocol-relative and absolute URLs are left alone.
    const absolute = [...html.matchAll(/(?:href|src)="(\/[^"]*)"/g)].map((match) => match[1]);
    const stray = absolute.filter((path) => !path.startsWith(`${BASE}/`) && path !== `${BASE}`);
    assert.deepEqual(
      stray,
      [],
      `${name} emits absolute URLs that ignore the base path: ${stray.join(', ')}`,
    );
  }
});

test('canonical URLs and the sitemap use the real origin', async () => {
  const pages = await render({ base: BASE, origin: ORIGIN });
  const canonical = pages.entity.match(/<link rel="canonical" href="([^"]+)"/)[1];
  assert.equal(canonical, `${ORIGIN}${BASE}/director/david-lynch/`);
  assert.ok(pages.sitemap.includes(`<loc>${ORIGIN}${BASE}/director/david-lynch/</loc>`));
});

test('an empty base produces root-relative URLs', async () => {
  // The local and user-site case. Nothing should acquire a stray double slash.
  const pages = await render({ base: '', origin: ORIGIN });
  assert.ok(pages.entity.includes('href="/ui/site.css"'));
  assert.ok(!pages.entity.includes('href="//'), 'doubled slash in an emitted URL');
  assert.ok(!pages.index.includes('href="//'), 'doubled slash in an emitted URL');
});

test('corpus text is escaped, not interpolated raw', async () => {
  // Tested on the escaper directly rather than by pattern-matching rendered output: no title in
  // the corpus currently contains a quote or a bracket, so a test over real data would pass
  // whether or not escaping worked at all. It will contain one eventually — Les Rendez-vous
  // d'Anna already carries an apostrophe — and the escaper is what has to hold.
  assert.equal(esc(`<script>alert('x')</script>`), '&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;');
  assert.equal(esc('Les Rendez-vous d\'Anna'), 'Les Rendez-vous d&#39;Anna');
  assert.equal(esc('Fear & Loathing'), 'Fear &amp; Loathing');
  assert.equal(esc('a "quoted" title'), 'a &quot;quoted&quot; title');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');

  // And the corpus does reach the page through it.
  const pages = await render({ base: '', origin: ORIGIN });
  assert.ok(pages.entity.includes('Twin Peaks: Fire Walk with Me'), 'titles should render');
  const titles = [...pages.entity.matchAll(/<h3>([^<]*)</g)].map((match) => match[1]);
  assert.ok(titles.length > 0, 'no film titles found to check');
  for (const title of titles) {
    assert.ok(!/["'<>&]/.test(title), `raw markup character in rendered title: ${title}`);
  }
});
