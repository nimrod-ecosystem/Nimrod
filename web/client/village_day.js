/* village_day.js (Design's villageDay.js, copied 2026-11-02 with its imports renamed to the site's files): big idea 3, a village that keeps the real day (Mike, 2026-11-02: "I really like all your
 * suggestions there ... go ahead and start on your part").
 *
 *   VILLAGE_DAY_DEFAULTS   → the settings and their starting values
 *   ROUTINES               → who is where, doing what, from when to when (plain data a person can edit)
 *   villageAt(date, settings) → a village recipe for that moment: the scene, its light, and the cast placed by
 *                               their routines, each with a gesture (a motion from motionKit.js) where they have one
 *   whoIsOut(date, settings)  → a plain-words list of who is where, for a caption or a screen reader
 *
 * The idea: day, time and season can be read from the scene itself. The baker opens up in the morning, the
 * market is busy at midday, the children play after school, the lanterns are lit at night and everyone has gone
 * home, Nimrod naps in the afternoon. Design's guess, not a clinical claim, is that this helps someone keep track
 * of the day at a glance; whether it does is for Mike and the people who use it to judge.
 *
 * Everything is a setting (B1): the routines themselves, the market days, the clock (real, or a fixed time for a
 * demo or a lesson), and whether anyone moves. Times are local, 24-hour "HH:MM"; a routine may run past midnight
 * (from '20:00' to '06:00').
 * Weather (snow, rain, leaves) follows the real weather when Code has a weather feed; until then `weather` is a
 * setting ('none' | 'snow' | 'rain' | 'leaves') drawn with the backdrop kit's falling layer.
 */
import { VILLAGE_SCENES } from './village_kit.js';
import { lightAt, MEDIEVAL_DEFAULTS } from './medieval_theme.js';

export const VILLAGE_DAY_DEFAULTS = {
  clock: 'real',            // 'real', or a fixed 'HH:MM' for a demo or a lesson
  day: null,                // null follows the date; 0 Sunday … 6 Saturday to pin a day
  marketDays: [1, 2, 3, 4, 5, 6],
  moving: true,             // false: everyone is placed, nobody gestures (the still village)
  hours: MEDIEVAL_DEFAULTS.hours,
  recipe: 'village',
};

/* Each routine: cast id, when (from, to), where (x, y on the 1600×900 stage, scale), what (pose, gesture,
   motion), and on which days ('market' = market days only; 'weekend'; or an array of day numbers). */
