// modules_catalog.js — WHAT EACH MODULE IS FOR, IN A CAREGIVER'S TERMS.
//
// Mike, twice: *"I really feel like it would be hard for someone to know what's going on
// with anything."* The module picker on the home page is fourteen bare words — "Pond",
// "Sprint", "Quests", "Lineup" — and a daughter deciding whether any of this helps her
// mother has no way to find out short of adding each one and looking.
//
// ---------------------------------------------------------------------------------------
// THE THREE THINGS SOMEBODY ACTUALLY NEEDS TO KNOW, and none of them was written down
//
//   1. WHAT DOES IT DO FOR THE PERSON I AM SETTING THIS UP FOR?
//      Not what it is. What changes for them.
//
//   2. WHAT DOES IT NEED FROM ME?
//      "Nothing" is a real and important answer, and so is "a folder of your photos" or
//      "a webcam". Somebody planning an afternoon needs to know which of these they can
//      actually get working today.
//
//   3. *** CAN THEY USE IT WITHOUT BEING ABLE TO PRESS ANYTHING? ***
//      This is the axis nobody had surfaced anywhere, and for the person this product was
//      built for it decides everything. Christine cannot reach for anything. Half of these
//      modules run entirely by themselves and half are games that need an answer, and until
//      now the only way to find out which was which was to try one.
//
//      It matters beyond her, too: it is the difference between a screen that keeps working
//      when the room is empty and one that stops and waits.
//
// ---------------------------------------------------------------------------------------
// GROUPED BY WHAT SOMEBODY IS TRYING TO DO, not alphabetically and not by architecture.
// A person arrives here with a problem ("she has nothing to look at", "her therapist wants
// to know if she is improving"), not with a shopping list of components.
//
// ---------------------------------------------------------------------------------------
// *** AND IT REPORTS ITS OWN GAPS. ***
//
// `reconcile()` compares this file against the LIVE REGISTRY. A module that is registered
// and not described here shows up as UNDESCRIBED rather than being silently missed, and a
// description here for a module that no longer exists shows up as STALE.
//
// Same trick as `/api/what-we-store`, for the same reason: a hand-written list of what the
// software contains goes out of date the first week and then quietly lies for a year. This
// one can only ever drift in the direction of admitting that it is incomplete.

// `use` is the answer to question 3 above:
//   'watch'  — runs entirely by itself. Nothing to press, ever.
//   'touch'  — responds if touched, and is perfectly fine untouched.
//   'answer' — it asks something and waits. Needs somebody who can reply.
export const USE = {
  watch: { label: 'Runs by itself', hint: 'Nothing to press. It just plays.' },
  touch: { label: 'Responds to touch', hint: 'Reacts if touched, and is fine if it never is.' },
  answer: { label: 'Asks for an answer', hint: 'Needs somebody who can reply — a touch, a switch, a key.' },
};

export const GROUPS = [
  {
    id: 'comfort',
    title: 'Something to look at',
    blurb: 'The reason most people set a screen up at all. All of these run on their own — '
      + 'nobody has to press anything for them to keep going.',
  },
  {
    id: 'practice',
    title: 'Something to do',
    blurb: 'Activities that ask a question and wait for an answer. They meet somebody where '
      + 'they are today rather than where they were, and a wrong answer still counts for '
      + 'something.',
  },
  {
    id: 'record',
    title: 'Keeping track',
    blurb: 'What happened, and whether it is getting easier. Useful to a therapist, and '
      + 'useful in a meeting where somebody needs to be told how a person is really doing.',
  },
];

