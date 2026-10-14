// screen_permissions.js — WHO MAY CALL, SEE, DROP IN, BRING OTHERS IN AND USE THE INTERCOM, AND THE GUARDIAN SET.
//
// The client's half of server/screen_access.py, which has the whole argument. In short:
//   * A CALL WAITS FOR SOMEBODY TO ANSWER, BY DEFAULT (Mike, 2026-10-12). "May drop in" - the call answers by itself -
//     is an option designed with people who can't answer their own calls in mind, ticked for NAMED people here.
//   * A CALL IS ONLY A CALL (Mike, 2026-10-14, note BX): calling grants no drive and no see. "May call" is its own tick;
//     somebody can be allowed to call without being allowed to control the screen (a CALL-ONLY grant, made here), and
//     anybody's calling can be switched off. An existing drive grant keeps calling by default, so nobody is cut off.
//   * BRINGING OTHER PEOPLE INTO A CALL IS A PERMISSION (2026-10-13): "May bring others into a call".
//   * THE INTERCOM is its own permission, separate from calls (2026-10-13): "May use the intercom".
//   * THE QUIET CHECK-IN is its own permission too (2026-10-14, checkin.js): "May check in quietly" - the owner and the
//     guardian set by default, nobody else until ticked. Its three settings are offered here, beside it.
//   * "WHO MAY SEE THIS SCREEN" is its own tick, EMPTY TO START, with "ASK FIRST" ON by default.
//   * THE GUARDIAN SET is a bundle of the separate permissions - see without asking, drop in, call, bring others in, the
//     intercom, and drive - each still changeable per person. Drive is a real drive grant, made when the set is given.
//   * THE OWNER controls every screen on their own account by default (2026-10-14), drop-in included; each untickable.
//   * DURING A CALL the screen can lend "see" and "drive" to the caller: until the call ends (the default), a set time
//     that still ends with the call, or "always" for a caller with the guardian set (a real grant, shown here).
//
// THE LIST lives on the person's own row (`screenPeople`, beside the intercom's older `intercomAllowed` and the note
// writers' `noteWriters`) - only the person's owner can write that row, which is what lets the server and the screen
// read it as a permission. A switch not set takes its default; the table is in screen_access.py and `permsFor` below
// mirrors it (screen_permissions_test.html checks the two agree on every case the server's test names).

import { CHECKIN_FIELDS, checkInOptionsFrom } from './checkin_options.js';

export const LIST_FIELD = 'screenPeople';
export const INTERCOM_LIST_FIELD = 'intercomAllowed';
export const MAX_PEOPLE = 50;
const MAX_NAME = 60;

// The timings, each a setting on the person's row with a default. The arguments are where the server declares them
// (screen_access.py ASK_CHOICES / LEND_CHOICES); the drop-in countdown's is here, since only the screen counts it.
export const ASK_FIELD = 'seeAskSeconds';
export const ASK_CHOICES = Object.freeze([15, 30, 60]);
export const ASK_DEFAULT_S = 30;
// The OLD "a lent see lasts at most N minutes" (2026-10-12). Still read so an older screen keeps working; the editor
// now offers LENGTH_FIELD instead.
export const LEND_FIELD = 'lendMinutes';
export const LEND_CHOICES = Object.freeze([15, 30, 60, 120]);
export const LEND_DEFAULT_MIN = 60;
// HOW LONG WHAT THE SCREEN LENDS DURING A CALL LASTS, offered first (Mike, 2026-10-13: "options, default the length of
// the call, plus 'always' for parents/guardians"). 'call' = until the call ends; a number = that many minutes, and it
// still ends with the call; 'always' = a real grant, for a caller with the guardian set only (never a default here).
export const LENGTH_FIELD = 'lendLength';
export const LENGTH_DEFAULT = 'call';
export const LENGTH_CHOICES = Object.freeze(['call', 15, 30, 60, 120]);
// *** HOW LONG A SCREEN WITH NO CALL PANEL COUNTS DOWN BEFORE A DROP-IN CALL ANSWERS: 10 SECONDS BY DEFAULT. *** The
// same ten seconds the Call panel's own countdown has always used (call.js `declineSeconds`), argued there: long enough
// to say who is calling out loud and for somebody in the room to press Decline, short enough that the caller is not left
// hanging. 0 answers at once (a screen nobody in the room minds); 20 for a room where people are slower to reach it.
export const DROP_IN_FIELD = 'dropInSeconds';
export const DROP_IN_CHOICES = Object.freeze([0, 10, 20]);
export const DROP_IN_DEFAULT_S = 10;

