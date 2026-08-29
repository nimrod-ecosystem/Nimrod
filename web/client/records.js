// records.js — the REVIEW SURFACE. What a module wrote down, and the attest button.
//
// *** THIS IS NOT ON HER SCREEN, AND THAT IS THE POINT. *** A clinician reviewing evidence is
// doing a different job from the person playing, in a different room, often on a different day.
// Putting a review UI on the bedside kiosk would put a table of her performance in front of
// somebody who cannot leave the screen. So it lives on home, beside Screens and Devices, and
// the kiosk never learns it exists.
//
// WHAT IT SHOWS, and the framing is deliberate at every level:
//
//   * Sessions, not a leaderboard. Rows are grouped by the sitting they happened in, because
//     a trial only means something next to the others from the same sitting.
//   * NO SCORE ANYWHERE. Counts and latencies, which are observations. The module refuses to
//     produce a score and this refuses to invent one - a "total" computed in the review UI
//     would be exactly the number the evidence-candidate framing exists to avoid.
//   * The caveat travels WITH the data, on screen, not in a footnote nobody scrolls to.
//
// *** ATTESTING IS ONE CLICK AND SENDS NOTHING ABOUT WHO YOU ARE. *** The button posts a note
// and nothing else; the server takes the attester from the signed-in session. There is no
// field here to put somebody else's name in, which is the entire reason an attestation is
// worth reading later. See provenance.py.
//
// UNATTESTED IS NOT A WARNING. Most rows are unattested and that is the normal state of
// honest data - it is drawn quietly, not in red, because a UI that nags about it teaches
// people to click the button to clear the nag, which is how attestation stops meaning
// anything.

import { createEvents } from './events.js';

const KINDS_WORTH_SHOWING = new Set(['trial', 'session_evidence_record']);

// Which module types write clinical rows. A short list rather than "anything with events",
// because the presslog demo and a points ledger are also events and are not evidence.
export const RECORDING_TYPES = new Set(['pressgame']);

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const clock = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso ?? '') : d.toLocaleString();
};

// One line describing a trial, in words rather than a field dump.
export function describe(row) {
  const d = row.data || {};
  // The summary row has no `data.kind` of its own, so without this it fell through and
  // printed the raw machine name at somebody reading a clinical record.
  if (row.kind === 'session_evidence_record') return 'the record for this sitting';
  switch (d.kind) {
    case 'hit':
      return `pressed after ${d.latencyMs}ms`
        + (d.machine?.goDelayMs ? ` (${d.machine.goDelayMs}ms of that was the screen)` : '');
    case 'omission':    return 'the invite closed with no press';
    case 'commission':  return 'pressed during the wait';
    case 'perseveration': return `kept pressing — echo ${d.n}, ${d.msSinceHit}ms after the win`;
    case 'stop_done':   return `settled after ${d.echoes} echo${d.echoes === 1 ? '' : 'es'}`;
    case 'go_shown':    return 'the invite opened';
    case 'session_start': return 'a sitting began';
    case 'edge_up':
      // BOTH NUMBERS OR NEITHER. A hold on its own cannot tell "could not let go" from
      // "was asked to hold", and showing only the first would state the thing we went out
      // of our way not to conclude.
      return `held ${d.heldMs}ms` + (d.requiredHoldMs
        ? ` (${d.requiredHoldMs}ms was asked for)`
        : ' — nothing asked for a hold')
        + (d.auto ? ' · released by the watchdog, not by them' : '');
    case 'edge_down':   return d.bound ? 'a press' : 'a press that was bound to nothing';
    default:            return d.kind || row.kind;
  }
}

export function groupBySession(events) {
  const out = new Map();
  for (const e of events || []) {
    if (!KINDS_WORTH_SHOWING.has(e.kind)) continue;
    const sid = e.session_id || '(no sitting recorded)';
    if (!out.has(sid)) out.set(sid, []);
    out.get(sid).push(e);
  }
  return out;
}

// Who vouched for a row — read from the attestation events, never from a flag on the row.
export function attestersOf(events, targetId) {
  const seen = [];
  for (const e of events || []) {
    if (e.kind !== 'attestation') continue;
    if ((e.data || {}).attests !== targetId) continue;
    const who = e.attested_by || (e.data || {}).attested_by;
    if (who && !seen.includes(who)) seen.push(who);
  }
  return seen;
}

