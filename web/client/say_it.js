/* say_it.js (Design's sayIt.js, copied 2026-11-02 with its imports renamed to the site's files): big ideas 2 and 4 (Mike, 2026-11-02: "I really like all your suggestions there").
 *
 *   WORD_ACTIONS[word]   → { motion, face?, quiet? }   what a character does for a board word
 *   SAY_IT_DEFAULTS      → the settings, each with its starting value
 *   actionFor(word, settings) → the motion to play, or null for "say it, don't act it"
 *   sayItSvg(word, { who, theme, settings, label }) → '<svg …>' a character acting the word, with the word
 *                                                    in a large speech bubble, for someone across the room
 *
 * Idea 2 (standard): the pressed word's picture plays its motion once. Idea 4 (novel): the person's own
 * character in the backdrop acts the word. Both read this one table, so a word acts the same everywhere.
 *
 * Choices here, each a setting (B1):
 * - CARE WORDS DON'T ACT by default (bedpan, suction, change, pain, hot, cold, tired, hungry, thirsty, help
 *   are marked `quiet`). For: a person asking for the bedpan may not want a character miming it across the
 *   room, and pain is not a performance. Against: a caregiver across the room is exactly who needs to see
 *   "help" or "pain". So `quiet` words still show the word in the bubble, with the character standing; and
 *   `actCareWords: true` lets them act. Help is quiet only in the sense of no mime: its motion is a raised
 *   hand, which is a request, so it acts unless `actCareWords` is false AND `helpRaisesHand` is false.
 * - Words with no motion here still get the bubble and the "talk" face, so every word is shown.
 */
import { castSvg } from './cast.js';
import { MOTIONS } from './motion_kit.js';

export const SAY_IT_DEFAULTS = {
  /* where a pressed word is acted: 'avatar' (idea 4), 'symbol' (idea 2: the picture plays once), 'both', 'off'.
     Starts at 'off' on the AAC module (Mike, 2026-11-02: animated boards are one option, a setting on the module) */
  mode: 'off',
  /* play the motion once, or keep it going while the bubble shows */
  loop: false,
  /* how long the bubble stays, in ms */
  showFor: 4000,
  /* care words: mime them or not (see above) */
  actCareWords: false,
  helpRaisesHand: true,
  /* bubble text size relative to the character's height */
  bubbleScale: 1,
};

export const WORD_ACTIONS = {
  yes: { motion: 'nod' }, okay: { motion: 'nod' }, no: { motion: 'shake' }, not: { motion: 'shake' },
  hi: { motion: 'waveHello' }, bye: { motion: 'bye' }, please: { motion: 'bow' }, thanks: { motion: 'bow' },
  come: { motion: 'beckon' }, here: { motion: 'beckon' }, go: { motion: 'goAway' }, stop: { motion: 'stopHand' },
  more: { motion: 'more' }, all_done: { motion: 'allDone' }, want: { motion: 'want' }, get: { motion: 'want' },
  eat: { motion: 'eat' }, drink: { motion: 'drink' }, look: { motion: 'lookAround' }, wait: { motion: 'sigh' },
  there: { motion: 'pointRight' }, that: { motion: 'pointRight' }, it: { motion: 'pointRight' },
  good: { motion: 'cheer' }, like: { motion: 'nod', face: 'happy' }, love: { motion: 'laugh' }, bad: { motion: 'sad' },
  what: { motion: 'scratchHead' }, where: { motion: 'lookAround' }, who: { motion: 'lookAround' }, when: { motion: 'think' },
  rephrase: { motion: 'think' }, different: { motion: 'shrug' }, other: { motion: 'pointLeft' },
  music: { motion: 'sway' }, up: { motion: 'jump' }, little: { motion: 'shrug' },
  help: { motion: 'help', care: true }, tired: { motion: 'yawn', care: true }, hungry: { motion: 'eat', care: true },
  thirsty: { motion: 'drink', care: true }, pain: { care: true }, hot: { care: true }, cold: { care: true },
  bedpan: { care: true }, suction: { care: true }, change: { care: true },
};

export function actionFor(word, settings = {}) {
  const s = { ...SAY_IT_DEFAULTS, ...settings }, a = WORD_ACTIONS[word];
  if (!a || !a.motion || !MOTIONS[a.motion]) return null;
  if (a.care && !s.actCareWords && !(word === 'help' && s.helpRaisesHand)) return null;
  return { ...MOTIONS[a.motion], loop: s.loop, face: a.face || MOTIONS[a.motion].face };
}

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
/* a character beside a speech bubble, 380×320. The bubble's text is the word as it reads on the board. */
// (Code, 2026-11-02) One change from Design's copy: `assetBase` is passed through to castSvg, whose own default
// ('../../assets/') is the design system's folder; the site's is '/design-assets/' (modules/village.js ASSET_BASE).
export function sayItSvg(word, { who = 'player', look, outfit, theme, settings = {}, label, animated = true, assetBase } = {}) {
  const s = { ...SAY_IT_DEFAULTS, ...settings }, m = actionFor(word, s);
  const text = label || String(word).replace(/_/g, ' ');
  const fig = castSvg(who, { look, outfit, theme, motion: m || undefined, animated, pose: m ? 'stand' : 'talk', ...(assetBase ? { assetBase } : {}) })
    .replace(/^<svg[^>]*>/, '').replace('</svg>', '');
  const fs = Math.round(Math.min(58, 300 / Math.max(3, text.length)) * s.bubbleScale);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 380 320" role="img" aria-label="Says: ${esc(text)}"><title>Says: ${esc(text)}</title>`
    + `<g>${fig}</g>`
    + `<path d="M210 40H364Q376 40 376 52V128Q376 140 364 140H246L216 168L224 140H210Q198 140 198 128V52Q198 40 210 40Z" fill="#fffdf4" stroke="#2a1e12" stroke-width="4" stroke-linejoin="round"/>`
    + `<text x="287" y="${90 + fs * 0.35}" text-anchor="middle" font-family="ui-rounded, 'Segoe UI', system-ui, sans-serif" font-weight="800" font-size="${fs}" fill="#2a1e12">${esc(text)}</text></svg>`;
}
