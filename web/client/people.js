// people.js — the PERSON layer's surface: who am I setting this up for?
//
//   Account -> Person -> { Screens, Bindings, Output routing }
//                 ^ a DEVICE is cross-cutting: merely where a person is right now.
//
// WHY THIS EXISTS. Before it, everything hung off the ACCOUNT — the thing that signs in.
// That is fine while an account is one person, and wrong the moment it is not: an OT with
// four residents had one set of input bindings shared between them, and "whose screen is
// this?" had no answer at all. Bindings and output routing describe a BODY. They belong to
// a person, and a person is not an account.
//
// THE SIMPLIFICATION THAT MADE IT CHEAP: A SCREEN IMPLIES ITS PERSON. The kiosk is opened
// as kiosk.html?profile=<id>, and a screen now names its person — so the kiosk needs no
// person-selection step, and a device shared between two people in a day room needs no
// device-side UI whatsoever. You open a screen; the screen says whose it is. This picker
// therefore exists ONLY on the home side, where a moderator chooses who they are
// configuring, and never on the thing at the bedside.
//
// NOBODY MEETS THE CONCEPT UNTIL THEY NEED IT. An account always has at least one person,
// created for it on first ask. With exactly one, this bar renders as a single quiet line —
// no chips, no picker, nothing to learn — and only becomes a chooser when a second person
// exists. A product that opens by asking a grieving family to model an ontology is a
// product nobody finishes signing up for.
//
// WHY "PERSON" AND NOT "USER". The server's `user_id` column means the ACCOUNT and always
// has; overloading the word in the UI too would guarantee permanent confusion. "Person" is
// also the field's own word — Matching Person & Technology — and it is what gets said out
// loud in a room with the person in it, which is the test Mike applies to this vocabulary.

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Which person a moderator was last configuring. Per browser, not per account: it is a
// convenience for whoever is sitting here, not a fact about anybody's setup, so it must
// never be the thing a binding is actually keyed by.
export const LAST_PERSON_KEY = 'nimrod:last-person';

// PURE. The person to show, given what exists and what was last chosen. A remembered id
// that no longer resolves — someone deleted that person, or this is a different account on
// a shared browser — must fall back rather than leave the page addressing a ghost, which
// would 404 every save.
export function pickCurrent(list, wantedId) {
  const people = Array.isArray(list) ? list.filter((p) => p && p.id) : [];
  if (!people.length) return null;
  return people.find((p) => p.id === wantedId) || people[0];
}

export function readLastPerson(storage = globalThis.localStorage) {
  try { return storage.getItem(LAST_PERSON_KEY) || ''; } catch { return ''; }
}

export function writeLastPerson(id, storage = globalThis.localStorage) {
  try { storage.setItem(LAST_PERSON_KEY, String(id || '')); } catch { /* private mode */ }
}

