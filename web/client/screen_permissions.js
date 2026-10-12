// screen_permissions.js — WHO MAY SEE THESE SCREENS, WHO MAY DROP IN ON A CALL, AND THE GUARDIAN SET (Mike, 2026-10-12).
//
// The client's half of server/screen_access.py, which has the whole argument. In short:
//   * A CALL WAITS FOR SOMEBODY TO ANSWER, BY DEFAULT (this changed the 2026-08-29 decision, where a call answered by
//     itself after a countdown). "May drop in" - the call answers by itself - is a tick given to NAMED people here.
//     "Who may drive" lets somebody call; it never lets a call answer by itself.
//   * "WHO MAY SEE THIS SCREEN" is its own list, EMPTY TO START, with "ASK FIRST" ON by default: the screen asks, and if
//     nobody answers the seeing does not start (the screen is never blocked - the question goes by itself).
//   * THE GUARDIAN SET is a bundle of the separate permissions - see without asking, drop in, drive - and each is still
//     changeable per person. Giving it changes that person's DEFAULTS; drive is a real drive grant, made here when the
//     set is given and there is none.
//
// THE LIST lives on the person's own row (`screenPeople`, beside the intercom's `intercomAllowed` and the note writers'
// `noteWriters`) - only the person's owner can write that row, which is what lets the server and the screen read it as
// a permission. A switch not set takes its default; the table is in screen_access.py and `permsFor` below mirrors it
// (screen_permissions_test.html checks the two agree on every case the server's test names).

export const LIST_FIELD = 'screenPeople';
export const MAX_PEOPLE = 50;
const MAX_NAME = 60;

// The timings, each a setting on the person's row with a default. The arguments are where the server declares them
// (screen_access.py ASK_CHOICES / LEND_CHOICES); the drop-in countdown's is here, since only the screen counts it.
export const ASK_FIELD = 'seeAskSeconds';
export const ASK_CHOICES = Object.freeze([15, 30, 60]);
export const ASK_DEFAULT_S = 30;
export const LEND_FIELD = 'lendMinutes';
export const LEND_CHOICES = Object.freeze([15, 30, 60, 120]);
export const LEND_DEFAULT_MIN = 60;
// *** HOW LONG A SCREEN WITH NO CALL PANEL COUNTS DOWN BEFORE A DROP-IN CALL ANSWERS: 10 SECONDS BY DEFAULT. *** The
// same ten seconds the Call panel's own countdown has always used (call.js `declineSeconds`), argued there: long enough
// to say who is calling out loud and for somebody in the room to press Decline, short enough that the caller is not left
// hanging. 0 answers at once (a screen nobody in the room minds); 20 for a room where people are slower to reach it.
export const DROP_IN_FIELD = 'dropInSeconds';
export const DROP_IN_CHOICES = Object.freeze([0, 10, 20]);
export const DROP_IN_DEFAULT_S = 10;

const SWITCHES = ['guardian', 'see', 'seeAsk', 'dropIn'];

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

/** What `account` may do on these screens, from the row alone. `owner`: the account that owns the person, if known. */
export function permsFor(row, account, owner = null) {
  const none = { guardian: false, see: false, askFirst: true, dropIn: false, listed: false };
  if (!account) return none;
  const ent = normalizePeople(row && row[LIST_FIELD]).find((x) => x.account === account);
  const isOwner = !!owner && account === owner;
  if (!ent) return isOwner ? { guardian: false, see: true, askFirst: false, dropIn: false, listed: false } : none;
  const g = ent.guardian === true;
  return {
    guardian: g,
    see: 'see' in ent ? ent.see : (g || isOwner),
    askFirst: 'seeAsk' in ent ? ent.seeAsk : !(g || isOwner),
    dropIn: 'dropIn' in ent ? ent.dropIn : g,
    listed: true,
  };
}

/** May a call from `account` answer by itself on this screen? `account` is the SERVER-STAMPED caller (`by`, drive.py
 *  stamp_signal) - never a name a page sent. No account known: no. */
export function dropInFor(row, account) {
  return !!account && permsFor(row, account).dropIn === true;
}

