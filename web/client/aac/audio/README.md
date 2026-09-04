# Recorded voice for the communication board

This folder is where `/talk.html` looks for a recording of each word: lower-case the word,
turn every run of anything else into one underscore, add `.wav`.

    Yes        -> yes.wav
    Thank you  -> thank_you.wav
    Change me  -> change_me.wav

Same rule as `cici_voice.js` in the bedside build, so **one set of recordings serves both**.
The board tries the recording first, a synthesised voice second, and writes the word on screen
either way. A missing file is not an error — it falls through silently.

**The folder is empty on purpose, and that is a decision waiting on Mike, not an oversight.**

## What already exists

51 recordings are in the private repo at
`Nimrod_Ecosystem/Cici/dashboard_web/assets/aac/audio/` (1.4 MB), and **16 of the 17 words the
two shipped boards use already have one.** The only one missing is `other.wav` — the escape
card on the Yes / No / Other board, which is the newest word and was never recorded.

## Why they were not copied here

They are a real person's voice, and this is a **public** repository whose history is permanent.
That is the same class of thing as the two first names that had to be taken out of the working
tree in F0, and it is not a call to make on somebody's behalf. It is also not obviously wrong —
they may be exactly what should ship. It is Mike's to say.

## The three ways to answer it

1. **Commit them here.** ~450 KB for the seventeen words. Simplest, fastest, cached by the CDN,
   works with no infrastructure. The cost is that a real voice is in public git history forever.
2. **Host them somewhere else and point at it.** `clipBase` is a setting and `?clips=<url>`
   overrides it, so no code changes. The host has to allow cross-origin reads.
3. **Ship synthesised clips instead** — generated once, no real voice, and every device gets a
   voice whether or not it has a synthesiser. Loses what makes a recording worth having.

Nothing here assumes an answer. Whichever way it goes, the page already works.

## To try option 1 locally without deciding anything

Copy the words the board uses out of the private repo. This folder's `.wav` files are ignored
by git, so nothing is staged and nothing is published — it just makes the recordings work on
your own machine and on a Pi.

    web/client/aac/audio/copy_from_bedside.sh
