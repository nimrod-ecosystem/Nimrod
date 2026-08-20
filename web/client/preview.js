// preview.js — the composer -> kiosk handoff for an UNSAVED layout.
//
// WHY THIS IS ITS OWN MODULE: both the composer (home page) and the kiosk need it, and
// the composer must not import kiosk.js — that would pull the entire kiosk, and every
// module it registers, into the home page just to share two functions.
//
// WHY sessionStorage RATHER THAN THE URL: a layout is too big and too ugly for a query
// string, and a URL would let a preview be bookmarked or shared, which would make an
// unsaved arrangement look permanent to whoever opened it.
//
// ONE-SHOT, DELIBERATELY: `take` clears the value as it reads. Reloading the kiosk shows
// the SAVED screen again. A preview that silently persisted would be the same class of bug
// as the one this feature exists to fix — the composer opening a layout that was never
// what you were looking at.

export const PREVIEW_KEY = 'nimrod:previewLayout';

export function stashPreviewLayout(profileId, layout) {
  try { sessionStorage.setItem(PREVIEW_KEY, JSON.stringify({ profileId, layout })); }
  catch { /* private mode / storage disabled — the preview just won't apply */ }
}

// Returns the stashed layout for `profileId`, or null. Always clears, even when the stash
// was for a different screen, so a stale preview cannot surface later on the wrong one.
export function takePreviewLayout(profileId) {
  try {
    const raw = sessionStorage.getItem(PREVIEW_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(PREVIEW_KEY);
    const parsed = JSON.parse(raw);
    return parsed && parsed.profileId === profileId ? parsed.layout : null;
  } catch { return null; }
}
