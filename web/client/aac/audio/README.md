# The spoken words on the communication board

Seventy-four WAV files: one for every word on the built-in boards (`aac_vocab.js`: Yes / No,
Talk, Core words, Library, Meals), and for the fifteen words Nimrod's own pictures are drawn for
that no built-in board has yet (Please, Mom, Dad, Pumpkin and the rest). Seventeen until
2026-11-06; the rest were made that day (row 2.234). The board and `talk.js` find them by turning
a word into a file name: lower case, every run of anything else becomes one underscore, add `.wav`.

    Yes        -> yes.wav
    Thank you  -> thank_you.wav
    Change me  -> change_me.wav

Same rule as `cici_voice.js` in the bedside build, so **one set of recordings serves both**. The
board plays the file first, falls back to the device's own synthesised voice when there is no
file, and writes the word on screen either way. A missing file is not an error.

## These are a synthesised voice, not a person

Worth saying because a folder of `yes.wav` and `love_you.wav` next to a communication board reads
like somebody's family recorded them. They did not. Every clip is **Piper** TTS, model
`en_US-libritts-high`, **speaker 552** — the same voice the whole bedside build speaks in, so the
dashboard and the board sound like one person rather than a collection of parts. Licence and full
attribution: [`ATTRIBUTIONS.md`](../../../ATTRIBUTIONS.md) at the repo root.

## Adding a word

Generate it **with that model and that speaker**. A word added to a built-in board is found by
the tool itself (its suite, `tools/test_make_board_clips.py`, fails until the word has a file):

    py -3.13 web/tools/make_board_clips.py --model <your piper folder>/en_US-libritts-high.onnx

It loads the voice once, makes only the files that are missing, and says each word with a full
stop, as the first seventeen were made (`Cici/tools/gen_aac_voice.py` in the private repo, one
word at a time). A clip made with a different engine or speaker is worse than no clip:
the board would speak in two voices, and that mismatch is more jarring than one word falling
back to the device synthesiser. If you cannot generate it in the right voice, **leave it out** —
that path is clean and tested.

`other.wav` was generated this way on 2026-09-03. It was the one word the bedside build had never
recorded, because the "something else" escape card is newer than the rest of the set.

## Pointing the board somewhere else

`clipBase` is a setting holding a URL, and `?clips=<url>` overrides it for one visit, so the
board can read its audio from a bucket or a CDN instead of from here without a code change. An
empty base turns clips off entirely. Nothing about that has to be decided to use what is here.