export const ROUTINES = [
  { cast: 'baker', from: '06:00', to: '14:00', x: 700, y: 862, scale: 0.62, gesture: 'waveHello', note: 'Opens the bakery early' },
  { cast: 'baker', from: '14:00', to: '18:00', x: 640, y: 858, scale: 0.6, pose: 'talk', note: 'Chats by her door' },
  { cast: 'farmer', from: '07:00', to: '12:00', x: 960, y: 864, scale: 0.62, days: 'market', note: 'Brings apples to market' },
  { cast: 'farmer', from: '12:00', to: '17:00', x: 1470, y: 880, scale: 0.6, gesture: 'sway', note: 'Back at the haystacks' },
  { cast: 'shopkeeper', from: '09:00', to: '17:00', x: 1060, y: 860, scale: 0.62, days: 'market', gesture: 'beckon', note: 'Runs the market stall' },
  { cast: 'blacksmith', from: '08:00', to: '17:00', x: 800, y: 858, scale: 0.62, pose: 'stand', note: 'At the forge' },
  { cast: 'librarian', from: '10:00', to: '18:00', x: 430, y: 866, scale: 0.6, gesture: 'think', note: 'Reads by the tower' },
  { cast: 'merlin', from: '09:00', to: '11:00', x: 330, y: 846, scale: 0.62, gesture: 'think', note: 'Morning spells' },
  { cast: 'merlin', from: '18:00', to: '23:00', x: 330, y: 846, scale: 0.62, gesture: 'waveHello', note: 'Waves at the evening' },
  { cast: 'michael', from: '10:00', to: '11:00', x: 800, y: 884, scale: 0.6, motion: 'walkAcross', gesture: 'walk', note: 'Morning patrol' },
  { cast: 'gladys', from: '15:00', to: '16:00', x: 800, y: 884, scale: 0.6, motion: 'walkAcross', gesture: 'walk', note: 'Afternoon patrol' },
  { cast: 'jess', from: '15:00', to: '18:00', x: 900, y: 874, scale: 0.6, gesture: 'hop', note: 'Plays after lessons' },
  { cast: 'vince', from: '15:00', to: '18:00', x: 960, y: 876, scale: 0.6, gesture: 'cheer', note: 'Plays after lessons' },
  { cast: 'jess', from: '09:00', to: '18:00', x: 900, y: 874, scale: 0.6, gesture: 'hop', days: 'weekend', note: 'All day at the weekend' },
  { cast: 'vince', from: '09:00', to: '18:00', x: 960, y: 876, scale: 0.6, gesture: 'cheer', days: 'weekend', note: 'All day at the weekend' },
  { cast: 'kenny', from: '11:00', to: '13:00', x: 1130, y: 640, scale: 0.36, gesture: 'waveHello', note: 'At the castle gate' },
  { cast: 'rose', from: '11:00', to: '13:00', x: 1170, y: 642, scale: 0.36, gesture: 'waveHello', note: 'At the castle gate' },
  { cast: 'robin', from: '12:00', to: '14:00', x: 1110, y: 860, scale: 0.6, gesture: 'laugh', days: 'market', note: 'Jokes at the market' },
  { cast: 'nimrod', from: '07:00', to: '13:00', x: 1040, y: 892, scale: 0.5, gesture: 'lookAround', note: 'Watches the market' },
  { cast: 'nimrod', from: '13:00', to: '17:00', x: 880, y: 892, scale: 0.5, gesture: 'sleepBreathe', note: 'Afternoon nap by the well' },
  { cast: 'nimrod', from: '17:00', to: '07:00', x: 690, y: 892, scale: 0.5, gesture: 'tailSwish', note: 'Home by the cottage' },
];

const mins = (hhmm) => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + (m || 0); };
const inSpan = (t, from, to) => { const a = mins(from), b = mins(to); return a <= b ? t >= a && t < b : t >= a || t < b; };
const onDay = (r, day, s) => !r.days || (r.days === 'market' ? s.marketDays.includes(day) : r.days === 'weekend' ? day === 0 || day === 6 : Array.isArray(r.days) && r.days.includes(day));

function moment(date, s) {
  const d = new Date(date);
  if (s.clock !== 'real') { const [h, m] = s.clock.split(':').map(Number); d.setHours(h, m || 0, 0, 0); }
  return { t: d.getHours() * 60 + d.getMinutes(), day: s.day ?? d.getDay(), d };
}
/* Who is out now. A later routine for the same person (in the list order) wins, so weekend lines override. */
function activeRoutines(date, s, routines) {
  const { t, day } = moment(date, s), byCast = {};
  for (const r of routines) if (inSpan(t, r.from, r.to) && onDay(r, day, s)) byCast[r.cast] = r;
  return Object.values(byCast);
}

export function villageAt(date = new Date(), settings = {}, routines = ROUTINES) {
  const s = { ...VILLAGE_DAY_DEFAULTS, ...settings }, { d } = moment(date, s);
  const base = (VILLAGE_SCENES[s.recipe] || VILLAGE_SCENES.village).recipe;
  const time = lightAt(d, s.hours);
  const market = s.marketDays.includes(s.day ?? d.getDay());
  const pieces = base.pieces.filter((p) => !p.cast && (market || p.piece !== 'marketStall'));
  for (const r of activeRoutines(date, s, routines)) {
    pieces.push({ cast: r.cast, x: r.x, y: r.y, scale: r.scale, pose: r.pose, flip: r.flip,
      gesture: s.moving ? r.gesture : undefined, motion: s.moving ? r.motion : undefined });
  }
  return { ...base, pieces, time, label: 'The village today' };
}

export function whoIsOut(date = new Date(), settings = {}, routines = ROUTINES) {
  const s = { ...VILLAGE_DAY_DEFAULTS, ...settings };
  return activeRoutines(date, s, routines).map((r) => ({ cast: r.cast, note: r.note || '' }));
}
