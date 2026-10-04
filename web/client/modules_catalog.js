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
//      built for it decides everything. Some people cannot reach for anything. Half of these
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

// *** WHAT THE SEEDED STARTER SCREEN MOUNTS, IN SLOT ORDER (TL, TR, BL, BR). ***
//
// It lives here, in the data-only file, because THREE places need to agree about it and two of
// them were already wrong. `local_store.js` builds the screen; the landing page tells strangers
// what the default dashboard is; `steps.js` claims it as the data gate's answer to "was anything
// real in frame?". The landing page was hand-written HTML and still advertised **camera** as one
// of the four defaults months after Mike removed it — he found that by reading his own site.
//
// A list in a comment is a promise. A list everybody imports is a fact.
export const STARTER_MODULES = ['photos', 'youtube', 'wordforge', 'clock'];

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
  // 2026-10-04. Mike, on the voice-model steps: *"I think this might need to be a module that walks people through
  // the setup for it ... I guess maybe just a part of the AI module? Or in a set of AI modules?"* A SET, argued: the
  // guide (`nimrod`) is about the whole site, not about speech, and a voice model is a separate piece of software
  // somebody may want without the guide - one module each, grouped. ONE GROUP PER MODULE on this page, so Nimrod
  // and the profile card move here from "Something to do" and "Keeping track" (the library's chips are tags, and
  // keep them under Tools and People as well).
  {
    id: 'ai',
    title: 'AI',
    blurb: 'Your guide, AI characters to talk to, and a speech recogniser trained on your own voice. The AI costs '
      + 'nothing by default: it runs on your own computer, or on a key you bring. Claude on this account and the '
      + 'wake phrases are settings, not panels: they are in the ⚙ menu (Devices) and in Modules under AI.',
  },
];

