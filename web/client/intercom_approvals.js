// intercom_approvals.js — WHO MAY OPEN THE INTERCOM INTO A ROOM (row 2.44).
//
// The room's approved list (`intercomAllowed` on the person's row, read by intercom.js at every offer).
// Only whoever owns the person can write that row (the server's `owned_person` check on person state),
// so the list is controlled by the person or their guardian, exactly as chat's note on the row asked.
//
// WHO CAN BE ON IT: the people who may already use these screens - the owner, and anybody with a drive
// grant (remote.js "Who may drive"). Being allowed to drive does NOT put somebody on the list: it starts
// EMPTY, and each person is ticked on here. Somebody ticked here whose drive grant later lapses cannot
// open the intercom either (the socket refuses them first); they are shown as such, with Remove.
//
// THE NAME the room shows ("Intercom open: <name>") is set HERE, by the person who approves them - not
// typed by the phone. It starts as the grant's note, or the part of the sign-in before the @.

//
// 2026-10-13/14 (Mike: the intercom is "handled like a call, with its own permission separate from calls"; and "the
// account owner controls every screen on the account by default"): the tick here is "May use the intercom", decided by
// screen_permissions.js `permsFor(...).intercom` - the same rule the SERVER now checks on every intercom offer
// (screen_access.may_intercom). It is ON by default for the owner (any device in the household can announce) and for
// the guardian set, and off for everybody else until ticked. Ticking writes this older list (`intercomAllowed`, which
// still holds the name the room shows); unticking somebody who has it by default writes `intercom: false` on their line
// of the people list, which wins.

import { normalizeAllowed } from './intercom.js';
import { permsFor, withSwitch, normalizePeople, LIST_FIELD } from './screen_permissions.js';

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const shortName = (account) => String(account || '').split('@')[0] || String(account || '');

/**
 * Candidates, from the owner and the grants. Pure.
 * [{ account, suggested, note, current: bool }]
 */
export function approvalCandidates({ owner = null, grants = [], allowed = [], now = new Date().toISOString() } = {}) {
  const out = [];
  if (owner) out.push({ account: owner, suggested: 'You', note: 'you (you own these screens)', current: true });
  for (const g of grants || []) {
    if (!g || g.subject_kind && g.subject_kind !== 'account') continue;
    const account = String(g.subject_id || '');
    if (!account || out.some((x) => x.account === account)) continue;
    const live = !g.expires_at || String(g.expires_at) > now;
    out.push({ account, suggested: (g.label || '').trim().slice(0, 60) || shortName(account),
               note: live ? (g.expires_at ? `may use these screens until ${String(g.expires_at).slice(0, 10)}` : 'may use these screens')
                 : 'their permission to use these screens has ended',
               current: live });
  }
  for (const a of normalizeAllowed(allowed)) {
    if (!out.some((x) => x.account === a.account)) {
      out.push({ account: a.account, suggested: a.name, note: 'no longer allowed to use these screens', current: false });
    }
  }
  return out;
}

export function mountIntercomApprovals(root, {
  personName = '',
  state,                        // the person's row: { get(), set(patch), subscribe?(fn) }
  loadGrants = async () => [],  // () => [{ subject_id, subject_kind, label, expires_at }]
  whoami = async () => null,    // () => the signed-in account (the owner)
  now = () => new Date().toISOString(),
} = {}) {
  if (!root) throw new Error('mountIntercomApprovals: a root element is required');
  if (!state) throw new Error('mountIntercomApprovals: the person’s row is required');
  let grants = [];
  let owner = null;
  let destroyed = false;
  const ac = new AbortController();
  const allowed = () => normalizeAllowed((state.get?.() || {}).intercomAllowed);

  const rowNow = () => state.get?.() || {};
  // "May use the intercom", by the shared rule (owner and guardian set by default; the older list; an untick wins).
  const mayUse = (c) => permsFor(rowNow(), c.account, owner, { reach: !!c.current }).intercom === true;

  function render() {
    if (destroyed) return;
    const list = allowed();
    const cands = approvalCandidates({ owner, grants, allowed: list, now: now() });
    root.innerHTML = `
      <div class="ia">
        <h2 class="r-h2">Who may open the intercom into ${esc(personName || 'this room')}</h2>
        <p class="h-hint">The intercom works like a call, with its own permission: being able to call doesn’t let
          anyone use it. It answers by itself and carries sound only, unless the screen’s intercom settings allow
          video. The room hears a chime and their name first, the screen shows who it is the whole time, and the room
          can end it with one press. You, on your own devices, and anyone with the guardian set may use it unless you
          untick them; anybody else only once you tick them.</p>
        ${cands.length ? `<ul class="r-list ia-list">${cands.map((c) => {
          const on = mayUse(c);
          const ent = list.find((a) => a.account === c.account);
          return `<li data-account="${esc(c.account)}">
            <label><input type="checkbox" data-allow${on ? ' checked' : ''}${!c.current && !on ? ' disabled' : ''}>
              <b>${esc(c.account)}</b></label>
            <span class="h-hint"> — ${esc(c.note)}</span>
            ${on && ent ? `<label class="ia-name">The room shows them as
              <input type="text" data-name maxlength="60" value="${esc(ent.name)}"></label>` : ''}
          </li>`;
        }).join('')}</ul>`
        : '<p class="h-hint">Nobody may use these screens yet, so nobody can be added.</p>'}
        <p class="r-msg" data-msg role="status"></p>
      </div>`;
  }
  const say = (t) => { const m = root.querySelector('[data-msg]'); if (m) m.textContent = t || ''; };

  function write(next, msg, extra = {}) {
    try {
      const r = state.set({ intercomAllowed: normalizeAllowed(next), ...extra });
      Promise.resolve(r).then(() => { render(); say(msg); }, (err) => { console.error('intercom approvals', err); say('Could not save that.'); });
    } catch (err) { console.error('intercom approvals', err); say('Could not save that.'); }
  }

  root.addEventListener('change', (e) => {
    const li = e.target.closest('[data-account]');
    if (!li) return;
    const account = li.dataset.account;
    const list = allowed();
    if (e.target.matches('[data-allow]')) {
      const c = approvalCandidates({ owner, grants, allowed: list, now: now() }).find((x) => x.account === account);
      const people = normalizePeople(rowNow()[LIST_FIELD]);
      const explicit = people.find((x) => x.account === account && typeof x.intercom === 'boolean');
      if (e.target.checked) {
        const next = list.some((a) => a.account === account) ? list : [...list, { account, name: c?.suggested || shortName(account) }];
        // An earlier untick on the people list would still win: it goes with this tick.
        const extra = explicit ? { [LIST_FIELD]: withSwitch(people, account, 'intercom', true) } : {};
        write(next, 'Added. They can open the intercom now.', extra);
      } else {
        const next = list.filter((a) => a.account !== account);
        // Still allowed by default (the owner, the guardian set)? Then say no on their line, which wins.
        const still = permsFor({ ...rowNow(), intercomAllowed: next }, account, owner, { reach: !!c?.current }).intercom;
        const extra = still || explicit ? { [LIST_FIELD]: withSwitch(people, account, 'intercom', false, { name: c?.suggested }) } : {};
        write(next, 'Removed. They can no longer open the intercom.', extra);
      }
      return;
    }
    if (e.target.matches('[data-name]')) {
      const name = e.target.value.trim() || shortName(account);
      write(list.map((a) => (a.account === account ? { ...a, name } : a)), 'Saved.');
    }
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
    allowed,
    destroy() { destroyed = true; ac.abort(); try { offSub?.(); } catch { /* gone */ } root.innerHTML = ''; },
  };
}