const pick = (row, key, choices, d) => {
  const v = row && row[key];
  return typeof v === 'number' && choices.includes(v) ? v : d;
};
export const askSecondsOf = (row) => pick(row, ASK_FIELD, ASK_CHOICES, ASK_DEFAULT_S);
export const lendMinutesOf = (row) => pick(row, LEND_FIELD, LEND_CHOICES, LEND_DEFAULT_MIN);
export const dropInSecondsOf = (row) => pick(row, DROP_IN_FIELD, DROP_IN_CHOICES, DROP_IN_DEFAULT_S);

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
export const CALLS_WAIT_HEAD = 'Calls now wait to be answered.';
export const CALLS_WAIT_REST = 'A call rings until somebody at the screen presses Answer or Decline. To let someone’s '
  + 'calls answer by themselves, tick “May drop in” for them below, or give them the guardian set.';
export const CALLS_WAIT_LINE = `${CALLS_WAIT_HEAD} ${CALLS_WAIT_REST}`;

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/**
 * Candidates, from the owner, the drive grants and the list itself. Pure.
 * [{ account, suggested, note, current, owner }]
 */
export function peopleCandidates({ owner = null, grants = [], list = [], now = new Date().toISOString() } = {}) {
  const out = [];
  if (owner) out.push({ account: owner, suggested: 'You', note: 'you (you own these screens)', current: true, owner: true });
  for (const g of grants || []) {
    if (!g || (g.subject_kind && g.subject_kind !== 'account')) continue;
    const account = String(g.subject_id || '');
    if (!account || out.some((x) => x.account === account)) continue;
    const live = !g.expires_at || String(g.expires_at) > now;
    out.push({ account, suggested: (g.label || '').trim().slice(0, 60) || shortName(account),
               note: live ? (g.expires_at ? `may drive and call until ${String(g.expires_at).slice(0, 10)}` : 'may drive and call')
                 : 'their permission to drive and call has ended',
               current: live, owner: false });
  }
  for (const e of normalizePeople(list)) {
    if (!out.some((x) => x.account === e.account)) {
      out.push({ account: e.account, suggested: e.name, note: 'no longer allowed to use these screens', current: false, owner: false });
    }
  }
  return out;
}

/**
 * The editor: one block on the Remote page, under "Who may drive".
 *   state       the person's row: { get(), set(patch), subscribe?(fn) }
 *   loadGrants  () => [{ subject_id, subject_kind, label, expires_at }]
 *   whoami      () => the signed-in account (the owner)
 *   grantDrive  (account) => Promise: a drive grant "as long as I allow it", for the guardian set's drive
 */
