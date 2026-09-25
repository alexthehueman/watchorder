// Lets a visitor mark films seen on the Film Canon tab, persisted in localStorage. No accounts and
// no server — the whole point of tracking this client-side is that it costs nothing to add and
// survives nothing but a browser data wipe, which is the honest promise a static site can make.
//
// Same reasoning as the quiz form and search box: the checkboxes ship hidden in the markup, since
// without JavaScript there is nowhere for "seen" to live and an inert checkbox would be furniture,
// not a feature.

const STORAGE_KEY = 'watchorder:seen-films';

/**
 * Reads the seen-film id set from localStorage. Falls back to an empty set on any failure —
 * corrupted JSON, storage disabled in a locked-down browser, private browsing quirks — none of
 * which should ever be fatal to a page whose real content already rendered server-side.
 * @returns {Set<string>}
 */
function loadSeen() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

/** @param {Set<string>} seen */
function saveSeen(seen) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...seen]));
  } catch {
    // Storage can be unavailable — the checkbox still works for the rest of this page view, it
    // just won't survive a reload. Not worth surfacing as an error over.
  }
}

const SORT_STORAGE_KEY = 'watchorder:canon-sort';

/**
 * Reorders the canon <li>s in place by a data attribute the server already computed — no parsing
 * of visible text, just three numbers per film (house index, year, rating). A missing rating
 * (still being backfilled for the whole corpus as of this feature shipping) sorts to the end
 * rather than the front, which is what a naive numeric comparison of an empty string would do.
 * @param {'house' | 'release' | 'rating'} mode
 */
function applySort(mode) {
  const list = document.getElementById('canon-films');
  if (!list) return;
  const items = [...list.children];

  const keyOf = {
    house: (li) => Number(li.dataset.houseIndex),
    release: (li) => Number(li.dataset.year),
    rating: (li) => (li.dataset.rating ? -Number(li.dataset.rating) : Infinity),
  }[mode];
  if (!keyOf) return;

  items.sort((a, b) => keyOf(a) - keyOf(b) || Number(a.dataset.houseIndex) - Number(b.dataset.houseIndex));
  for (const item of items) list.append(item);
}

const sortSelect = document.getElementById('canon-sort-select');
if (sortSelect) {
  sortSelect.closest('.canon-sort').hidden = false;

  let initial = 'house';
  try {
    const stored = localStorage.getItem(SORT_STORAGE_KEY);
    if (stored === 'house' || stored === 'release' || stored === 'rating') initial = stored;
  } catch {
    // Storage unavailable — falls back to the server-rendered house order for this page view.
  }
  sortSelect.value = initial;
  if (initial !== 'house') applySort(initial);

  sortSelect.addEventListener('change', () => {
    applySort(sortSelect.value);
    try {
      localStorage.setItem(SORT_STORAGE_KEY, sortSelect.value);
    } catch {
      // Non-fatal — the choice just won't persist past this page view.
    }
  });
}

const checkboxes = [...document.querySelectorAll('.seen-check')];
if (checkboxes.length > 0) {
  const seen = loadSeen();

  for (const checkbox of checkboxes) {
    const id = checkbox.dataset.filmId;
    const card = checkbox.closest('.canon-film');
    checkbox.closest('.seen-toggle').hidden = false;
    checkbox.checked = seen.has(id);
    card.classList.toggle('seen', seen.has(id));

    checkbox.addEventListener('change', () => {
      if (checkbox.checked) seen.add(id);
      else seen.delete(id);
      card.classList.toggle('seen', checkbox.checked);
      saveSeen(seen);
    });
  }
}