const SWITCHES = ['guardian', 'see', 'seeAsk', 'dropIn', 'call', 'bringOthers', 'intercom', 'checkIn'];

const clean = (s) => String(s == null ? '' : s).replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, MAX_NAME);
const shortName = (account) => String(account || '').split('@')[0] || String(account || '');

/** The list on a person's row, cleaned. A switch that is not a real true/false is dropped (its default), never yes. */
export function normalizePeople(list) {
  const out = [];
  for (const e of Array.isArray(list) ? list.slice(0, MAX_PEOPLE) : []) {
    const account = e && typeof e.account === 'string' ? e.account.trim() : '';
    if (!account || out.some((x) => x.account === account)) continue;
    const ent = { account, name: clean(e.name) };
    for (const k of SWITCHES) if (typeof e[k] === 'boolean') ent[k] = e[k];
    out.push(ent);
  }
  return out;
}

const onIntercomList = (row, account) => Array.isArray(row && row[INTERCOM_LIST_FIELD])
  && row[INTERCOM_LIST_FIELD].some((e) => e && e.account === account);

/**
 * What `account` may do on these screens, from the row alone. `owner`: the account that owns the person, if known.
 * `reach`: they hold a live grant (a drive grant or a call-only one) - what "May call" defaults to for anybody else.
 */
export function permsFor(row, account, owner = null, { reach = false } = {}) {
  const none = { guardian: false, see: false, askFirst: true, dropIn: false, call: false, bringOthers: false,
                 intercom: false, checkIn: false, listed: false };
  if (!account) return none;
  const ent = normalizePeople(row && row[LIST_FIELD]).find((x) => x.account === account);
  const isOwner = !!owner && account === owner;
  if (!ent) {
    if (isOwner) return { guardian: false, see: true, askFirst: false, dropIn: true, call: true, bringOthers: true,
                          intercom: true, checkIn: true, listed: false };
    return { ...none, call: !!reach, intercom: onIntercomList(row, account) };
  }
  const g = ent.guardian === true;
  return {
    guardian: g,
    see: 'see' in ent ? ent.see : (g || isOwner),
    askFirst: 'seeAsk' in ent ? ent.seeAsk : !(g || isOwner),
    dropIn: 'dropIn' in ent ? ent.dropIn : (g || isOwner),
    call: 'call' in ent ? ent.call : (g || isOwner || !!reach),
    bringOthers: 'bringOthers' in ent ? ent.bringOthers : (g || isOwner),
    intercom: 'intercom' in ent ? ent.intercom : (g || isOwner || onIntercomList(row, account)),
    // THE SILENT CHECK-IN (2026-10-14, checkin.js; screen_access.may_check_in argues it): the owner and the guardian set
    // by default, nobody else until ticked.
    checkIn: 'checkIn' in ent ? ent.checkIn : (g || isOwner),
    listed: true,
  };
}

/** May a call from `account` answer by itself on this screen? `account` is the SERVER-STAMPED caller (`by`, drive.py
 *  stamp_signal) - never a name a page sent. `owner`: that account when the server said it owns these screens
 *  (`byOwner`), so the owner's own calls drop in by default (2026-10-14). No account known: no. */
export function dropInFor(row, account, owner = null) {
  return !!account && permsFor(row, account, owner).dropIn === true;
}

