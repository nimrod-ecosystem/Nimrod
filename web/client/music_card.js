// music_card.js — A PERSON'S MUSIC FAVOURITES, ON THE MEDIA PAGE (row 2.246-2.247, note FT 2; proposal_playlists_background,
// gated: "a Music favourites card on the Media page that edits the person's list and names whose it is. Not a preset type.").
//
// Mike: *"I shouldn't have to add it twice."* The favourites already belong to a PERSON, not a panel
// (music_favourites.js "the list does not belong to a panel"): every Music panel on that person's screens shows the same list.
// What was missing was a place to see and keep that list that is not inside one panel. This is it: the same list, through
// the same `watchFavourites` handle the panels use, so a change here is on every one of their Music panels, and a change
// there shows here. YouTube, Spotify and Internet Archive links, by the same `parseSource` the panel's form uses; a folder
// song is added in a Music panel (it needs that screen's connected folders).

import { watchFavourites, normalizeFavourite, parseSource, describeSource, MAX_NAME } from './music_favourites.js';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** The card into `host`: `{ destroy }`. `makePersonState(pid, key)` and `personId` as a Music panel has them. */
export function mountMusicCard(host, { makePersonState = null, personId = null, whose = '' } = {}) {
  if (!host) return { destroy() {} };
  const fav = watchFavourites({ makePersonState, personId, onChange: () => render() });
  let note = '';
  function render() {
    if (!fav) {
      host.innerHTML = `<div class="h-card" data-music-card><div class="h-card-head"><h2>Music favorites</h2></div>
        <p class="h-quiet">Music favorites belong to a person. Choose whose screens these are, and their list shows here.</p></div>`;
      return;
    }
    const list = fav.list();
    host.innerHTML = `<div class="h-card" data-music-card>
      <div class="h-card-head"><h2>Music favorites${whose ? ` for ${esc(whose)}` : ''}</h2></div>
      <p class="h-quiet">One list${whose ? ` for ${esc(whose)}` : ''}: every Music panel on their screens plays from it, and “computer please play”
        and a name works with any of them. Change it here or in any of those panels.</p>
      ${list.length ? `<ul class="h-list" data-music-list>${list.map((f) => `<li><b>${esc(f.name)}</b> · ${esc(describeSource(f.source))}
        <button type="button" class="h-btn h-small" data-music-remove="${esc(f.id)}">Remove</button></li>`).join('')}</ul>`
        : '<p class="h-quiet" data-music-empty>None yet.</p>'}
      <form class="h-new" data-music-add>
        <input type="text" data-music-name maxlength="${MAX_NAME}" placeholder="Name to say (for example the Beatles)" aria-label="Name to say" required>
        <input type="text" data-music-link placeholder="A YouTube, Spotify or Internet Archive link" aria-label="Its link" required>
        <button type="submit" class="h-btn">Add</button>
      </form>
      <p class="h-quiet">Music on a connected folder is added in a Music panel, where that screen's folders are.</p>
      ${note ? `<p class="h-msg" data-music-note>${esc(note)}</p>` : ''}
    </div>`;
  }
  const onClick = (e) => {
    const b = e.target?.closest?.('[data-music-remove]');
    if (!b || !fav) return;
    fav.set(fav.list().filter((f) => f.id !== b.getAttribute('data-music-remove')));
    note = '';
  };
  const onSubmit = (e) => {
    if (!e.target?.matches?.('[data-music-add]') || !fav) return;
    e.preventDefault();
    const name = String(host.querySelector('[data-music-name]')?.value || '').trim();
    const source = parseSource(String(host.querySelector('[data-music-link]')?.value || '').trim());
    if (!source) { note = 'That link is not a YouTube, Spotify or Internet Archive address this can play.'; render(); return; }
    const f = normalizeFavourite({ name, source });
    if (!f) { note = 'It needs a name to say.'; render(); return; }
    if (fav.list().some((x) => x.name.toLowerCase() === f.name.toLowerCase())) { note = `“${f.name}” is already on the list.`; render(); return; }
    note = `Added “${f.name}”.`;
    fav.set([...fav.list(), f]);
  };
  host.addEventListener('click', onClick);
  host.addEventListener('submit', onSubmit);
  render();
  return {
    ready: fav ? fav.ready : Promise.resolve(),
    destroy() { host.removeEventListener('click', onClick); host.removeEventListener('submit', onSubmit); try { fav?.destroy?.(); } catch { /* gone */ } },
  };
}