// `needs` is deliberately in plain words rather than a technical dependency. "A folder of
// photos on this computer" is a thing somebody can go and get; `dependsOn: 'local'` is not.
export const CATALOG = [
  // ------------------------------------------------------------------ comfort
  {
    type: 'photos',
    group: 'comfort',
    use: 'watch',
    lead: 'Their own photos, on a loop.',
    needs: 'A folder of photos — on this computer, or on a drive plugged into it.',
    why: 'For most families this is the whole reason to set a screen up, and it is the one '
      + 'thing on this list that has been running at a bedside for months. Somebody who is '
      + 'disoriented, or who cannot turn their head, gets their own people in front of them '
      + 'instead of a wall. It never asks anything of them.',
    note: 'The pictures are read straight off your machine. They are never uploaded.',
  },
  {
    type: 'personal',
    group: 'comfort',
    use: 'watch',
    lead: 'Recorded messages from their people.',
    needs: 'A folder of video clips — messages recorded by family on their phones.',
    why: 'A photograph is their face. This is their voice. For somebody who cannot hold a '
      + 'phone or follow a call, a short clip from a grandchild is the closest thing to a '
      + 'visit, and it can be played again whenever they want it.',
    note: 'Plays from your machine. Nothing is uploaded.',
  },
  {
    type: 'youtube',
    group: 'comfort',
    use: 'watch',
    lead: 'A playlist of your own, shuffled.',
    needs: 'A YouTube playlist, and a working internet connection.',
    why: 'Their music, their programmes, the church service, the football. It shuffles with '
      + 'a bias against repeating itself, and you can set different playlists for different '
      + 'times of day so mornings and evenings are not the same.',
  },
  {
    type: 'director',
    title: 'Lineup',
    group: 'comfort',
    use: 'watch',
    lead: 'Runs the day for you.',
    needs: 'Whichever of the others you have already set up.',
    why: 'Rather than one thing on a loop, this rotates between videos, personal messages '
      + 'and learning, and changes what it favours by time of day — quiet in the early '
      + 'morning, more going on in the afternoon. It is what stops a screen becoming '
      + 'wallpaper that nobody notices any more.',
  },
  {
    type: 'camera',
    group: 'comfort',
    use: 'watch',
    lead: 'A rearview mirror for the room.',
    needs: 'A webcam.',
    why: 'This is where the whole project started. Somebody whose head is turned to a wall, '
      + 'or who cannot turn round, has no idea who is coming in or what is being done to '
      + 'them. A small corner view of the room behind them gives that back.',
    note: 'The picture stays on the device. It is not sent anywhere and it is not recorded.',
  },
  {
    type: 'clock',
    group: 'comfort',
    use: 'watch',
    lead: 'The time, the day, and the date.',
    needs: 'Nothing.',
    why: 'Somebody coming out of a long hospital stay often has no idea what day it is, and '
      + 'asking repeatedly is its own kind of distress. It sits in a corner and answers the '
      + 'question before it is asked.',
  },
  {
    type: 'pond',
    group: 'comfort',
    use: 'touch',
    lead: 'Calm water that ripples when it is touched.',
    needs: 'Nothing.',
    why: 'There is nothing to get right and nothing to lose. For somebody who is agitated, '
      + 'or who has been failing at things all day in therapy, a screen that simply responds '
      + 'and never judges is worth more than another exercise.',
  },
  {
    type: 'call',
    // NOT 'comfort'. A call needs answering, and that group promises the opposite.
    group: 'practice',
    use: 'answer',
    lead: 'Whoever is calling, full screen.',
    needs: 'A network, and somebody to call them.',
    why: 'The caller fills the screen and the small picture-in-picture keeps showing this '
       + 'room, which is the layout people already know from every video call. An audio call '
       + 'shows their name instead of a black rectangle. It does NOT answer by itself unless '
       + 'you turn that on for people you have chosen - a screen that answers on its own is a '
       + 'microphone in the room.',
  },
  {
    type: 'pressgame',
    // NOT 'comfort'. That group's promise on the page is that nothing in it needs pressing to
    // keep going, and in calm mode this waits on her press for as long as it takes - which is
    // the point of it, and would make the promise false.
    group: 'practice',
    use: 'answer',
    lead: 'Hold off while a charge builds, then press when the invite opens.',
    needs: 'Nothing, to play. Somewhere to save, if you want to keep the record.',
    why: 'The go/no-go task a therapist runs by hand, with the waiting made worth something: '
       + 'the longer she holds off, the bigger the payoff. In calm mode the invite never times '
       + 'out - it waits for her, so there is no way to fail it - and only challenge mode '
       + 'closes the window. It writes down every press and release with its timing, including '
       + 'presses the game itself ignored, as evidence for a clinician to read rather than as '
       + 'a score.',
  },
  {
    type: 'comet',
    group: 'comfort',
    use: 'touch',
    lead: 'A comet that follows your movement, with hearts to catch.',
    needs: 'Nothing.',
    why: 'The head sits exactly where the pointer is and never drifts on its own, which is '
      + 'the whole point: it makes your own movement unmistakably the thing that moved it. '
      + 'For somebody re-learning that they can affect anything at all, that is the question '
      + 'worth answering. It can also be driven with a single switch, which goes and gets a '
      + 'heart for you.',
  },

  // ------------------------------------------------------------------ practice
  {
    type: 'educational',
    group: 'practice',
    use: 'watch',
    lead: 'Gentle alphabet, counting and vocabulary, spoken aloud.',
    needs: 'Nothing.',
    why: 'Deliberately the easiest thing here, and it runs by itself — no answer is required '
      + 'and nothing is scored. It is for the stretch of recovery where taking part is not '
      + 'possible yet but hearing language still matters.',
  },
  {
    type: 'bank',
    group: 'practice',
    // `touch`, not a new value. The catalogue's `use` set is CLOSED and it caught `setup` the
    // moment it was invented — which is the set doing its job, so the fix is to fit rather than
    // to widen it. Typing into an editor is a thing you do with your hands, which is what
    // `touch` already means here.
    use: 'touch',
    lead: 'Where your questions and words live.',
    needs: 'Nothing. Type them, or paste a list in.',
    why: 'Trivia and Word Forge both read this, so a word written once can be practised in one '
      + 'and asked as a question in the other. Put it on a screen with either of them and you '
      + 'can edit while somebody plays.',
    note: 'It tells you which lines it could not read, and on which line — the usual way a '
      + 'hand-written list quietly loses half of itself.',
  },
  {
    type: 'trivia',
    group: 'practice',
    use: 'answer',
    lead: 'A quiz built from questions you write yourself.',
    needs: 'Nothing. Add your own questions in settings.',
    why: 'The score is about knowing things, never about how clearly somebody speaks — so it '
      + 'can be played out loud by somebody whose speech is hard to understand without ever '
      + 'being marked down for it. Four choices and one button, so a switch is enough.',
    note: 'It can also record the room while it is played, which is how a computer learns to '
      + 'understand one particular person later. That is off unless you turn it on.',
  },
  {
    type: 'wordforge',
    group: 'practice',
    use: 'answer',
    lead: 'A word game where a wrong answer explains itself.',
    needs: 'Nothing.',
    why: 'A wrong answer gets the explanation rather than a buzzer, and still earns '
      + 'something. Somebody who is relearning language does not need another thing telling '
      + 'them they got it wrong.',
  },
  {
    type: 'lessons',
    group: 'practice',
    use: 'answer',
    lead: 'Watch something short, then answer questions about it.',
    needs: 'Nothing to start — you can add your own later.',
    why: 'Attention and recall, in the order they actually get used: take something in, then '
      + 'be asked about it. The questions unlock only after the lesson, so it cannot be '
      + 'guessed through.',
  },
  {
    type: 'algebra',
    group: 'practice',
    use: 'answer',
    lead: 'Solve for x, with a calculator on screen.',
    needs: 'Nothing.',
    why: 'The calculator is on screen on purpose. Somebody whose arithmetic is slower than '
      + 'it used to be has not lost the method, and being made to do sums by hand tests the '
      + 'wrong thing and is demoralising.',
  },
  {
    type: 'sprint',
    group: 'practice',
    use: 'answer',
    lead: 'A focus timer — finish a sprint, bank the points.',
    needs: 'Nothing.',
    why: 'A short, bounded stretch of effort with a definite end. Useful when starting is '
      + 'the hard part, which after a brain injury it very often is.',
  },
  {
    type: 'quests',
    group: 'practice',
    use: 'answer',
    lead: 'Points, tasks and rewards.',
    needs: 'Nothing.',
    why: 'The ledger the games pay into, and somewhere to spend it on things that matter to '
      + 'the person rather than to the software.',
  },

  // ------------------------------------------------------------------ record
  {
    type: 'progress',
    group: 'record',
    use: 'watch',
    lead: 'How they are doing over time.',
    needs: 'Anything above that asks questions.',
    why: 'Accuracy, which ideas are hard, and how quickly answers come. It is built for the '
      + 'conversation where somebody has to say whether a person is improving and wants '
      + 'something better than an impression to say it with.',
  },
];

