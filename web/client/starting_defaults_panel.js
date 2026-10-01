// starting_defaults_panel.js — THE PICKER FOR starting_defaults.js: a level, the boxes, an age
// band, a plain-words preview, and the buttons that apply, put back, and (only after a warning)
// save online. MIKE_CHANGE_LIST.md rows 2.43 + 2.48.
//
// SWITCH-REACHABLE, the same contract `settings_fields.js` states for the menu: every control is a
// real <button> (so a pointer and a keyboard work as they always do), AND the host can drive the
// whole panel with the bus's three verbs - `next()` / `prev()` move a cursor through the enabled
// buttons and WRAP, `select()` presses the one under it. Boxes are toggle buttons (aria-pressed),
// not bare checkboxes, and the level and age are choices that cycle and wrap - one switch only
// travels one way, so nothing may strand it at an end.
//
// A DISABLED control is shown with its reason and is not a cursor stop (a missing row sends people
// hunting for something that was never there; a stop that does nothing wastes a press).
//
// THE ONLINE WARNING is not a gate somebody can get stuck behind: while it is open its own two
// buttons are the only stops, and one of them is always "No, keep it on this device".
//
// THIS FILE NEVER WRITES SETTINGS. It writes the device record (the layer that sits UNDER the
// settings) and tells the host through `onChange(layer)`; the host decides how it reads it
// (`withStartingDefaults`). Online is written only by `saveOnline`, only after "Yes".

import {
  CONDITIONS, LEVEL_OPTIONS, AGE_BANDS, DEVICE_NOTE, ONLINE_WARNING,
  defaultsFor, planChanges, describePlan, saveOnline, conflictQuestion,
} from './starting_defaults.js';