// The bar itself. `onChange(person)` fires whenever the current person changes — including
// once on mount, so the caller never has to duplicate the pick logic.
//
// `storage` is injectable so the test can run several independent bars without them
// fighting over one real localStorage key.
export function mountPeople(root, { profiles, onChange = null, storage = globalThis.localStorage } = {}) {
  let list = [];
  let current = null;
  let busy = false;
  let editing = false;

  root.innerHTML = '<div class="p-bar" data-bar></div>';
  const bar = root.querySelector('[data-bar]');

  // home.js remounts panels onto the same element, so listeners hung on `root` would
  // outlive the bar that added them — one dead handler per visit. Same fix as inputs.js.
  const listeners = new AbortController();
  const on = (type, fn) => root.addEventListener(type, fn, { signal: listeners.signal });

  const say = (text, bad = false) => {
    const el = root.querySelector('[data-msg]');
    if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('bad', !!bad);
  };

  function render() {
    const many = list.length > 1;
    // ONE PERSON: a sentence, not a control. TWO OR MORE: a chooser. The difference is
    // the whole reason this is bearable for a family and still works for a clinic.
    const who = many
      ? `<div class="p-chips">${list.map((p) => `
          <button class="p-chip${p.id === (current || {}).id ? ' on' : ''}" data-person="${esc(p.id)}"
                  aria-pressed="${p.id === (current || {}).id}">${esc(p.name)}</button>`).join('')}
         </div>`
      : `<span class="p-one">Setting up for <b>${esc((current || {}).name || '…')}</b></span>`;

    bar.innerHTML = `
      <div class="p-row">
        ${many ? '<span class="p-lead">Setting up for</span>' : ''}
        ${who}
        <div class="p-tools">
          <button class="h-btn p-small" data-edit>${editing ? 'Done' : 'Manage people'}</button>
        </div>
      </div>
      ${editing ? `
        <div class="p-manage">
          <p class="h-hint">A <b>person</b> is who a screen is for. Their screens, their input
            bindings and their output routing follow them to every device — set them up once,
            ever. The account is who signs in; it can hold as many people as you look after.</p>
          <form class="h-new" data-new>
            <input type="text" data-name placeholder="Add a person (e.g. Christine)"
                   aria-label="new person name" maxlength="64" required>
            <button type="submit" class="h-btn h-primary">Add</button>
          </form>
          <ul class="p-list">
            ${list.map((p) => `
              <li>
                <input type="text" class="p-name" value="${esc(p.name)}" maxlength="64"
                       data-rename="${esc(p.id)}" aria-label="name">
                <button class="h-btn h-danger p-small" data-remove="${esc(p.id)}"
                        ${list.length <= 1 ? 'disabled title="an account needs at least one person"' : ''}
                >Remove</button>
              </li>`).join('')}
          </ul>
          <div class="h-msg" data-msg></div>
        </div>` : ''}`;
  }

  function setCurrent(person, notify = true) {
    current = person;
    if (person) writeLastPerson(person.id, storage);
    render();
    if (notify && onChange) onChange(person);
  }

  async function refresh({ notify = true, want = null } = {}) {
    list = await profiles.people();
    const next = pickCurrent(list, want || (current && current.id) || readLastPerson(storage));
    // Only tell the caller when the PERSON changed. A rename must not tear down and
    // remount every panel underneath — someone mid-way through binding a switch would
    // lose the capture they were running.
    const changed = !current || !next || next.id !== current.id;
    current = next;
    if (next) writeLastPerson(next.id, storage);
    render();
    if (notify && changed && onChange) onChange(next);
    return next;
  }

  async function guard(fn) {
    if (busy) return;
    busy = true;
    try { await fn(); }
    catch (e) { say(e.message || 'that did not work', true); console.error(e); }
    finally { busy = false; }
  }

  on('click', (e) => {
    const chip = e.target.closest('[data-person]');
    if (chip) {
      const person = list.find((p) => p.id === chip.dataset.person);
      if (person && person.id !== (current || {}).id) setCurrent(person);
      return;
    }
    if (e.target.closest('[data-edit]')) { editing = !editing; render(); return; }

    const rm = e.target.closest('[data-remove]');
    if (rm) {
      const person = list.find((p) => p.id === rm.dataset.remove);
      if (!person) return;
      // The server refuses if they still have screens, and refuses the last person. Both
      // come back as a sentence, so the confirm here is about intent, not validation.
      if (!globalThis.confirm(`Remove ${person.name}? Their input bindings and output routing go with them.`)) return;
      guard(async () => {
        await profiles.removePerson(person.id);
        await refresh();
        say(`Removed ${person.name}.`);
      });
    }
  });

  // Rename autosaves on blur. NO SAVE BUTTON — the composer and the binder both settled
  // this already, and a name that silently did not stick is worse here than anywhere,
  // because the name is how a moderator tells two people's setups apart.
  on('change', (e) => {
    const field = e.target.closest('[data-rename]');
    if (!field) return;
    const id = field.dataset.rename;
    const name = field.value.trim();
    const person = list.find((p) => p.id === id);
    if (!person || !name || name === person.name) { if (person) field.value = person.name; return; }
    guard(async () => {
      await profiles.renamePerson(id, name);
      await refresh();
      say(`Renamed to ${name}.`);
    });
  });

  on('submit', (e) => {
    const form = e.target.closest('[data-new]');
    if (!form) return;
    e.preventDefault();
    const field = form.querySelector('[data-name]');
    const name = field.value.trim();
    if (!name) return;
    guard(async () => {
      const person = await profiles.addPerson(name);
      field.value = '';
      // Switch to whoever was just added. Adding a person is only ever the first step of
      // setting them up, so landing anywhere else means an immediate second click.
      await refresh({ want: person.id });
      say(`Added ${name}.`);
    });
  });

  return {
    refresh,
    current: () => current,
    list: () => list.slice(),
    destroy() { listeners.abort(); },
  };
}
