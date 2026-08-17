
## 2026-08-17 — BALANCE TRACKING, DAILY CAP, GRADE BANDS, educational text format
Mike: "Keep track of about how many points per minute everything is giving for balance patches.
That could actually be an issue though. I'm thinking of this as something he can keep on his second
monitor and do a couple while something loads or whatever and then just leaving it running."

He identified the real risk himself: an idle-time filler LEFT RUNNING prints money. Built:
- **`docs/points-balance.md`** — the tracked table of pts/min for EVERY source (sprint 1.0, mow 1.0,
  dishes ~1.5, look-up-a-word ~2.0, wordforge ~5 capped). Plus the rule: estimate the minutes,
  divide, and **cap anything repeatable**. Add a row when you add/reprice a source.
- **`dailyCap: 40`** on wordforge (~20 correct answers, ~8 min, ~1.5 sprints). **Past the cap the
  game KEEPS PLAYING AND KEEPS LOGGING TRIALS — only the currency stops.** Capping the currency must
  never cap the measurement. Header shows "daily points reached — still counts for practice."
  `points.js` gained `todayFrom(source)` / `sumPointsOnBySource` as the primitive.
- **GRADE BANDS** (Mike said "the word"). Bank entries carry `grade`; telemetry gained an optional
  `band` field + `byBand()`; progress has a **Bands tab that only appears when data has bands**.
  Framed everywhere as THE CONTENT'S OWN LABEL — explicitly NOT a percentile/national comparison
  (that needs a normed instrument; inventing one would fabricate a number about a kid's education).
- **`educational` text format.** CORRECTION to what I said last turn: it was NOT hardcoded — it
  already read `cfg.items` from per-profile state. What was missing was an editable TEXT format, so
  added `itemsText` + `parseItems()`: `kind | graphicType:value | spoken line`. Defaults exported.

Tests: wordforge 59, progress 54, both green.

STILL OPEN (Mike's asks this turn, NOT built):
- **LAYOUT COMPOSER — next slice, and Mike specified where it goes.** NOT on home. Home should be
  "your profile with a SIDEBAR to go to different tabs like dashboard composer or audio hub."
  So: home becomes a shell (sidebar + tabs), and the composer is the "Dashboard Composer" TAB —
  layout presets (fullscreen / 2-up / 4-up), arrange modules into slots like Unity's window docking,
  saved to `settings.kiosk.layout`, with the kiosk rendering N slots instead of one stage.
  Also mentioned as a future tab: **audio hub**.
- **EDUCATIONAL VIDEOS AS A LEVEL-UP GATE (Mike's idea, good one).** "There should maybe be
  educational videos, but for the topics on his game, that are kind of like a level up. Once he
  plays a video, questions from that topic go into the game pools." I.e. topic UNLOCKING: watching
  the video for a topic adds that topic's questions to wordforge's deck. Fits the existing pieces —
  `educational` already plays segments, wordforge's deck is data, and the `gameplay` stream could
  record the unlock. Design sketch only; not started.
