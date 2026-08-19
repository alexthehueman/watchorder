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