// `needs` is deliberately in plain words rather than a technical dependency. "A folder of
// photos on this computer" is a thing somebody can go and get; `dependsOn: 'local'` is not.
// *** THE SIX NAMES BELOW THAT CARRY AN EXPLICIT `title`. ***
//
// `titleFor()` falls back to the module manifest, which is right for the composer — it has the
// manifests loaded. The LANDING PAGE does not: importing twenty-one module implementations to
// print twenty-one names would be a heavy price on the one page most likely to be opened on a
// phone, in a hospital corridor, on bad wifi.
//
// So a name that title-casing the type would get wrong is written here. That is a duplicate of
// the manifest, and duplicates drift — which is the whole defect this file was just used to fix.
// `composer_reach_test.html` therefore asserts every one of them still equals its manifest's
// title. The duplicate is allowed to exist because it cannot go quietly wrong.
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
    title: 'Personal videos',
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
    title: 'YouTube',
    group: 'comfort',
    use: 'watch',
    lead: 'A playlist of your own, shuffled.',
    needs: 'A YouTube playlist, and a working internet connection.',
    why: 'Their music, their programs, the church service, the football. It shuffles with '
      + 'a bias against repeating itself, and you can set different playlists for different '
      + 'times of day so mornings and evenings are not the same.',
  },
  // Row 2.32: music by name, by voice, switch or touch - one list, every way in ends at `music/play`.
  {
    type: 'music',
    title: 'Music',
    group: 'comfort',
    use: 'watch',
    lead: 'Their favourite music, by name.',
    needs: 'A few favourites: YouTube links, music files in a connected folder, or Spotify '
      + '(Premium, optional).',
    why: 'Say “computer please play” and a name, or press it. The family writes the list once; '
      + 'the same names work by voice, by switch and by touch.',
  },
  // Row 2.45. A first version, and the catalog says so.
  {
    type: 'karaoke',
    title: 'Sing along',
    group: 'comfort',
    use: 'watch',
    lead: 'Karaoke videos from YouTube, with the words on screen, to sing along with.',
    needs: 'Some karaoke videos (search for them in the panel, or paste links), and a working '
      + 'internet connection. Searching needs your own YouTube key.',
    why: 'A song somebody has known for years can be easier to join in with than a conversation. '
      + 'The words come from the videos themselves, so nothing here has to store them.',
    note: 'A first version: it plays and shuffles the songs. There is no scoring and no song list '
      + 'chosen for you.',
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
    type: 'board',
    // *** "AAC board", not "Talk". *** Mike, 2026-09-06: people searching for this know the
    // term AAC and nobody recognises "Talk" as the thing they need. The words `AAC` and
    // `communication board` are in the copy below for the same reason — this page's search
    // reads `lead`, `why` and `needs`, so a term that appears nowhere in them is a term that
    // finds nothing.
    title: 'AAC board',
    // NOT 'comfort'. A board is a tool somebody uses on purpose, and that group promises
    // something to look at.
    group: 'practice',
    use: 'answer',
    lead: 'An AAC communication board — big cards that say the word out loud when chosen.',
    needs: 'Nothing. A speaker, if you want it heard.',
    why: 'It is a way to say something when speaking is hard: a set of care words, or just '
      + 'yes, no and "something else". It can be touched, or it can walk the cards one at a '
      + 'time so somebody with a single switch can answer. Switch boards from the row above '
      + 'the cards. It says the word in the room and nowhere else: it is not a nurse call and '
      + 'does not reach anybody who is not there.',
    // SAYS WHAT THE SHIPPED BOARD IS, rather than letting somebody assume it is a starter set
    // (D13). `aac_vocab.js` is explicit that the 16-word board was built for one person and has
    // no eat / drink / hungry / thirsty cards, "which for anybody else is a hole in the middle
    // of their vocabulary rather than a considered omission." That warning was true and lived
    // only in a source comment; the person it needs to reach is the one choosing this module.
    // The default itself is Mike's call and stands (G8) — this is honesty about it, not a
    // change to it, and the real answer is a proper starter vocabulary, which is D13.
    // It opens on Yes / No / Other. The 16-word board is there as a WORKED EXAMPLE of what a
    // custom board looks like -- Mike's framing, and it turns the thing that made it a bad
    // default into the thing that makes it useful (D13).
    note: 'It opens on Yes / No / Other. The 16-word care board is included as an example of '
      + 'what a board somebody has written for one person looks like — it has no food or drink '
      + 'cards, because they did not apply to the person it was made for.',
  },
  {
    type: 'wallpaper',
    group: 'comfort',
    use: 'watch',
    lead: 'Something calm on screen, instead of a frozen picture.',
    needs: 'Nothing. A folder of your own pictures or video is optional.',
    why: 'It is what shows while a video is paused, so a screen somebody stepped away from '
      + 'looks like it is waiting rather than broken — a stopped picture of a face reads as a '
      + 'fault, and this one sits in a room for hours. On its own it is a quiet background '
      + 'that needs no files and no network. Movement is a setting with a still option, '
      + 'because a full-screen animation running unattended is where photosensitivity '
      + 'actually matters.',
  },
  {
    type: 'scene',
    group: 'comfort',
    use: 'watch',
    lead: 'A calm animated world — woods, an aquarium, a night sky.',
    needs: 'Nothing.',
    why: 'Something to look at that is never the same twice and never asks for anything. Each '
      + 'scene is a whole place with depth to it rather than a pattern, and all of the movement '
      + 'is slow. It can hold a screen on its own, or sit behind an AAC board with the cards '
      + 'see-through.',
    note: 'Movement can be slowed or stopped, and it stops by itself if the device asks for '
      + 'reduced motion.',
  },
  {
    // Rows 2.33/2.34/2.37: Claude Design's rooms, rendered by `room_scene.js`. `touch`: left alone
    // it is a room with a clock on the wall and nothing waits on anybody; pressing its furniture
    // does things (the flower pot is full screen, the door is settings, the cabinet lifts the bar).
    type: 'room',
    group: 'comfort',
    use: 'touch',
    lead: 'A room to look into, with a window, a clock and a calendar on the wall.',
    needs: 'Nothing.',
    why: 'A familiar place instead of a flat screen: a sofa, a lamp, a window onto a live scene, '
      + 'and the time and date on the wall where anybody would look for them. It follows the real '
      + 'clock, so the lamp comes on in the evening and the window goes dark at night, while the '
      + 'clock, the calendar and the pictures stay bright enough to read. The furniture can hold '
      + 'the screen’s own controls: every piece that does something carries a label, and a switch '
      + 'can walk them one at a time.',
    note: 'Five rooms to start from, drawn with Claude Design. Movement can be slowed or stopped, '
      + 'and stops by itself if the device asks for reduced motion.',
  },
  // Row 2.37. `touch`: left alone it is a note on the wall, and nothing waits on anybody.
  {
    type: 'note',
    title: 'Note from someone',
    group: 'comfort',
    use: 'touch',
    lead: 'A short note somebody left, with who wrote it and when.',
    needs: 'Nothing. Somebody to leave a note: on this screen, or from a phone or computer signed in '
      + 'to the same account.',
    why: 'Words from a person who was here, in their own name, where they will be seen: a sticky '
      + 'note, the fridge, a desk. It can be read aloud, and changed by typing or, with no keyboard, '
      + 'by picking a ready-made note. Every earlier note is kept and can be put back.',
  },
  // Row 2.37 item 5: an optional drawn avatar for a person ("kind of like Miis"), or a picture instead.
  {
    type: 'avatar',
    title: 'Avatar maker',
    group: 'comfort',
    use: 'touch',
    lead: 'A drawn avatar for a person, made a part at a time, or a picture instead.',
    needs: 'Nothing. A picture folder in Media to use a picture.',
    why: 'A friendly face for a person on any screen, like a game character. Optional; it moves gently, '
      + 'and stays still when motion is turned down.',
  },
  // Row 2.37 item 4 (the weather behind the room's window). `touch`: it updates by itself; a touch reads it aloud.
  {
    type: 'weather',
    group: 'comfort',
    use: 'touch',
    lead: 'The weather now, the next few hours and the next few days, in big words and pictures.',
    needs: 'A place, typed once in its settings: a town, or a latitude and longitude. It is sent to '
      + 'Open-Meteo, a free weather service. Nothing is sent until a place is set.',
    why: 'A window on the day outside, with the words next to every picture. A touch or one switch '
      + 'press reads it aloud. When the connection drops it keeps the last weather it had and says how old it is.',
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
    title: 'Wait and Go',
    // NOT 'comfort'. That group's promise on the page is that nothing in it needs pressing to
    // keep going, and in calm mode this waits on her press for as long as it takes - which is
    // the point of it, and would make the promise false.
    group: 'practice',
    use: 'answer',
    lead: 'Hold off while a charge builds, then press when the invite opens.',
    needs: 'Nothing, to play. Somewhere to save, if you want to keep the record.',
    why: 'The go/no-go task a therapist runs by hand, with the waiting made worth something: '
       + 'the longer they hold off, the bigger the payoff. In calm mode the invite never times '
       + 'out - it waits for them, so there is no way to fail it - and only challenge mode '
       + 'closes the window. It writes down every press and release with its timing, including '
       + 'presses the game itself ignored, as evidence for a clinician to read rather than as '
       + 'a score.',
  },
  {
    // MOVED FROM `comfort` TO `practice`, 2026-09-20 (Mike, looking at the live catalog: "Comet
    // is still under something to look at"). It asks for an intentional catch, not passive
    // viewing - `use: 'touch'` already said as much ("reacts if touched"), the group just
    // hadn't caught up to it.
    type: 'comet',
    group: 'practice',
    use: 'touch',
    lead: 'A comet that follows your movement, with hearts to catch.',
    needs: 'Nothing.',
    why: 'The head sits exactly where the pointer is and never drifts on its own, which is '
      + 'the whole point: it makes your own movement unmistakably the thing that moved it. '
      + 'For somebody re-learning that they can affect anything at all, that is the question '
      + 'worth answering. It can also be driven with a single switch, which goes and gets a '
      + 'heart for you.',
  },
  {
    // A HEADLESS SIBLING OF COMET, NOT A SECOND COPY OF THE SAME MODULE. Mike, 2026-09-26: "I
    // would even add an option to comet to... go headless, so the balloons go over the other
    // modules" — built as its own module (`mount:'ambient'`) rather than a setting on `comet`
    // itself, because the two need genuinely different homes (a dashboard slot vs. no slot at
    // all) — see MIKE_CHANGE_LIST.md §comet-headless-toggle-proposal for the full reasoning.
    type: 'comet_ambient',
    group: 'comfort',
    use: 'watch',
    lead: 'Hearts drifting behind your other panels — decorative by default.',
    needs: 'Nothing.',
    why: 'Does not take a dashboard slot of its own — it sits behind whatever else is on '
      + 'screen, the same layer a wallpaper drifts on. Set to "just for looks" it is pure '
      + 'scenery; set to "something to catch" it becomes a small, quiet game layered over '
      + 'everything else, worth points, without ever covering the thing you were already '
      + 'looking at.',
    note: 'Interactive mode has no dedicated place on the switch-scan cycle yet — a caregiver '
      + 'binds a switch to it directly, the same as any module, rather than it being "whatever '
      + 'is currently focused."',
  },

  {
    type: 'button',
    group: 'comfort',
    // `touch`: left alone it is a sign or a picture on the wall, and nothing waits on anybody.
    use: 'touch',
    lead: 'Words, a picture, or both, on something you can press.',
    needs: 'Nothing for words. A picture comes from your Media — a folder on this computer, or '
      + 'your media agent.',
    why: 'A name on a sign, a photo in a frame, a label on the wall: one button, set up entirely '
      + 'from the settings menu — the words, a font, the colours, a frame, and whether pressing '
      + 'it says the words out loud. The first step of the Nimrod game builds a profile out of two '
      + 'of them.',
    note: 'Six sign styles and seven frames, drawn with Claude Design. Until you pick a colour for '
      + 'the words, they take the one that reads best on the sign. Choosing a picture walks '
      + 'the pictures in a source one at a time, so a small folder of the ones you want is '
      + 'quickest.',
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
    title: 'Questions',
    group: 'practice',
    // `touch`, not a new value. The catalog's `use` set is CLOSED and it caught `setup` the
    // moment it was invented — which is the set doing its job, so the fix is to fit rather than
    // to widen it. Typing into an editor is a thing you do with your hands, which is what
    // `touch` already means here.
    use: 'touch',
    lead: 'Where your questions and words live.',
    needs: 'Nothing. Type them, or paste a list in.',
    why: 'Trivia and Word Forge both read this, so a word written once can be practiced in one '
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
    title: 'Word Forge',
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
    // HONEST ABOUT THE HALF THAT IS NOT BUILT (G12). This said "Nothing to start - you can add
    // your own later", which implies lessons are already there to watch. They are not: the
    // three shipped topics carry no videos, and nothing on this site can attach one yet. The
    // module is still real - unlocking a topic puts its questions into the game - so it is
    // described as what it is rather than dropped from the page.
    needs: 'Nothing — but no lesson videos are chosen yet, so today it unlocks topics rather '
      + 'than playing anything.',
    why: 'Attention and recall, in the order they actually get used: take something in, then '
      + 'be asked about it. The questions unlock only after the lesson, so it cannot be '
      + 'guessed through.',
  },
  {
    type: 'algebra',
    group: 'practice',
    use: 'answer',
    lead: 'Counting and small sums for beginners, then solve for x with a calculator on screen.',
    needs: 'Nothing.',
    why: 'The calculator is on screen on purpose. Somebody whose arithmetic is slower than '
      + 'it used to be has not lost the method, and being made to do sums by hand tests the '
      + 'wrong thing and is demoralising.',
  },
  {
    type: 'word_games',
    title: 'Word games',
    group: 'practice',
    use: 'answer',
    lead: 'Opposites, rhyming and yes-or-no questions, asked out loud with a picture.',
    needs: 'Nothing. The words and pictures are built in.',
    why: 'Every question can be answered with one switch: it offers one answer at a time and '
      + 'asks "is it this one?". A miss gets a hint rather than a buzzer, and after two it offers '
      + 'the answer. Built so a spoken answer can be added later without changing the game.',
    note: 'It does not listen to the room yet. When voice is added, a word it is unsure of is '
      + 'checked with the person first, never marked wrong.',
  },
  // Row 2.45: three more answer games on the same miss flow as word games, and a sing-along.
  {
    type: 'spelling',
    group: 'practice',
    use: 'answer',
    lead: 'A word is said out loud, with its picture where there is one, and the player spells it.',
    needs: 'Nothing. The words and pictures are built in.',
    why: 'The letters are on a board that one switch can walk (a row, then a letter), and they '
      + 'can be touched or said aloud too. A miss gets the first letter as a hint, then how many '
      + 'letters there are, never a buzzer.',
  },
  // Row 2.45, corrected 2026-10-01: simple math is not its own game (it is Math's Beginner level);
  // these are the SLP's exercises, adaptive per player.
  {
    type: 'think_games',
    title: 'Thinking games',
    group: 'practice',
    use: 'answer',
    lead: 'Smallest or biggest of three, name the group, finish the sentence.',
    needs: 'Nothing. The questions are built in.',
    why: 'Each player gets questions at their own level, and it gets harder after nine right out of ten. '
      + 'Two people can take turns on one screen. Missed questions come back later, further apart each time.',
  },
  {
    type: 'word_builder',
    title: 'Word builder',
    group: 'practice',
    use: 'answer',
    lead: 'A few big letters: find the words they make.',
    needs: 'Nothing. The words are built in.',
    why: 'Three letters to start, more as the words come easily, for each player. Read aloud; say the word, '
      + 'build it on one switch, or touch the letters. A real word that is not on its list is not marked wrong.',
  },
  {
    type: 'brain_games',
    title: 'Brain games',
    group: 'practice',
    use: 'answer',
    lead: 'Quick rounds: which one is different, remember the order, how many dots, what comes next.',
    needs: 'Nothing. The questions are built in.',
    why: 'Short rounds, each player at their own level. Nothing is timed unless that is turned on.',
  },
  // 2026-10-02: name the suit, then put the card in order among the ones already done.
  {
    type: 'card_sort',
    group: 'practice',
    use: 'answer',
    lead: 'Name the suit of a big playing card, then say whether it is higher or lower than cards already done.',
    needs: 'Nothing. The deck is built in.',
    why: 'It starts with the suit alone and works up to putting a card in order among several, each player at '
      + 'their own level. Say the answer, touch it, or walk the choices on one switch. Every suit has its colour, '
      + 'its symbol and its name, never a colour alone. It waits for Start.',
  },
  // 2026-10-02 (Mike's landing Home): the guide, the devices list, and What's new.
  {
    type: 'nimrod',
    title: 'Nimrod',
    group: 'ai',      // 2026-10-04: the AI set (was 'practice')
    use: 'touch',
    lead: 'A guide: what everything does, and what to try next.',
    needs: 'Nothing.',
    why: 'Choices you can walk back through, a map of where you are, and an explanation of whatever you point at. '
      + 'Replace him whenever you like; say “tutorial” to find him again.',
  },
  {
    type: 'devices',
    group: 'practice',
    use: 'touch',
    lead: 'Every way of telling the screen what to do, and where each is set up.',
    needs: 'Nothing.',
    why: 'Voice, tracking, keys and switches, phones and other screens, in one list, each one press from its settings.',
  },
  // 2026-10-02 (Mike: "That could actually be the modules module"): the library of everything addable.
  // `touch`: left alone it is a grid to look at, and nothing waits on anybody.
  {
    type: 'library',
    title: 'Modules',
    group: 'practice',
    use: 'touch',
    lead: 'Everything you can put on a screen, to look through: modules, scenes, furniture and 3D bricks.',
    needs: 'Nothing.',
    why: 'Sorted and filtered by what you are after (games, learning, something to look at, people), with a '
      + 'search. One press shows what a thing is and what it needs; a second puts it where this panel is. '
      + 'Switch module opens it in the place of the panel you chose, and puts that panel back if you change your mind.',
    note: 'Nothing here costs money. In the Nimrod Game some things unlock as you play; sandbox, one choice away, '
      + 'unlocks everything.',
  },
  {
    type: 'whats_new',
    title: 'What’s new',
    group: 'record',
    use: 'touch',
    lead: 'What changed lately, newest first, and where to find it.',
    needs: 'Nothing.',
    why: 'Patch notes in plain words, so a new thing is something you can go and use.',
  },
  // 2026-10-02 (ai_characters.js): a person or an AI character, as a card.
  {
    type: 'profile',
    title: 'Profile',
    group: 'ai',      // 2026-10-04: the AI set, for its AI characters (was 'record')
    use: 'touch',
    lead: 'A person or an AI character, as a card: their face, their name, and what you can do with them.',
    needs: 'Nothing for the card. Talking to an AI needs one connected to this device (Ollama, free, or your own key).',
    why: 'Talk to an AI character, or open its room: a math tutor’s room has the calculator. People on this '
      + 'account show here too; friends on other accounts will once accounts can be linked.',
  },
  // 2026-10-02 (edit_mode.js): the panel editor's options, as a panel of their own.
  {
    type: 'options',
    group: 'practice',
    use: 'touch',
    lead: 'The options of whatever you choose in a panel you are editing.',
    needs: 'Nothing.',
    why: 'Press ✎ on a panel, then press a thing in it: its words, its picture, the whole panel. Its options show here.',
  },
  {
    type: 'name_that',
    group: 'practice',
    use: 'answer',
    lead: 'Name that animal, state, or person. Person plays the family’s own recorded messages and '
      + 'asks who it is.',
    needs: 'Nothing for animals and states. For people: videos of at least two people, named after '
      + 'the person in them, in a connected media source.',
    why: 'The people game is the messages from the family with a question on top, so the answer '
      + 'is also the reward. A missed name is met gently by default: it says whose message it was '
      + 'and offers to play it again.',
  },
  // Row 2.37: the first card game.
  {
    type: 'solitaire',
    group: 'practice',
    use: 'answer',
    lead: 'Klondike solitaire, with big cards in four suit colours.',
    needs: 'Nothing. The deck and the rules are built in.',
    why: 'A move is two short choices: pick a card, then pick from the places it can go. One switch '
      + 'can play a whole game, and so can a touch or a mouse; nothing needs a drag. There is no '
      + 'timer and no losing screen: when nothing helps, it offers Undo or a new deal.',
  },
  // Row 2.37 item 10: games on the room's bricks and floor tiles, standalone first.
  {
    type: 'brickbreaker',
    group: 'practice',
    use: 'answer',
    lead: 'Knock down a wall of bricks with a ball and a paddle.',
    needs: 'Nothing. The wall, the ball and the sounds are built in.',
    why: 'One switch can play: the paddle glides by itself and a press stops it where the ball will land. '
      + 'The ball is slow by default and a missed ball just comes back; there is no losing screen.',
  },
  {
    type: 'rhythm',
    group: 'practice',
    use: 'answer',
    lead: 'Tiles light up to a beat; press on the beat.',
    needs: 'Nothing. The beat is built in, or it can follow a tempo on the screen.',
    why: 'One press is the whole game, so one switch plays it. Slow and forgiving by default, it never '
      + 'flashes more than three times a second, and a hit shows as a mark and words, not only a colour.',
  },
  {
    type: 'sprint',
    // NO `title` OVERRIDE HERE, and that is deliberate after `composer_reach` caught one.
    //
    // A catalog `title` is a DUPLICATE of the module's manifest title, carried so the landing
    // page can print names without importing twenty-one module implementations on hospital
    // wifi. The suite asserts the two match, because a duplicate nobody checks is exactly how
    // that list came to advertise `camera` as a default for weeks after it stopped being one.
    //
    // The rename (G13) set the manifest to "Focus timer" and briefly set this to
    // "Focus timer (Pomodoro)", which broke that invariant to buy nothing: the parts page
    // searches `lead`, `why` and `needs`, and "Pomodoro" is in all three plus the manifest
    // description. The word is findable; the second name was not needed.
    group: 'practice',
    use: 'answer',
    lead: 'A Pomodoro timer — finish a sprint of focused work, bank the points.',
    needs: 'Nothing.',
    why: 'A short, bounded stretch of effort with a definite end — the Pomodoro technique, '
      + 'twenty-five minutes and a break. Useful when starting is the hard part, which after '
      + 'a brain injury it very often is.',
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
  {
    type: 'calculator',
    group: 'practice',
    // `touch`, not `answer`: it asks nothing and waits on nobody. Left alone it just shows 0, and
    // a screen that has one on it is not stalled by it, which is what the `touch` legend says.
    // It does need somebody to press keys to be of any use, and the copy below does not hide that.
    use: 'touch',
    lead: 'A four-function calculator, on a panel of its own.',
    needs: 'Nothing. It works with no internet.',
    why: 'For working something out without leaving the screen, and without it being buried '
      + 'inside the Math game. The keys can be touched or walked with a switch. It can also '
      + 'pass its answer on to another panel that takes one; there is no screen for setting '
      + 'that up yet, so today that link is written into the data behind the screen by hand.',
  },
  {
    type: 'reading_log',
    group: 'record',
    use: 'touch',
    lead: 'What they have read — title, author, how far, and when.',
    needs: 'Nothing. Type it in as you go.',
    why: 'A plain record of what was read, worth keeping on its own, and readable by anyone '
      + 'who wants to know what someone has gotten through lately. It is also the raw '
      + 'material a later feature can build questions from — not built yet, so today this '
      + 'only keeps the log.',
  },
  {
    type: 'scoreboard',
    group: 'record',
    // `touch`: it asks nothing and waits on nobody. A followed score moves by itself; a counter
    // only moves when somebody presses +1, and one that is never pressed is still just a number.
    use: 'touch',
    lead: 'Any count worth keeping, against a target you choose.',
    needs: 'Nothing. Or a game on the same screen whose score it can follow.',
    why: 'Books read this week, glasses of water today, questions right in Trivia: one board for '
      + 'all of them, instead of every game drawing its own. A target is a fact, not a verdict, '
      + 'so nothing turns red for being under it. It can also show a single count, large, on its '
      + 'own.',
  },
  // Row 2.44: the recordings voice_recording.js kept on this device, reviewed a pair at a time. `touch`: it
  // plays nothing until somebody presses Play, and left alone it is a list.
  {
    type: 'voice_review',
    title: 'Voice recordings',
    group: 'record',
    use: 'touch',
    lead: 'The voice recordings this screen kept, to say what was meant.',
    needs: 'Voice recording turned on for a person, and speech listening.',
    why: 'Each recording is a pair: what was said, and what the recogniser wrote. Playing one and '
      + 'typing what was meant is how a recogniser can learn a voice it keeps getting wrong. The '
      + 'recordings stay on this screen, and leave it only when somebody exports them to a folder.',
    note: 'Recording is off unless it is turned on for one person, and the screen shows whenever it records.',
  },
  // 2026-10-04 (modules/voice_model.js): the six voice-model steps as a guided panel, in the AI set. `touch`: left
  // alone it shows one step and waits on nobody; the recording in step 1 happens only after Start.
  {
    type: 'voice_model',
    title: 'Voice model',
    group: 'ai',
    use: 'touch',
    lead: 'A speech recogniser trained on one person’s own voice, set up one step at a time.',
    needs: 'A microphone on the screen, to read about 100 short phrases. Then a computer: a free Google account to '
      + 'train on, or a computer with a graphics card, and the speech service running on it.',
    why: 'For somebody whose speech an ordinary recogniser keeps getting wrong. It walks the six steps one at a '
      + 'time (record the phrases here, export them, train, convert, put the folder in place, start the service) '
      + 'and works out which step you are on from what it can see. The folder, the port and on or off stay in the '
      + 'same panel afterwards.',
    note: 'Nothing is uploaded by this site: the recordings stay on the screen until you export them to a folder. '
      + 'It does not run on a Raspberry Pi.',
  },
];

