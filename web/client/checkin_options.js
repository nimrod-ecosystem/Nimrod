// checkin_options.js - THE QUIET CHECK-IN'S SETTINGS, pure (checkin.js has the design and argues each default).
//
// Its own file so the Remote page's permission editor (screen_permissions.js) can offer them without importing the
// check-in itself, which imports screen_permissions.js for its permission rule - one direction only, no cycle.

export const MEDIA_CHOICES = Object.freeze(['both', 'sound', 'picture']);
export const MAX_CHOICES = [0, 2 * 60000, 10 * 60000, 30 * 60000, 60 * 60000];

export const CHECKIN_DEFAULTS = Object.freeze({
  media: 'both',
  maxMs: 10 * 60000,
  endOnPress: true,
});

export const CHECKIN_FIELDS = [
  { key: 'checkInMedia', label: 'A quiet check-in carries', kind: 'choice',
    default: CHECKIN_DEFAULTS.media, level: 'standard',
    options: [
      { value: 'both', label: 'Sound and picture' },
      { value: 'sound', label: 'Sound only' },
      { value: 'picture', label: 'Picture only' },
    ],
    note: 'The room hears nothing from the person checking in, and the screen shows who it is the whole time.' },
  { key: 'checkInMaxMs', label: 'A quiet check-in ends by itself after', kind: 'choice',
    default: CHECKIN_DEFAULTS.maxMs, level: 'standard',
    options: [
      { value: 2 * 60000, label: 'Two minutes' },
      { value: 10 * 60000, label: 'Ten minutes' },
      { value: 30 * 60000, label: 'Half an hour' },
      { value: 60 * 60000, label: 'An hour' },
      { value: 0, label: 'Only when somebody ends it' },
    ] },
  { key: 'checkInEndOnPress', label: 'A press at the screen ends a quiet check-in', kind: 'toggle',
    default: CHECKIN_DEFAULTS.endOnPress, level: 'standard',
    note: 'Anyone at the screen who presses anything gets their room back, and the person checking in is told why.' },
];

/** A person's row -> this file's options. Pure; every unset or broken key is its default. */
export function checkInOptionsFrom(values = {}) {
  const v = values || {};
  const n = Number(v.checkInMaxMs);
  return {
    media: MEDIA_CHOICES.includes(v.checkInMedia) ? v.checkInMedia : CHECKIN_DEFAULTS.media,
    maxMs: v.checkInMaxMs !== null && v.checkInMaxMs !== '' && typeof v.checkInMaxMs !== 'boolean'
      && Number.isFinite(n) && MAX_CHOICES.includes(n) ? n : CHECKIN_DEFAULTS.maxMs,
    endOnPress: typeof v.checkInEndOnPress === 'boolean' ? v.checkInEndOnPress : CHECKIN_DEFAULTS.endOnPress,
    row: v,
  };
}

/** What the room allows, as kinds. Pure. */
export function allowedKinds(media) {
  const m = MEDIA_CHOICES.includes(media) ? media : CHECKIN_DEFAULTS.media;
  return { audio: m !== 'picture', video: m !== 'sound' };
}