const pick = (row, key, choices, d) => {
  const v = row && row[key];
  return typeof v === 'number' && choices.includes(v) ? v : d;
};
export const askSecondsOf = (row) => pick(row, ASK_FIELD, ASK_CHOICES, ASK_DEFAULT_S);
export const lendMinutesOf = (row) => pick(row, LEND_FIELD, LEND_CHOICES, LEND_DEFAULT_MIN);
export const dropInSecondsOf = (row) => pick(row, DROP_IN_FIELD, DROP_IN_CHOICES, DROP_IN_DEFAULT_S);
/** The length the screen offers first when it lends something on a call: 'call' unless somebody chose a set time. */
export function lendLengthOf(row) {
  const v = row && row[LENGTH_FIELD];
  return LENGTH_CHOICES.includes(v) ? v : LENGTH_DEFAULT;
}
/** Words for a length. Pure. */
export function lengthWords(v) {
  if (v === 'call') return 'until the call ends';
  if (v === 'always') return 'always';
  if (v === 60) return 'for 1 hour';
  if (v === 120) return 'for 2 hours';
  if (Number.isInteger(v)) return `for ${v} minutes`;
  return 'until the call ends';
}

/** Turn one switch for one person; returns the new list. `guardian` resets that person's own ticks so the set's
 *  defaults show (giving or taking the set is a fresh start for them); the others set one explicit value. Pure. */
export function withSwitch(list, account, key, value, { name = '' } = {}) {
  const people = normalizePeople(list);
  let ent = people.find((x) => x.account === account);
  if (!ent) { ent = { account, name: clean(name) || shortName(account) }; people.push(ent); }
  if (key === 'guardian') {
    for (const k of SWITCHES) delete ent[k];
    if (value) ent.guardian = true;
  } else if (SWITCHES.includes(key)) {
    ent[key] = !!value;
  } else if (key === 'name') {
    ent.name = clean(value) || shortName(account);
  }
  return people;
}

// ---- the words, shared by the screen and the editor ---------------------------------------------------------------
// Mike, 2026-10-13: auto answer is described as an option designed with people who can't answer their own calls in
// mind, not as the point ("I don't expect the average user to be in a care facility").
export const CALLS_WAIT_HEAD = 'Calls wait to be answered.';
export const CALLS_WAIT_REST = 'A call rings until somebody at the screen presses Answer or Decline. “May drop in” '
  + 'lets someone’s calls answer by themselves. It is an option, designed with people who can’t answer their own calls '
  + 'in mind: tick it for someone below, or give them the guardian set.';
export const CALLS_WAIT_LINE = `${CALLS_WAIT_HEAD} ${CALLS_WAIT_REST}`;

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const isCallOnly = (g) => String(g && g.role || '').toLowerCase() === 'caller';

/**
 * Candidates, from the owner, the grants (drive and call-only) and the list itself. Pure.
 * [{ account, suggested, note, current, owner, reach, drive }]
 */
export function peopleCandidates({ owner = null, grants = [], list = [], now = new Date().toISOString() } = {}) {
  const out = [];
  if (owner) out.push({ account: owner, suggested: 'You', note: 'you own these screens and control all of them',
                        current: true, owner: true, reach: true, drive: true });
  for (const g of grants || []) {
    if (!g || (g.subject_kind && g.subject_kind !== 'account')) continue;
    const account = String(g.subject_id || '');
    if (!account) continue;
    const live = !g.expires_at || String(g.expires_at) > now;
    const until = g.expires_at ? ` until ${String(g.expires_at).slice(0, 10)}` : '';
    const have = out.find((x) => x.account === account);
    const drive = !isCallOnly(g);
    if (have) {
      // Two grants for one person (one to call, one to drive): one line, with the strongest live one.
      if (live && !have.current) Object.assign(have, { current: true, reach: true });
      if (live && drive && !have.drive) Object.assign(have, { drive: true, note: `may control these screens${until}` });
      continue;
    }
    out.push({ account, suggested: (g.label || '').trim().slice(0, 60) || shortName(account),
               note: !live ? 'their permission to use these screens has ended'
                 : drive ? `may control these screens${until}` : `may call these screens, not control them${until}`,
               current: live, owner: false, reach: live, drive: live && drive });
  }
  for (const e of normalizePeople(list)) {
    if (!out.some((x) => x.account === e.account)) {
      out.push({ account: e.account, suggested: e.name, note: 'no longer allowed to use these screens', current: false,
                 owner: false, reach: false, drive: false });
    }
  }
  return out;
}