export function mountScreenPermissions(root, {
  personName = '',
  state,
  loadGrants = async () => [],
  whoami = async () => null,
  grantDrive = null,
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

  function liveGrant(account) {
    const t = now();
    return (grants || []).some((g) => g && g.subject_id === account && (!g.expires_at || String(g.expires_at) > t));
  }

  function choiceRow(key, label, choices, current, unit) {
    return `<label class="sp-choice">${esc(label)}
      <select data-choice="${esc(key)}">${choices.map((v) => `<option value="${v}"${v === current ? ' selected' : ''}>${
        v === 0 ? 'straight away' : `${v} ${unit}`}</option>`).join('')}</select></label>`;
  }

  function render() {
    if (destroyed) return;
    const row = rowNow();
    const people = list();
    const cands = peopleCandidates({ owner, grants, list: people, now: now() });
    root.innerHTML = `
      <div class="sp" data-screen-people-block>
        <h2 class="r-h2">Who may see ${whose}, and whose calls answer by themselves</h2>
        <p class="sp-wait" data-calls-wait role="note"><b>${esc(CALLS_WAIT_HEAD)}</b> ${esc(CALLS_WAIT_REST)}</p>
        <p class="h-hint">“May see” lets them watch along with what the screen is playing, from their own computer.
          With “Ask first”, the screen asks each time, and if nobody there answers, nothing is shared. While anyone
          sees it, the screen says “Sharing your screen with” their name. The guardian set is all three at once: see
          without asking, drop in, and drive. Each one can still be changed on its own. Nobody is on this list until
          you tick them.</p>
        ${cands.length ? `<ul class="r-list sp-list">${cands.map((c) => {
          const p = permsFor(row, c.account, owner);
          const ent = people.find((x) => x.account === c.account);
          const dis = !c.current && !ent ? ' disabled' : '';
          return `<li data-account="${esc(c.account)}">
            <b>${esc(c.owner ? 'You' : (ent?.name || c.suggested))}</b> <span class="h-hint">(${esc(c.account)}) — ${esc(c.note)}</span>
            <div class="sp-ticks">
              ${c.owner ? '' : `<label><input type="checkbox" data-switch="guardian"${p.guardian ? ' checked' : ''}${dis}> Guardian set</label>`}
              <label><input type="checkbox" data-switch="see"${p.see ? ' checked' : ''}${dis}> May see this screen</label>
              <label><input type="checkbox" data-switch="seeAsk"${p.see && p.askFirst ? ' checked' : ''}${!p.see ? ' disabled' : dis}> Ask first</label>
              <label><input type="checkbox" data-switch="dropIn"${p.dropIn ? ' checked' : ''}${dis}> May drop in (their calls answer by themselves)</label>
            </div>
            ${ent && !c.owner ? `<label class="sp-name">The screen shows them as
              <input type="text" data-name maxlength="60" value="${esc(ent.name)}"></label>` : ''}
          </li>`;
        }).join('')}</ul>`
        : '<p class="h-hint">Nobody may use these screens yet. Add someone under “Who may drive” first.</p>'}
        <div class="sp-choices">
          ${choiceRow(ASK_FIELD, 'A question to see the screen stays up for', ASK_CHOICES, askSecondsOf(row), 'seconds')}
          ${choiceRow(DROP_IN_FIELD, 'When someone who may drop in calls a screen with no Call panel, answer', DROP_IN_CHOICES, dropInSecondsOf(row), 'seconds after ringing')}
          ${choiceRow(LEND_FIELD, '“See this screen” given during a call lasts at most', LEND_CHOICES, lendMinutesOf(row), 'minutes')}
        </div>
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

  root.addEventListener('change', async (e) => {
    const t = e.target;
    if (t.matches('[data-choice]')) {
      const key = t.dataset.choice;
      write({ [key]: Number(t.value) }, 'Saved.');
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
      // The set's third part is a real drive grant. Made only if there is no live one; one that exists is left alone.
      let drove = liveGrant(account);
      if (!drove && typeof grantDrive === 'function') {
        try { await grantDrive(account); drove = true; } catch (err) { console.error('screen permissions: drive', err); }
      }
      write({ [LIST_FIELD]: next }, drove
        ? 'Guardian set given. They can see without asking, drop in, and drive.'
        : 'Guardian set given for seeing and drop-in. Their permission to drive could not be added; add it under “Who may drive”.');
      return;
    }
    if (key === 'guardian') {
      write({ [LIST_FIELD]: next }, 'Guardian set taken away. Their permission to drive stays until you take it back above.');
      return;
    }
    const words = {
      see: on ? 'They may see this screen now.' : 'They can no longer see this screen.',
      seeAsk: on ? 'The screen will ask first.' : 'They can see without the screen asking.',
      dropIn: on ? 'Their calls will answer by themselves.' : 'Their calls will wait to be answered.',
    };
    write({ [LIST_FIELD]: next }, words[key] || 'Saved.');
  }, { signal: ac.signal });

  const offSub = typeof state.subscribe === 'function' ? state.subscribe(() => render()) : null;
  render();
  const ready = (async () => {
    try { owner = await whoami(); } catch { owner = null; }
    try { grants = (await loadGrants()) || []; } catch { grants = []; }
    render();
  })();

  return {
    ready,
    render,
    people: () => list(),
    destroy() { destroyed = true; ac.abort(); try { offSub?.(); } catch { /* gone */ } root.innerHTML = ''; },
  };
}
