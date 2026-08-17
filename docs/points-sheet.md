# Points ↔ Google Sheets — the default layout and the sync plan

> **Status: layout is final and usable TODAY (copy it by hand). Automatic sync is NOT
> built — it is blocked on Google OAuth.** This doc is the spec both halves are built to.

A points game is more fun when you can chart it, argue with it, and change the formulas.
That belongs in a spreadsheet. But a spreadsheet is a bad place to *keep score*, so the
two have distinct jobs:

- **Nimrod's `points` stream is the RECORD.** Append-only, server-side, works offline, and
  — the part that matters — the person earning the points cannot quietly edit their own
  total. That is what makes the score worth anything.
- **The Sheet is the MIRROR and the playground.** Nimrod pushes rows out to it. You chart
  them, project them, write formulas, and let a student build their own dashboard over the
  same data (which is a genuinely good first algebra lesson).

Sync is therefore **one-way, out**. Two-way sync is possible later but buys conflicts and
duplicate rows, and it would hand the score back to whoever can open the sheet.

## The default layout

Six tabs. Anyone can create these by hand today; the sync writes to the same names and
columns when it lands. **Only `Ledger` is written by Nimrod** — every other tab is yours.

### `Ledger` — written by Nimrod (do not hand-edit)
One row per ledger event, in order. Columns match the stream's event shape exactly:

| A | B | C | D | E | F | G | H | I |
|---|---|---|---|---|---|---|---|---|
| `Event ID` | `Timestamp` | `Type` | `Source` | `What` | `Base` | `x` | `Points` | `Minutes` |

- `Event ID` — the server's id. **The sync key**: a row is written once and never rewritten,
  so re-running the sync can't duplicate or renumber history.
- `Type` — `Obligatory · Bonus · Idea · Penalty · School · Reward`.
- `Source` — `sprint`, `progress`, a game's name. Lets you slice by where points came from.
- `Base` / `x` / `Points` — `Points = Base × x`. Negative for penalties and purchases.
- `Minutes` — only on `School` rows; the input to the weekly hours engine.

### `Task Menu` — yours
`Task | Type | Base Points | Double-eligible | Notes`. The catalog. Paste it into the
`progress` module's `tasks` state to change what the dashboard offers.

### `Rewards Store` — yours
`Reward | Need or Want | Point Cost | Notes`. Needs should cost fewer points per dollar
than wants — that asymmetry is the lesson.

### `Weekly Hours` — yours
`X` hours/day required, `Y` school days/week, `Z` stretch hours/week; weekly target =
`X*Y + Z`; points per school-hour (60 ≈ 1 point per focused minute). Bands: base to `X*Y`,
stretch (x1.5) to the target, overtime (x2) beyond it.

Hours come from `Ledger`, so this tab computes rather than collects:
`=SUMIFS(Ledger!I:I, Ledger!C:C, "School")/60`

### `Points Bank` — yours
Savings principal, weekly interest rate, compound projection; loan amount, rate, repaid,
still owed. Pure spreadsheet math — the compound-interest lesson.

### `Dashboard` — yours
Totals over `Ledger`:

- Earned: `=SUMIFS(Ledger!H:H, Ledger!C:C, "<>Reward")`
- Spent: `=-SUMIFS(Ledger!H:H, Ledger!C:C, "Reward")`
- Balance: `=SUM(Ledger!H:H)`
- Hours this week / target, band status, and whatever charts you want.

## How the sync will work (not built)

1. **You create the sheet** from the layout above (a template you copy) and share it with
   the student's Google account — ordinary Google sharing, your file, your Drive.
2. **You connect it to Nimrod** by signing in with Google and pasting the sheet's URL or
   ID. Nimrod requests the narrowest scope that works: `drive.file`, which grants access
   **only to files you explicitly pick** — not your whole Drive.
3. **Nimrod appends new `Ledger` rows** on a schedule (and after a batch of awards),
   skipping any `Event ID` already present. Nothing else on the sheet is touched, so your
   formulas, charts and edits survive every sync.
4. **If Google is unreachable, nothing breaks.** The ledger is the record; the sheet
   catches up on the next run.

### What it depends on
**Google OAuth**, which is already the top unbuilt platform feature (`docs/platform-status.md`
"Next", and the `identity.py` `current_user()` seam was built for it). This sync is an
additive slice on top: OAuth login → a `drive.file` scope → a "connect a sheet" setting
per profile → an append job. It cannot land before OAuth does.

### Deliberately not doing
- **Sheets as the store of record.** Breaks offline, and makes the score editable by
  whoever holds the sheet.
- **Two-way sync.** Conflicts and duplicates, for a convenience the one-way mirror already
  covers.
- **A service account with blanket Drive access.** `drive.file` on the owner's own account
  is narrower and easier to revoke.