// Modules that exist in the registry but are deliberately not offered on THIS page: dev
// instrumentation, one retired module kept only so old screens do not break, and (as of
// 2026-09-20) device modules. Listed rather than filtered silently, so `reconcile` cannot
// mistake any of them for an oversight.
//
// DEVICE MODULES (keyboard, and whatever follows it) ARE REAL AND ADDABLE — Mike, looking at
// `keyboard` shown here: "I don't think keyboard needs to be on the modules page... it's more
// of a place to try out the different software modules." This page and its "what does it do
// for the person, what does it need, can they use it without pressing anything" framing (see
// the file header) is about CONTENT/ACTIVITY modules a caregiver is choosing between for the
// person the screen is set up for — a device module answers a different question (how does
// THIS SCREEN read input) that this page's own three questions don't fit. Still addable from
// the composer (`home.html`) and still runs in the kiosk; just not browsed here. "For now" —
// Mike's own qualifier — so revisit if device modules ever get their own real discovery answer.
export const NOT_FOR_CAREGIVERS = {
  counter: 'a development test panel',
  presslog: 'a development test panel',
  interstitials: 'retired — replaced by Lineup',
  keyboard: 'a device module, not a software one — see this file’s own note just above',
  simple_math: 'folded into Math (its Beginner level) — kept so old screens do not break',
  library_slot: 'the builder’s place for the Modules library',
};

