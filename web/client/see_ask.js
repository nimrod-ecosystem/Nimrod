// see_ask.js — "MAY <NAME> SEE THIS SCREEN?", ON THE SCREEN, AND GONE BY ITSELF (Mike, 2026-10-12).
//
// Somebody on "Who may see this screen" with "Ask first" on (the default) starts watching along; the server puts the
// question on every screen of the person (server/screen_access.py), and this shows it: their name, Allow, Not now.
//
// *** NEVER A BLOCKED SCREEN (CLAUDE.md's gate test: what happens if nobody answers?). *** Nobody answering means the
// seeing does not start - inaction - so:
//   * it is a small card in a corner, NOT a dialog: nothing behind it stops, nothing is paused, the panels keep taking
//     their presses, and it does not take the switch scan (a person mid-game is not pulled into a question);
//   * it is NOT spoken: a voice over a video stops the video being heard, which is "stopping what is playing";
//   * it GOES BY ITSELF after the person's own `seeAskSeconds` (30 s by default, argued in screen_access.py), counted
//     down on the card, and the server's own clock (a few seconds longer) refuses the seeing whatever happens here.
// The person who cannot answer is the guardian set's case, not this card's: the set sees without asking.
//
// Pointer and touch answer it; so does a keyboard's Tab. Several questions at once are shown together (at most
// MAX_SHOWN; a person asking twice is one question).

export const MAX_SHOWN = 3;

export function askWords(name) {
  const n = typeof name === 'string' && name.trim() ? name.trim() : 'Someone signed in elsewhere';
  return `${n} would like to see this screen`;
}

export function mountSeeAsk(host, {
  link,
  doc = host?.ownerDocument || (typeof document !== 'undefined' ? document : null),
  zIndex = null,
  setTick = (fn, ms) => setInterval(fn, ms),
  clearTick = (id) => clearInterval(id),
} = {}) {
  if (!host || !doc) throw new Error('mountSeeAsk: a host element is required');
  if (!link || typeof link.onAccess !== 'function') throw new Error('mountSeeAsk: a drive link with onAccess is required');
  const asks = new Map();          // ask id -> { name, left }
  let tick = null;

  const box = doc.createElement('div');
  box.dataset.seeAsk = '';
  box.hidden = true;
  box.setAttribute('role', 'status');
  box.setAttribute('aria-live', 'polite');
  // A corner, theme tokens only, never over the middle of the screen.
  box.style.cssText = 'position:absolute;left:clamp(8px,2vmin,20px);bottom:clamp(8px,2vmin,20px);'
    + `${zIndex != null ? `z-index:${zIndex};` : ''}display:flex;flex-direction:column;gap:8px;max-width:min(92%,440px);`
    + 'font:600 clamp(14px,2vmin,22px)/1.3 system-ui,-apple-system,Segoe UI,sans-serif';
  host.append(box);

  function render() {
    box.replaceChildren();
    const list = [...asks.entries()].slice(0, MAX_SHOWN);
    box.hidden = list.length === 0;
    for (const [id, a] of list) {
      const card = doc.createElement('div');
      card.dataset.seeAskCard = id;
      card.style.cssText = 'padding:10px 14px;border-radius:12px;background:var(--surface);color:var(--text);'
        + 'border:2px solid var(--focus);box-shadow:0 2px 10px rgba(0,0,0,.25)';
      const line = doc.createElement('div');
      line.textContent = askWords(a.name);
      const sub = doc.createElement('div');
      sub.dataset.seeAskLeft = '';
      sub.style.cssText = 'font-weight:400;color:var(--text-muted);margin:2px 0 8px';
      sub.textContent = `If nobody answers, nothing is shared. This goes in ${a.left} s.`;
      const row = doc.createElement('div');
      row.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap';
      const mk = (yes, label) => {
        const b = doc.createElement('button');
        b.type = 'button';
        b.dataset.seeAnswer = yes ? 'yes' : 'no';
        b.textContent = label;
        b.style.cssText = 'min-height:44px;padding:.3em 1em;border-radius:10px;cursor:pointer;font:inherit;'
          + 'background:var(--surface-alt);color:var(--text);border:2px solid var(--border)';
        b.addEventListener('click', () => answer(id, yes));
        return b;
      };
      row.append(mk(false, 'Not now'), mk(true, 'Allow'));
      card.append(line, sub, row);
      box.append(card);
    }
  }

  function stopTick() { if (tick != null) { clearTick(tick); tick = null; } }
  function startTick() {
    if (tick != null) return;
    tick = setTick(() => {
      for (const [id, a] of asks) { a.left -= 1; if (a.left <= 0) asks.delete(id); }
      if (!asks.size) stopTick();
      render();
    }, 1000);
  }

  function answer(id, yes) {
    if (!asks.has(id)) return false;
    asks.delete(id);
    try { link.answerSee?.(id, !!yes); } catch (err) { console.error('see ask: answer', err); }
    if (!asks.size) stopTick();
    render();
    return true;
  }

  const off = link.onAccess((m) => {
    if (!m || typeof m.ask !== 'string') return;
    if (m.type === 'see-ask') {
      const left = Number.isFinite(m.seconds) && m.seconds > 0 ? Math.round(m.seconds) : 30;
      asks.set(m.ask, { name: typeof m.name === 'string' ? m.name : '', left });
      startTick();
      render();
    } else if (m.type === 'see-ask-ended') {
      if (asks.delete(m.ask)) { if (!asks.size) stopTick(); render(); }
    }
  });

  return {
    showing: () => asks.size > 0,
    asks: () => [...asks.entries()].map(([id, a]) => ({ id, ...a })),
    answer,
    element: () => box,
    destroy() {
      try { off?.(); } catch { /* gone */ }
      stopTick();
      asks.clear();
      box.remove();
    },
  };
}
