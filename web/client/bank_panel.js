// bank_panel.js — WRITING THE SYLLABUS. The editor for the shared content bank.
//
// Mike, 2026-08-31: *"the trivia game should be like word forge where people can build their own
// syllabus or whatever into it."* Until this existed, the bank was editable only by reaching into
// per-profile state, which is not "building your own syllabus" — it is knowing where the data is
// kept, which is a different skill and a much smaller audience.
//
// ---------------------------------------------------------------------------------------
// *** A TEXTAREA, DELIBERATELY, AND NOT A ROW EDITOR ***
// ---------------------------------------------------------------------------------------
//
// The obvious design is a table: a row per item, a field per column, an Add button. It is worse
// here, for reasons that are about the actual job rather than about taste:
//
//   * **A syllabus arrives from somewhere else.** It is in a document, a spreadsheet column, an
//     email from a therapist, a list somebody typed on their phone. Paste is the whole workflow,
//     and a row editor turns pasting sixty items into sixty separate acts of data entry.
//   * **It is edited in bulk.** Reordering, renaming a topic across twenty rows, deleting a
//     section — all of it is trivial in text and tedious in a grid.
//   * **It is somebody's document.** Comments, blank lines and section headings are how a person
//     keeps a long list navigable, and a row editor throws all three away.
//
// So: text, with the format visible above it, and honest feedback below it.
//
// ---------------------------------------------------------------------------------------
// THE FEEDBACK IS THE FEATURE
// ---------------------------------------------------------------------------------------
//
// The failure mode of any hand-edited format is always the same: a row that does not parse is
// silently absent, and the game looks broken rather than the line looking wrong. Somebody who
// typed a comma instead of a pipe on line 34 of 60 has no way to find out.
//
// So this counts what it read, names what it skipped, and gives the line number. It reports while
// typing and without saving, because a mistake found now costs a keystroke and a mistake found
// during a session costs the session.

import { parseBank, checkBank, questionsFromWords } from './bank.js';

export const BANK_KEY = 'bank';

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// What to say about a document, in one line. Pure, so the wording is testable.
export function summarize(check) {
  if (!check) return '';
  const bits = [];
  if (check.words) bits.push(`${check.words} word${check.words === 1 ? '' : 's'}`);
  if (check.questions) bits.push(`${check.questions} question${check.questions === 1 ? '' : 's'}`);
  if (!bits.length) return 'Nothing here yet.';
  const errs = (check.problems || []).filter((p) => p.severity !== 'note');
  const head = bits.join(' and ') + '.';
  return errs.length
    ? `${head} ${errs.length} line${errs.length === 1 ? '' : 's'} could not be read.`
    : head;
}

export function mountBankPanel(root, {
  settings = () => ({}),
  save = async () => {},
  // Debounced, because saving on every keystroke of a sixty-line document is a request per
  // character. The same reason `inputs.js` debounces its binder.
  saveDebounceMs = 500,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
} = {}) {
  if (!root) throw new Error('mountBankPanel: a root element is required');

  let saveTimer = null;
  let destroyed = false;

  const text = () => (settings() || {})[`${BANK_KEY}Text`] || '';

  root.innerHTML = `
    <div class="bk">
      <h3>Questions and words</h3>
      <p class="bk-lede">One item per line, parts separated by <code>|</code>. Both games read
        this, so a word written once can be practiced in Word Forge <em>and</em> asked as a
        question in Trivia.</p>

      <details class="bk-help">
        <summary>The format</summary>
        <pre>## words
sanguine | cheerfully optimistic | She stayed sanguine about the delay. | 9

## questions
What is the capital of France? | Paris | London | Rome | Madrid</pre>
        <p>A <code>##</code> heading says which kind the lines below it are. Lines starting with
          <code>#</code> are notes to yourself and are ignored. For a question, anything after the
          answer is a wrong answer — and wrong answers you choose yourself teach better than ones
          the game borrows.</p>
      </details>

      <textarea class="bk-text" data-text rows="14" spellcheck="false"
        aria-label="the question and word bank"></textarea>

      <p class="bk-sum" data-sum role="status" aria-live="polite"></p>
      <div class="bk-problems" data-problems></div>
      <p class="bk-derived" data-derived></p>
    </div>`;

  const el = (s) => root.querySelector(s);
  const area = el('[data-text]');

  function render() {
    if (destroyed) return;
    const t = area.value;
    const check = checkBank(t, { defaultKind: 'words' });
    el('[data-sum]').textContent = summarize(check);
    el('[data-sum]').dataset.bad = check.problems.some((p) => p.severity !== 'note') ? '1' : '';

    // *** LINE NUMBERS, AND THE LINE ITSELF. *** "3 lines could not be read" without saying
    // which ones is a worse message than no message: it tells somebody there is a problem and
    // nothing about where.
    el('[data-problems]').innerHTML = check.problems.length
      ? check.problems.slice(0, 12).map((p) => `
          <div class="bk-prob${p.severity === 'note' ? ' bk-note' : ''}">
            <b>Line ${p.line}</b> — ${esc(p.why)}
            <span class="bk-line">${esc(p.text.slice(0, 70))}</span>
          </div>`).join('')
        + (check.problems.length > 12 ? `<div class="bk-prob">…and ${check.problems.length - 12} more.</div>` : '')
      : '';

    // What the sharing actually buys, said out loud — otherwise nobody would know their words
    // had become questions too.
    const { words } = parseBank(t, { defaultKind: 'words' });
    const derived = questionsFromWords(words).length;
    el('[data-derived]').textContent = derived
      ? `Trivia can also ask about ${derived} of these words, so you do not have to write those questions twice.`
      : '';
  }

  function queueSave() {
    if (saveTimer != null) clearTimer(saveTimer);
    saveTimer = setTimer(async () => {
      saveTimer = null;
      try { await save({ [`${BANK_KEY}Text`]: area.value }); }
      catch (err) { console.error('bank: save', err); }
    }, saveDebounceMs);
  }

  area.addEventListener('input', () => { render(); queueSave(); });
  // A blur saves immediately: somebody who types and then closes the tab should not lose the
  // last half-second of work to a debounce.
  area.addEventListener('blur', () => {
    if (saveTimer != null) { clearTimer(saveTimer); saveTimer = null; }
    Promise.resolve(save({ [`${BANK_KEY}Text`]: area.value }))
      .catch((err) => console.error('bank: save', err));
  });

  return {
    async refresh() { area.value = text(); render(); return this; },
    render,
    check: () => checkBank(area.value, { defaultKind: 'words' }),
    destroy() {
      destroyed = true;
      if (saveTimer != null) { clearTimer(saveTimer); saveTimer = null; }
      root.innerHTML = '';
    },
  };
}
