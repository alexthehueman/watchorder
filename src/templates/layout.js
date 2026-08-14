// The HTML shell and the small helpers every page needs.
//
// Template literals rather than a templating dependency: there are three page types and the
// escaping rules are the only genuinely tricky part, so a library would earn nothing here and
// cost a dependency in a project that has one.
//
// Not in src/core/ on purpose. Core is the pure engine that must run in the browser too; this is
// build-time rendering and has no business being loaded by a page.

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/**
 * Escape for HTML text and attribute contexts. Every interpolation of corpus data goes through
 * this — film titles genuinely contain apostrophes and ampersands, and a title is the one field
 * most likely to acquire a quote the day someone adds a Godard.
 * @param {unknown} value
 * @returns {string}
 */
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ESCAPES[character]);
}

/**
 * "2h 27m", or for a series the run plus its episode count, because "21h 30m" alone reads as a
 * threat rather than information.
 * @param {{runtime: number, medium?: string, episodes?: number}} film
 * @returns {string}
 */
export function formatRuntime(film) {
  const hours = Math.floor(film.runtime / 60);
  const minutes = film.runtime % 60;
  const span = hours > 0 ? `${hours}h${minutes > 0 ? ` ${minutes}m` : ''}` : `${minutes}m`;
  if (film.medium === 'series') return `${span} across ${film.episodes} episodes`;
  return span;
}

/**
 * Where the site lives.
 *
 * GitHub Pages serves a project site from /<repo>/, not from the root, so every absolute URL the
 * build emits has to carry that prefix or the deployed site loads no stylesheet and every link
 * 404s. The default is empty, which is correct locally and for a user site; the deploy workflow
 * sets BASE.
 *
 * Note that src/ui/quiz.js imports ../core/path.js relatively and needs no prefix — it resolves
 * from wherever the page is served, which is the quiet advantage of dist mirroring src.
 *
 * @param {string} path site-root-relative, beginning with a slash
 * @returns {string}
 */
export function url(base, path) {
  return `${base}${path}`;
}

/**
 * @param {{title: string, description: string, canonical: string, body: string,
 *          base: string, jsonLd?: object}} page
 * @returns {string}
 */
export function layout(page) {
  const base = page.base ?? '';
  const jsonLd = page.jsonLd
    ? `\n    <script type="application/ld+json">${JSON.stringify(page.jsonLd).replace(/</g, '\\u003c')}</script>`
    : '';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${esc(page.title)}</title>
    <meta name="description" content="${esc(page.description)}">
    <link rel="canonical" href="${esc(page.canonical)}">
    <meta property="og:title" content="${esc(page.title)}">
    <meta property="og:description" content="${esc(page.description)}">
    <meta property="og:type" content="website">
    <link rel="stylesheet" href="${esc(url(base, '/ui/site.css'))}">${jsonLd}
  </head>
  <body>
    <header class="site">
      <a class="wordmark" href="${esc(url(base, '/'))}">WatchOrder</a>
    </header>
${page.body}
    <footer class="site">
      <p>Every path here is computed from tags written by hand, not scraped from ratings.</p>
      <p class="fine">
        This product uses the TMDB API but is not endorsed or certified by TMDB.
      </p>
    </footer>
  </body>
</html>
`;
}