export const CALL_DAY_CHOICES = Object.freeze([
  { days: 1, label: 'a day' },
  { days: 7, label: 'a week' },
  { days: 30, label: 'a month' },
  { days: 0, label: 'as long as I allow it' },
]);

/**
 * The editor: one block on the Remote page, under "Who may drive".
 *   state       the person's row: { get(), set(patch), subscribe?(fn) }
 *   loadGrants  () => [{ subject_id, subject_kind, label, expires_at, role }]
 *   whoami      () => the signed-in account (the owner)
 *   grantDrive  (account) => Promise: a drive grant "as long as I allow it", for the guardian set's drive
 *   grantCall   (account, { days, label }) => Promise: a CALL-ONLY grant (2026-10-14), from "Add someone who may call"
 */
export function mountScreenPermissions(root, {
  personName = '',
  state,
  loadGrants = async () => [],
  whoami = async () => null,
  grantDrive = null,
  grantCall = null,
  now = () => new Date().toISOString(),
} = {}) {
  if (!root) throw new Error('mountScreenPermissions: a root element is required');
  if (!state) throw new Error('mountScreenPermissions: the person’s row is required');
  let grants = [];
  let owner = null;
  let destroyed = false;
  const ac = new AbortController();
  const rowNow = () => state.get?.() || {};
  const list = () => normalizePeople(rowNow()[LIST_FIELD]);
  const whose = personName ? `${esc(personName)}’s screens` : 'these screens';

  function liveDriveGrant(account) {
    const t = now();
    return (grants || []).some((g) => g && g.subject_id === account && !isCallOnly(g)
      && (!g.expires_at || String(g.expires_at) > t));
  }

  function choiceRow(key, label, choices, current, words) {
    return `<label class="sp-choice">${esc(label)}
      <select data-choice="${esc(key)}">${choices.map((v) => `<option value="${esc(v)}"${v === current ? ' selected' : ''}>${
        esc(words(v))}</option>`).join('')}</select></label>`;
  }

  // THE QUIET CHECK-IN'S SETTINGS (checkin.js CHECKIN_FIELDS, each argued there): what it carries, how long it lasts,
  // and whether a press at the screen ends it. Here, beside who may do it, rather than in the screen's own menu.
  function checkInRows(row) {
    const o = checkInOptionsFrom(row);
    const [media, maxMs, onPress] = CHECKIN_FIELDS;
    const sel = (f, cur) => `<label class="sp-choice">${esc(f.label)}
      <select data-checkin="${esc(f.key)}">${f.options.map((x) => `<option value="${esc(x.value)}"${x.value === cur ? ' selected' : ''}>${
        esc(x.label)}</option>`).join('')}</select></label>`;
    return `${sel(media, o.media)}${sel(maxMs, o.maxMs)}
      <label class="sp-choice"><input type="checkbox" data-checkin="${esc(onPress.key)}"${o.endOnPress ? ' checked' : ''}> ${esc(onPress.label)}</label>`;
  }

  const tick = (k, label, on, dis) => `<label><input type="checkbox" data-switch="${k}"${on ? ' checked' : ''}${dis}> ${label}</label>`;

  function render() {
    if (destroyed) return;
    const row = rowNow();
    const people = list();
    const cands = peopleCandidates({ owner, grants, list: people, now: now() });
    root.innerHTML = `
      <div class="sp" data-screen-people-block>
        <h2 class="r-h2">Who may call, see and drop in on ${whose}</h2>
        <p class="sp-wait" data-calls-wait role="note"><b>${esc(CALLS_WAIT_HEAD)}</b> ${esc(CALLS_WAIT_REST)}</p>
        <p class="h-hint">A call is only a call: being able to call doesn’t let anyone control or see these screens.
          During a call, the screen can let the caller see it or control it, until the call ends unless it chooses a
          shorter time. “May see” lets them watch along with what the screen is playing, from their own device. With
          “Ask first”, the screen asks each time, and if nobody there answers, nothing is shared. While anyone sees it,
          the screen says “Sharing your screen with” their name. “May check in quietly” lets them look in and listen
          without the room hearing anything, to see if someone is asleep before they call; the screen shows who is
          checking in the whole time. The guardian set is everything at once (the intercom, below, too), and each part
          can still be changed. Anyone you have added may call unless you untick it; apart from that, nobody but you has
          any of these until you tick them.</p>
        ${cands.length ? `<ul class="r-list sp-list">${cands.map((c) => {
          const p = permsFor(row, c.account, owner, { reach: c.reach });
          const ent = people.find((x) => x.account === c.account);
          const dis = !c.current && !ent ? ' disabled' : '';
          return `<li data-account="${esc(c.account)}"${c.owner ? ' data-owner' : ''}>
            <b>${esc(c.owner ? 'You' : (ent?.name || c.suggested))}</b> <span class="h-hint">(${esc(c.account)}) — ${esc(c.note)}</span>
            <div class="sp-ticks">
              ${c.owner ? '' : tick('guardian', 'Guardian set', p.guardian, dis)}
              ${tick('call', 'May call', p.call, c.reach || c.owner ? dis : ' disabled')}
              ${tick('dropIn', 'May drop in (their calls answer by themselves)', p.dropIn, dis)}
              ${tick('bringOthers', 'May bring others into a call', p.bringOthers, dis)}
              ${tick('see', 'May see this screen', p.see, dis)}
              <label><input type="checkbox" data-switch="seeAsk"${p.see && p.askFirst ? ' checked' : ''}${!p.see ? ' disabled' : dis}> Ask first</label>
              ${tick('checkIn', 'May check in quietly', p.checkIn, dis)}
            </div>
            ${ent && !c.owner ? `<label class="sp-name">The screen shows them as
              <input type="text" data-name maxlength="60" value="${esc(ent.name)}"></label>` : ''}
          </li>`;
        }).join('')}</ul>`
        : '<p class="h-hint">Nobody may use these screens yet.</p>'}
        ${typeof grantCall === 'function' ? `<form class="h-new sp-add" data-call-form>
          <span class="r-lead">Add someone who may call, but not control these screens</span>
          <input type="email" data-call-subject placeholder="their sign-in email" aria-label="who may call" required>
          <select data-call-days aria-label="for how long">
            ${CALL_DAY_CHOICES.map((d) => `<option value="${d.days}"${d.days === 0 ? ' selected' : ''}>for ${esc(d.label)}</option>`).join('')}
          </select>
          <button type="submit" class="h-btn h-primary">Allow calls</button>
        </form>` : ''}
        <div class="sp-choices">
          ${choiceRow(ASK_FIELD, 'A question to see the screen stays up for', ASK_CHOICES, askSecondsOf(row), (v) => `${v} seconds`)}
          ${choiceRow(DROP_IN_FIELD, 'When someone who may drop in calls a screen with no Call panel, answer', DROP_IN_CHOICES, dropInSecondsOf(row),
            (v) => (v === 0 ? 'straight away' : `${v} seconds after ringing`))}
          ${choiceRow(LENGTH_FIELD, 'On a call, what the screen lets the caller see or control lasts', LENGTH_CHOICES, lendLengthOf(row), lengthWords)}
          ${checkInRows(row)}
        </div>
        <p class="h-hint">“Always” is offered on the screen during a call only for someone with the guardian set. It ticks
          “May see” or adds a permission to control these screens, here, where you can take it back.</p>
        <p class="r-msg" data-msg role="status"></p>
      </div>`;
  }
  const say = (t) => { const m = root.querySelector('[data-msg]'); if (m) m.textContent = t || ''; };

  function write(patch, msg) {
    try {
      const r = state.set(patch);
      Promise.resolve(r).then(() => { render(); say(msg); }, (err) => { console.error('screen permissions', err); say('Could not save that.'); });
    } catch (err) { console.error('screen permissions', err); say('Could not save that.'); }
  }

  async function reloadGrants() {
    try { grants = (await loadGrants()) || []; } catch { /* keep what we had */ }
  }

  root.addEventListener('submit', async (e) => {
    if (!e.target.matches('[data-call-form]')) return;
    e.preventDefault();
    const who = String(root.querySelector('[data-call-subject]')?.value || '').trim();
    const days = Number(root.querySelector('[data-call-days]')?.value || 0);
    if (!who || typeof grantCall !== 'function') return;
    try {
      await grantCall(who, { days });
      await reloadGrants();
      render();
      say(`${who} may call ${personName ? `${personName}’s screens` : 'these screens'} now. They can’t control or see them unless the screen allows it during a call.`);
    } catch (err) { say(String(err?.message || err || 'Could not add them.')); }
  }, { signal: ac.signal });

  root.addEventListener('change', async (e) => {
    const t = e.target;
    if (t.matches('[data-checkin]')) {
      const key = t.dataset.checkin;
      const v = t.type === 'checkbox' ? !!t.checked : (key === 'checkInMaxMs' ? Number(t.value) : t.value);
      write({ [key]: v }, 'Saved.');
      return;
    }
    if (t.matches('[data-choice]')) {
      const key = t.dataset.choice;
      const v = t.value;
      write({ [key]: key === LENGTH_FIELD && v === 'call' ? 'call' : Number(v) }, 'Saved.');
      return;
    }
    const li = t.closest('[data-account]');
    if (!li) return;
    const account = li.dataset.account;
    const cand = peopleCandidates({ owner, grants, list: list(), now: now() }).find((x) => x.account === account);
    const name = cand?.owner ? 'You' : (cand?.suggested || shortName(account));
    if (t.matches('[data-name]')) {
      write({ [LIST_FIELD]: withSwitch(list(), account, 'name', t.value, { name }) }, 'Saved.');
      return;
    }
    if (!t.matches('[data-switch]')) return;
    const key = t.dataset.switch;
    const on = !!t.checked;
    const next = withSwitch(list(), account, key, on, { name });
    if (key === 'guardian' && on) {
      // The set's drive part is a real drive grant. Made only if there is no live one; one that exists is left alone.
      let drove = liveDriveGrant(account);
      if (!drove && typeof grantDrive === 'function') {
        try { await grantDrive(account); drove = true; await reloadGrants(); } catch (err) { console.error('screen permissions: drive', err); }
      }
      write({ [LIST_FIELD]: next }, drove
        ? 'Guardian set given. They can call, drop in, bring others in, use the intercom, check in quietly, see without asking, and drive.'
        : 'Guardian set given, except driving: their permission to drive could not be added. Add it under “Who may drive”.');
      return;
    }
    if (key === 'guardian') {
      write({ [LIST_FIELD]: next }, 'Guardian set taken away. Their permission to drive stays until you take it back above.');
      return;
    }
    const words = {
      call: on ? 'They may call these screens.' : 'They can no longer call these screens.',
      see: on ? 'They may see this screen now.' : 'They can no longer see this screen.',
      seeAsk: on ? 'The screen will ask first.' : 'They can see without the screen asking.',
      dropIn: on ? 'Their calls will answer by themselves.' : 'Their calls will wait to be answered.',
      bringOthers: on ? 'They may bring others into a call with these screens.' : 'They can no longer bring others into a call.',
      checkIn: on ? 'They may check in quietly. The screen shows who is checking in.' : 'They can no longer check in quietly.',
    };
    write({ [LIST_FIELD]: next }, words[key] || 'Saved.');
  }, { signal: ac.signal });

  const offSub = typeof state.subscribe === 'function' ? state.subscribe(() => render()) : null;
  render();
  const ready = (async () => {
    try { owner = await whoami(); } catch { owner = null; }
    await reloadGrants();
    render();
  })();

  return {
    ready,
    render,
    people: () => list(),
    destroy() { destroyed = true; ac.abort(); try { offSub?.(); } catch { /* gone */ } root.innerHTML = ''; },
  };
}