// Modules that exist in the registry but are deliberately not offered to a caregiver: dev
// instrumentation, and one retired module kept only so old screens do not break. Listed
// rather than filtered silently, so `reconcile` cannot mistake them for an oversight.
export const NOT_FOR_CAREGIVERS = {
  counter: 'a development test panel',
  presslog: 'a development test panel',
  interstitials: 'retired — replaced by Lineup',
};

/**
 * Compare this catalogue against the live registry.
 *
 * Returns `{ described, undescribed, stale, internal }`. `undescribed` is the one that
 * matters: a module somebody shipped and nobody explained.
 */
export function reconcile(manifests = []) {
  const registered = new Set(manifests.map((m) => m && m.type).filter(Boolean));
  const described = new Set(CATALOG.map((c) => c.type));
  const internal = new Set(Object.keys(NOT_FOR_CAREGIVERS));

  return {
    described: CATALOG.filter((c) => registered.has(c.type)),
    // Registered, shown to people, and never explained.
    undescribed: [...registered].filter((t) => !described.has(t) && !internal.has(t)).sort(),
    // Described here but no longer in the build — a leftover that would send somebody
    // looking for something that is not there.
    stale: CATALOG.filter((c) => !registered.has(c.type)).map((c) => c.type),
    internal: [...registered].filter((t) => internal.has(t)).sort(),
  };
}

/** The catalogue entries for one group, in declared order. */
export function groupItems(groupId, manifests = []) {
  const registered = new Set(manifests.map((m) => m && m.type).filter(Boolean));
  return CATALOG.filter((c) => c.group === groupId && registered.has(c.type));
}

/** The display name: the catalogue's override, else the manifest's title, else the type. */
export function titleFor(entry, manifests = []) {
  if (entry.title) return entry.title;
  const m = manifests.find((x) => x && x.type === entry.type);
  return (m && m.title) || entry.type;
}