/**
 * Compare this catalog against the live registry.
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

/**
 * Which core every registered module runs on — Task 4 of the consolidation work order
 * (`NEW_CORE_SPEC.md` §9), the report half of the CI boundary check. Same discipline as
 * `reconcile()` above: a DECLARED fact read off each manifest, nothing inferred from a file
 * path or a directory name. A module with no `core` field is 'legacy' — the same pessimistic
 * default `module.js`'s own `dependsOn` field already uses.
 *
 * Returns `{ legacy, new: newCore, counts }`, arrays of type names, sorted, so this is stable
 * to snapshot in a test or print in a report. Deliberately does not touch the import graph —
 * that is the STATIC half of the Task 4 design (still not built, see NEW_CORE_SPEC.md §9); this
 * is only ever what the registry itself already knows.
 */
export function coreReport(manifests = []) {
  const legacy = [];
  const newCore = [];
  for (const m of manifests || []) {
    if (!m || !m.type) continue;
    (m.core === 'new' ? newCore : legacy).push(m.type);
  }
  legacy.sort();
  newCore.sort();
  return { legacy, new: newCore, counts: { legacy: legacy.length, new: newCore.length } };
}

/** The catalog entries for one group, in declared order. */
export function groupItems(groupId, manifests = []) {
  const registered = new Set(manifests.map((m) => m && m.type).filter(Boolean));
  return CATALOG.filter((c) => c.group === groupId && registered.has(c.type));
}

/** The display name: the catalog's override, else the manifest's title, else the type. */
export function titleFor(entry, manifests = []) {
  if (entry.title) return entry.title;
  const m = manifests.find((x) => x && x.type === entry.type);
  return (m && m.title) || entry.type;
}