export function mountRecords(host, { profiles, user, makeEvents = null } = {}) {
  let streams = [];      // [{pid, screen, mid, type, handle}]
  let error = '';

  host.innerHTML = '<div class="rec"><p class="rec-loading">Loading…</p></div>';
  const root = host.querySelector('.rec');

  async function load() {
    streams = [];
    error = '';
    try {
      const list = await profiles.list();
      for (const p of list || []) {
        for (const m of p.modules || []) {
          if (!RECORDING_TYPES.has(m.type)) continue;
          const handle = makeEvents
            ? makeEvents(m.id, { limit: 500 }, p.id)
            : createEvents({ url: profiles.eventsURL(p.id, m.id), user, limit: 500 });
          await handle.load().catch(() => {});
          streams.push({ pid: p.id, screen: p.name || p.id, mid: m.id, type: m.type, handle });
        }
      }
    } catch (e) {
      error = String(e?.message || e);
    }
    render();
  }

  function render() {
    if (error) {
      root.innerHTML = `<p class="rec-empty">Records could not be loaded. ${esc(error)}</p>`;
      return;
    }
    if (!streams.length) {
      root.innerHTML =
        '<h1>Records</h1>'
        + '<p class="rec-empty">Nothing has written a record yet. Add <b>Wait and Go</b> to a '
        + 'screen and play it — what it writes down will show up here.</p>';
      return;
    }

    const parts = ['<h1>Records</h1>', `
      <p class="rec-caveat"><b>Evidence candidates, not scores.</b> A missed press is not proof
      somebody cannot respond — arousal, fatigue, attention, motor output and the screen itself
      are not separable here. What is worth reading is the pattern across sittings and times of
      day. Nothing on this page is a rating.</p>`];

    for (const s of streams) {
      const events = s.handle.get()?.events || [];
      const groups = groupBySession(events);
      parts.push(`<section class="rec-stream"><h2>${esc(s.screen)} <small>${esc(s.type)}</small></h2>`);
      if (!groups.size) {
        parts.push('<p class="rec-empty">No sittings recorded on this screen yet.</p></section>');
        continue;
      }
      for (const [sid, rows] of [...groups.entries()].reverse()) {
        const summary = rows.find((r) => r.kind === 'session_evidence_record');
        const trials = rows.filter((r) => r.kind === 'trial');
        const started = rows[0]?.created_at;
        parts.push(`<div class="rec-session"><h3>${esc(clock(started))}
          <small>${trials.length} row${trials.length === 1 ? '' : 's'} · sitting ${esc(String(sid).slice(0, 12))}</small></h3>`);
        if (summary) {
          const c = summary.data?.counts || {};
          const l = summary.data?.latency || {};
          parts.push(`<p class="rec-counts">`
            + `${c.hits ?? 0} pressed · ${c.omissions ?? 0} missed · ${c.commissions ?? 0} early · `
            + `${c.perseverationPresses ?? 0} echoes`
            // MEAN WITH ITS SPREAD, ALWAYS. A bare mean of three trials reads as a finding.
            + (l.n ? ` · latency mean ${l.meanMs}ms across ${l.n} (${l.minMs}–${l.maxMs}ms)` : '')
            + `</p>`);
        }
        parts.push('<ul class="rec-rows">');
        for (const r of [...rows].reverse()) {
          const who = attestersOf(events, r.id);
          parts.push(`<li>
            <span class="rec-when">${esc(clock(r.created_at))}</span>
            <span class="rec-what">${esc(describe(r))}</span>
            <span class="rec-att">${who.length
              ? `vouched for by ${who.map(esc).join(', ')}`
              : ''}</span>
            <button class="rec-btn" data-attest="${esc(String(r.id))}"
              data-pid="${esc(s.pid)}" data-mid="${esc(s.mid)}">Attest</button>
          </li>`);
        }
        parts.push('</ul></div>');
      }
      parts.push('</section>');
    }
    root.innerHTML = parts.join('');
  }

  root.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-attest]');
    if (!btn) return;
    const s = streams.find((x) => x.pid === btn.dataset.pid && x.mid === btn.dataset.mid);
    if (!s) return;
    btn.disabled = true;
    btn.textContent = '…';
    try {
      // No "who" argument exists to pass. That is the design, not an omission.
      await s.handle.attest(btn.dataset.attest, { note: '' });
      render();
    } catch (err) {
      console.error('attest failed', err);
      btn.disabled = false;
      btn.textContent = 'Attest';
    }
  });

  return { refresh: load, render, streams: () => streams.map((s) => ({ ...s })), destroy() {} };
}