export function mountStartingDefaults(host, {
  store,
  library = null,
  getCurrent = () => ({}),
  onChange = () => {},
  conditions = CONDITIONS,
  doc = (host && host.ownerDocument) || document,
} = {}) {
  if (!host) throw new Error('mountStartingDefaults: host is required');
  if (!store) throw new Error('mountStartingDefaults: store is required');

  const stored = store.get().answers;
  const copy = (a) => ({ level: a.level, conditions: a.conditions.slice(), age: a.age, resolved: { ...(a.resolved || {}) } });
  let answers = copy(stored);
  const resultNow = () => defaultsFor(answers, { conditions });
  let warningOpen = false;
  let includeAnswers = false;
  let cursorEl = null;

  const el = (tag, cls, text) => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const button = (act, text, id) => {
    const b = el('button', `sd-btn sd-${act}`, text);
    b.type = 'button';
    b.dataset.act = act;
    if (id) b.dataset.id = id;
    return b;
  };

  const root = el('section', 'sd-panel');
  root.setAttribute('aria-label', 'Starting settings');
  root.append(el('h2', 'sd-title', 'Starting settings'));
  root.append(el('p', 'sd-intro',
    'Pick what fits. These only fill in settings nobody has chosen yet. They never lock anything, and you can put them back.'));

  const levelBtn = button('level', '');
  const levelRow = el('div', 'sd-row'); levelRow.append(levelBtn);
  root.append(levelRow);

  const boxes = el('fieldset', 'sd-boxes');
  boxes.append(el('legend', 'sd-legend', 'Tick every one that fits'));
  const boxBtns = new Map();
  for (const c of conditions) {
    const b = button('condition', '', c.id);
    b.setAttribute('aria-pressed', 'false');
    const name = el('span', 'sd-box-label', c.label);
    const aka = c.aka && c.aka.toLowerCase() !== c.label.toLowerCase() ? el('span', 'sd-box-aka', ` (${c.aka})`) : null;
    const tag = c.status === 'published' ? null : el('span', 'sd-box-tbf', ' - starting settings to be filled');
    b.append(el('span', 'sd-box-mark', ''), name);
    if (aka) b.append(aka);
    if (tag) b.append(tag);
    boxBtns.set(c.id, b);
    boxes.append(b);
  }
  root.append(boxes);

  const ageBtn = button('age', '');
  const ageRow = el('div', 'sd-row'); ageRow.append(ageBtn);
  root.append(ageRow);

  // TWO BOXES, TWO VALUES FOR ONE SETTING: the question, one row per setting, one button per value.
  // Rebuilt on every render (the boxes decide which questions exist). Nothing is applied until each
  // has an answer - see starting_defaults.js, "ASK, THEN LOG THE ANSWER".
  const conflictsEl = el('div', 'sd-conflicts');
  conflictsEl.setAttribute('aria-live', 'polite');
  root.append(conflictsEl);

  root.append(el('h3', 'sd-subtitle', 'What this would change'));
  const preview = el('div', 'sd-preview');
  preview.setAttribute('aria-live', 'polite');
  root.append(preview);

  const actions = el('div', 'sd-actions');
  const applyBtn = button('apply', 'Use these starting settings');
  const putBackBtn = button('putBack', 'Put back how it was');
  const onlineBtn = button('online', '');
  const forgetBtn = button('forget', 'Forget what was ticked on this device');
  actions.append(applyBtn, putBackBtn, onlineBtn, forgetBtn);
  root.append(actions);

  const deviceNote = el('p', 'sd-device-note', DEVICE_NOTE);
  root.append(deviceNote);

  const warning = el('div', 'sd-warning');
  warning.hidden = true;
  warning.setAttribute('role', 'alertdialog');
  warning.setAttribute('aria-label', 'Saving online');
  warning.append(el('p', 'sd-warning-text', ONLINE_WARNING));
  warning.append(el('p', 'sd-warning-device',
    'Keeping it on this device only means it will not follow this person to another screen.'));
  const includeBtn = button('includeAnswers', '');
  const yesBtn = button('onlineYes', 'Yes, save online');
  const noBtn = button('onlineNo', 'No, keep it on this device');
  warning.append(includeBtn, yesBtn, noBtn);
  root.append(warning);

  const status = el('p', 'sd-status', '');
  status.setAttribute('aria-live', 'polite');
  root.append(status);

  host.append(root);

  // ---------------------------------------------------------------- rendering
  const optLabel = (list, v) => (list.find((o) => o.value === v) || list[0]).label;
  const cycle = (list, v) => list[(Math.max(0, list.findIndex((o) => o.value === v)) + 1) % list.length].value;
  const hasApplied = () => (store.get().appliedAt || 0) > 0;

  function render() {
    levelBtn.textContent = `How much to show: ${optLabel(LEVEL_OPTIONS, answers.level)}`;
    ageBtn.textContent = `Age: ${optLabel(AGE_BANDS, answers.age)}`;
    for (const [id, b] of boxBtns) {
      const on = answers.conditions.includes(id);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.classList.toggle('is-on', on);
      b.querySelector('.sd-box-mark').textContent = on ? '[x] ' : '[ ] ';
    }
    const next = resultNow();
    const plan = planChanges({ current: getCurrent() || {}, oldLayer: store.layer(), next });
    conflictsEl.replaceChildren();
    for (const c of next.conflicts) {
      const q = conflictQuestion(c);
      const box = el('div', 'sd-conflict');
      box.dataset.key = q.key;
      box.append(el('p', 'sd-conflict-q', q.question));
      q.choices.forEach((ch, i) => {
        const b = button('resolve', `${ch.chosen ? '(chosen) ' : ''}${ch.label}`);
        b.dataset.key = q.key; b.dataset.i = String(i);
        b.setAttribute('aria-pressed', ch.chosen ? 'true' : 'false');
        box.append(b);
      });
      conflictsEl.append(box);
    }
    conflictsEl.hidden = !next.conflicts.length;
    const waiting = next.unanswered.length > 0;
    applyBtn.disabled = waiting;
    applyBtn.textContent = waiting ? 'Use these starting settings - answer the question above first' : 'Use these starting settings';
    preview.replaceChildren();
    const ul = el('ul', 'sd-lines');
    for (const line of describePlan(plan)) ul.append(el('li', '', line));
    preview.append(ul);

    putBackBtn.disabled = !store.canPutBack();
    forgetBtn.disabled = !store.get().answers.conditions.length && !store.get().answers.age && !store.get().answers.level;
    if (!library) {
      onlineBtn.disabled = true;
      onlineBtn.textContent = 'Save to the account (online) - not available here';
      onlineBtn.title = 'There is no account on this screen to save to.';
    } else if (!hasApplied()) {
      onlineBtn.disabled = true;
      onlineBtn.textContent = 'Save to the account (online) - use these starting settings first';
      onlineBtn.title = '';
    } else {
      onlineBtn.disabled = false;
      onlineBtn.textContent = 'Also save to the account (online)...';
      onlineBtn.title = '';
    }
    includeBtn.textContent = `Also save which boxes were ticked: ${includeAnswers ? 'Yes' : 'No'}`;
    includeBtn.setAttribute('aria-pressed', includeAnswers ? 'true' : 'false');
    warning.hidden = !warningOpen;
    deviceNote.textContent = store.persisted ? DEVICE_NOTE
      : `${DEVICE_NOTE} This browser is not keeping it: it will be gone when the page reloads.`;
    if (cursorEl && !stops().includes(cursorEl)) setCursor(null);
  }

  // ---------------------------------------------------------------- the cursor
  function stops() {
    const all = warningOpen ? [includeBtn, yesBtn, noBtn] : [...root.querySelectorAll('button')];
    return all.filter((b) => !b.disabled && !b.closest('[hidden]'));
  }
  function setCursor(b) {
    if (cursorEl) cursorEl.classList.remove('is-cursor');
    cursorEl = b;
    if (b) { b.classList.add('is-cursor'); try { b.focus({ preventScroll: false }); } catch { /* focus is a nicety */ } }
  }
  function move(dir) {
    const s = stops();
    if (!s.length) { setCursor(null); return; }
    const at = s.indexOf(cursorEl);
    const i = at < 0 ? (dir > 0 ? 0 : s.length - 1) : (at + dir + s.length) % s.length;
    setCursor(s[i]);
  }

  // ---------------------------------------------------------------- actions
  function say(text) { status.textContent = text; }
  function onClick(ev) {
    const b = ev.target.closest('button[data-act]');
    if (!b || !root.contains(b) || b.disabled) return;
    const act = b.dataset.act;
    if (act === 'level') answers = { ...answers, level: cycle(LEVEL_OPTIONS, answers.level) };
    else if (act === 'age') answers = { ...answers, age: cycle(AGE_BANDS, answers.age) };
    else if (act === 'condition') {
      const id = b.dataset.id;
      const has = answers.conditions.includes(id);
      answers = { ...answers, conditions: has ? answers.conditions.filter((x) => x !== id) : [...answers.conditions, id] };
    } else if (act === 'resolve') {
      const key = b.dataset.key; const i = Number(b.dataset.i);
      const c = resultNow().conflicts.find((x) => x.key === key);
      const ch = c ? conflictQuestion(c).choices[i] : null;
      if (ch) answers = { ...answers, resolved: { ...answers.resolved, [key]: ch.value } };
      render();
      setCursor([...root.querySelectorAll('.sd-conflicts button')]
        .find((x) => x.dataset.key === key && x.dataset.i === String(i)) || null);
      return;
    } else if (act === 'apply') {
      store.apply(resultNow());
      say(store.persisted ? 'Done. Kept on this device.' : 'Done for now - this browser will not keep it.');
      onChange(store.layer());
    } else if (act === 'putBack') {
      if (store.putBack()) {
        const a = store.get().answers;
        answers = copy(a);
        say('Put back.');
        onChange(store.layer());
      }
    } else if (act === 'forget') {
      store.forgetAnswers();
      answers = { level: '', conditions: [], age: '', resolved: {} };
      say('What was ticked is no longer kept on this device. The settings stay as they are.');
    } else if (act === 'online') {
      warningOpen = true; includeAnswers = false;
      render(); setCursor(noBtn); return;
    } else if (act === 'onlineNo') {
      warningOpen = false;
      say('Kept on this device only.');
      render(); setCursor(onlineBtn.disabled ? null : onlineBtn); return;
    } else if (act === 'includeAnswers') {
      includeAnswers = !includeAnswers;
    } else if (act === 'onlineYes') {
      warningOpen = false;
      const record = store.get();
      render();
      saveOnline({ record, library, acknowledged: true, includeAnswers })
        .then(() => { store.markSavedOnline(); say('Saved online, in the account.'); })
        .catch((e) => say(`Not saved online: ${e && e.message ? e.message : e}`));
      return;
    }
    render();
  }
  root.addEventListener('click', onClick);
  render();

  return {
    el: root,
    stops,
    cursor: () => cursorEl,
    next: () => move(1),
    prev: () => move(-1),
    select: () => { if (cursorEl && !cursorEl.disabled) cursorEl.click(); },
    refresh: render,
    answers: () => copy(answers),
    destroy() { root.removeEventListener('click', onClick); root.remove(); },
  };
}
