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
  answer: { label: 'Asks for an answer', hint: 'Needs somebody who can reply, with a touch, a switch or a key.' },
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
    blurb: 'All of these run by themselves. Nobody has to '
      + 'press anything to keep them going.',
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
    blurb: 'What happened, and whether it is getting easier. Useful to a therapist. Also '
      + 'useful in a meeting where somebody needs to hear how a person is really doing.',
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
    blurb: 'Your guide, AI characters to talk to, and a speech program trained on your own voice. The AI costs nothing by default. It '
      + 'runs on your own computer, or uses a key of your own from an AI service. “Claude on this account” and the wake phrases (the words '
      + 'that tell the screen to listen) are settings, not panels. They are in the ⚙ menu (Devices) and in Modules under AI.',
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
    needs: 'A folder of photos. It can be on this computer, or on a drive plugged into it.',
    why: 'For most families this is the whole reason to set a screen up, and it is the one '
      + 'thing on this list that has been running at a bedside for months. Somebody who is '
      + 'disoriented, or who cannot turn their head, gets their own people in front of them '
      + 'instead of a wall. It never asks anything of them.',
    note: 'The pictures are read straight from your own computer. They are never sent to the site.',
  },
  {
    type: 'personal',
    title: 'Personal videos',
    group: 'comfort',
    use: 'watch',
    lead: 'Recorded messages from their people.',
    needs: 'A folder of video clips, such as messages family recorded on their phones.',
    why: 'A photo shows their face. A video brings their voice too. A short clip from a '
      + 'grandchild can be the closest thing to a visit. That matters most for somebody who '
      + 'cannot hold a phone or follow a call. It can be played again.',
    note: 'Plays from your own computer. Nothing is sent to the site.',
  },
  {
    type: 'youtube',
    title: 'YouTube',
    group: 'comfort',
    use: 'watch',
    lead: 'A playlist of your own, shuffled.',
    needs: 'A YouTube playlist, and a working internet connection.',
    why: 'Their music, their programs, the church service, the football. It shuffles, '
      + 'and tries not to repeat itself. You can set different playlists for different '
      + 'times of day, so mornings and evenings are not the same.',
  },
  // Row 2.32: music by name, by voice, switch or touch - one list, every way in ends at `music/play`.
  {
    type: 'music',
    title: 'Music',
    group: 'comfort',
    use: 'watch',
    lead: 'Their favorite music, by name.',
    needs: 'A few favorites. They can be YouTube links, music files in a connected folder, Internet Archive items, or '
      + 'Spotify. Spotify is optional and needs Spotify Premium.',
    why: 'Say “computer please play” and a name, or press it. The family writes the list once; '
      + 'the same names work by voice, by switch and by touch.',
  },
  // Row 2.69: the Internet Archive - old films, radio, music and books, played from archive.org.
  {
    type: 'archive',
    title: 'Internet Archive',
    group: 'comfort',
    use: 'watch',
    lead: 'Old films, radio shows, music and books from the Internet Archive.',
    needs: 'The address of an item on archive.org, and a working internet connection. No account is needed.',
    why: 'Footage and radio from the right decade can mean more than anything new. The Archive keeps old programs, '
      + 'recordings and books that anyone may watch and hear. Sound and video play through the speaker you choose, and '
      + 'move on by themselves; books open in the Archive’s own reader.',
    note: 'Only the item names you choose are saved. The films and sound come straight from the Archive; nothing is '
      + 'copied to this site. Old games from the Archive are off until you turn them on.',
  },
  // Row 2.69: livecams - live nature cams from explore.org, played through YouTube's player.
  {
    type: 'livecams',
    title: 'Live nature cams',
    group: 'comfort',
    use: 'watch',
    lead: 'Live animal cams from explore.org: elephants, birds, puppies, kittens, an aquarium.',
    needs: 'A working internet connection. No account. Six cams are there to start with, and the list is yours to change.',
    why: 'Something alive and moving, all day, that asks nothing of anybody. One cam at a time, with a plain name; it '
      + 'moves on every half hour, and a cam that is off (night there, or out of season) is skipped and said so.',
    note: 'Only your list is saved: each cam’s name and address. The pictures come straight from YouTube. The sound is '
      + 'off until you turn it on.',
  },
  // Row 2.45. A first version, and the catalog says so.
  {
    type: 'karaoke',
    title: 'Sing along',
    group: 'comfort',
    use: 'watch',
    lead: 'Karaoke videos from YouTube, with the words on screen, to sing along with.',
    needs: 'Some karaoke videos, and a working internet connection. Search for videos in this '
      + 'panel, or paste links. Searching needs your own YouTube key.',
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
    lead: 'Changes what is on the screen through the day, by itself.',
    needs: 'Whichever of the others you have already set up.',
    why: 'Instead of one thing on a loop, this takes turns between videos, personal messages '
      + 'and learning. It changes what it favours by time of day. Early morning is '
      + 'quiet, and the afternoon has more going on. It keeps a screen from turning '
      + 'into something nobody notices any more.',
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
    why: 'It sits in a corner and tells the day before anybody has to ask. After a '
      + 'long hospital stay, a person often does not know what day it is. Having to '
      + 'keep asking is upsetting.',
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
    lead: 'An AAC communication board. Big cards say the word out loud when chosen.',
    needs: 'Nothing. A speaker, if you want it heard.',
    why: 'An AAC board (augmentative and alternative communication) is a way to say something '
      + 'when speaking is hard: a set of care words, or just yes, no and "something else". It can '
      + 'be touched, or it can light the cards one at a time so somebody using a switch can '
      + 'answer. Switch boards from the row above the cards. It says the word out loud. During a call, '
      + 'the person on the call gets the word too.',
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
    note: 'It opens on Yes / No / Other. The 16-word care board '
      + 'is included as an example of a board made to fit '
      + 'one person. It has no food or drink cards.',
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
    why: 'Something calm to look at that never asks for anything. Each scene is a '
      + 'whole place with depth, not a pattern, and all of the movement is slow. It '
      + 'can fill a screen on its own, or sit behind an AAC board with the cards '
      + 'see-through.',
    note: 'Movement can be slowed or stopped. It stops by itself if the device is set to '
      + 'reduce motion.',
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
    why: 'A familiar place instead of a flat screen. It has a sofa, a lamp, a window onto a live scene, '
      + 'and the time and date on the wall where anybody would look for them. It follows the '
      + 'real clock. The lamp comes on in the evening and the window goes dark at night. The '
      + 'clock, the calendar and the pictures stay bright enough to read. The furniture can hold the '
      + 'screen’s own controls. Every piece that does something carries a label, and a switch can '
      + 'step through them one at a time.',
    note: 'Five rooms to start from, drawn with Claude Design. Movement can be slowed or stopped. '
      + 'It stops by itself if the device is set to reduce motion.',
  },
  // town (2026-10-12): Design's town. `touch`: left alone it is a picture of the town, and nothing waits on anybody.
  {
    type: 'town',
    group: 'comfort',
    use: 'touch',
    // Not the eight names: "the Shop" is a money word on the library's pages (library_test), and a list reads long.
    lead: 'The theme\'s town: the King\'s, the Queen\'s, Jack\'s and Pip\'s homes, and a place in town for each suit.',
    needs: 'Nothing. The town is drawn for each theme.',
    why: 'Open a place to see it full size, with its character at home, or rearrange it: move things, add a piece '
      + 'from the theme, take one out. A rearranged place is kept for the person, in that theme, and the playing '
      + 'cards drawn from it change too. The places light up in turn, so one switch can choose; touch works, and so '
      + 'does saying "go to the bakery".',
  },
  // story (2026-10-12): Story time. `watch`: it turns its own pages by default, so somebody who can only watch hears the
  // whole story; any press turns sooner.
  {
    type: 'story',
    title: 'Story time',   // not "Story"
    group: 'comfort',
    use: 'watch',
    lead: 'A short picture story, read aloud page by page, with you as the hero.',
    needs: 'Nothing. Five stories are built in. A voice on the screen reads them; without one, the words are shown large.',
    why: 'Each page is a place in the theme\'s town, with your own character (from the avatar maker) and the King, the '
      + 'Queen, Jack and Pip. The pages turn by themselves, or any press turns one, so one switch is all it needs. '
      + 'Gentle, everyday stories: a recipe found, a clock mended, a letter written.',
  },
  // whoswho (2026-10-12, Design's game ideas): which one is the Queen? `answer`: it asks and waits for the answer.
  {
    type: 'whoswho',
    title: "Who's who",
    group: 'practice',
    use: 'answer',
    lead: 'Which one is the Queen? Pick her out from three of the court characters, dressed for the theme.',
    needs: 'Nothing. The characters and the questions are built in.',
    why: 'It starts with their crowns and hats to go by, then by name, then by where they live, then by their '
      + 'looks alone, each player at their own level. Say the name or which one ("the one on the left"), touch it, '
      + 'let the light step through them for one switch, or answer yes or no. It waits for Start.',
  },
  // dressup (2026-10-12, Design's game ideas): put Jack in something warm. `answer`: it asks and waits; nothing is wrong.
  {
    type: 'dressup',
    title: 'Dress-up',
    group: 'practice',
    use: 'answer',
    lead: 'Put Jack in something warm: choose from the wardrobe, or dress the court characters in anything.',
    needs: 'Nothing. The wardrobe is built in.',
    why: 'Anything that fits is right, and nothing is ever marked wrong: something else is tried on, and it says '
      + 'what that one is for. Touch an outfit, say its name ("the parka"), or let the light step through '
      + 'them for one switch. It waits for Start.',
  },
  // Row 2.37. `touch`: left alone it is a note on the wall, and nothing waits on anybody.
  {
    type: 'note',
    title: 'Note from someone',
    group: 'comfort',
    use: 'touch',
    lead: 'A short note somebody left, with who wrote it and when.',
    needs: 'Nothing. Somebody to leave a note, on this screen or from a phone or computer signed in '
      + 'to the same account.',
    why: 'Words from a person who was here, in their own name, where they will be seen. It can look like '
      + 'a sticky note, or sit on the fridge or a desk. It can be read aloud. Change it by typing or, with no '
      + 'keyboard, by picking a ready-made note. Every earlier note is kept and can be put back.',
  },
  // Row 2.37 item 5: an optional drawn avatar for a person ("kind of like Miis"), or a picture instead.
  {
    type: 'avatar',
    title: 'Avatar maker',
    group: 'comfort',
    use: 'touch',
    lead: 'A drawn face for a person (an avatar), made one piece at a time, or a picture instead.',
    needs: 'Nothing. A picture folder in Media to use a picture.',
    why: 'A friendly face for a person on any screen, like a game character. It is optional. It moves gently, '
      + 'and stays still when motion is turned down.',
  },
  // Row 2.37 item 4 (the weather behind the room's window). `touch`: it updates by itself; a touch reads it aloud.
  {
    type: 'weather',
    group: 'comfort',
    use: 'touch',
    lead: 'The weather now, the next few hours and the next few days, in big words and pictures.',
    needs: 'A place, typed once in its settings. It can be a town, or a latitude and longitude (the two numbers that mark a spot on '
      + 'a map). The place is sent to Open-Meteo, a free weather service. Nothing is sent until a place is set.',
    why: 'A window on the day outside, with the words next to every picture. A touch, or one press of '
      + 'a switch, reads it aloud. When the connection drops, it keeps the last weather it had and says how old it is.',
  },
  {
    type: 'pond',
    group: 'comfort',
    use: 'touch',
    lead: 'Calm water that ripples when it is touched.',
    needs: 'Nothing.',
    why: 'There is nothing to get right and nothing to lose. The water simply responds, '
      + 'and it never judges. For somebody who is upset, or who has had a hard day of '
      + 'therapy, that can be worth more than another exercise.',
  },
  {
    type: 'call',
    // NOT 'comfort'. A call needs answering, and that group promises the opposite.
    group: 'practice',
    use: 'answer',
    lead: 'Whoever is calling, full screen.',
    needs: 'A network connection, and somebody to call them.',
    why: 'The caller fills the screen and the small picture-in-picture keeps showing this '
       + 'room, which is the layout people already know from every video call. An audio call '
       + 'shows their name instead of a black rectangle. A call waits for somebody to press Answer '
       + 'or Decline. Answering by itself is an option, designed with people who can’t answer '
       + 'their own calls in mind: it is only for people you let drop in, on the Remote page, and '
       + 'then it says who is calling and counts down first - a screen that answers on its own is '
       + 'a microphone in the room.',
  },
  {
    type: 'pressgame',
    title: 'Wait and Go',
    // NOT 'comfort'. That group's promise on the page is that nothing in it needs pressing to
    // keep going, and in calm mode this waits on her press for as long as it takes - which is
    // the point of it, and would make the promise false.
    group: 'practice',
    use: 'answer',
    lead: 'Wait while a charge builds, then press when the screen says Go.',
    needs: 'Nothing, to play. Somewhere to save, if you want to keep the record.',
    why: 'A wait-then-press exercise that therapists run by hand, called go/no-go. Here the waiting '
       + 'is worth something: the longer they hold off, the bigger the reward. In calm mode Go '
       + 'never times out. It waits for them, so there is no way to fail. Only in challenge mode '
       + 'does Go close if they wait too long. It writes down every press and release with its '
       + 'timing, even presses the game ignored. That record is for a clinician to read. It is not '
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
    why: 'The comet’s head sits exactly where the pointer is, and never drifts '
      + 'by itself. So it is plain that your own movement is what moved it. That '
      + 'matters for somebody who is learning again that they can make things '
      + 'happen. It can also be driven with a switch, which goes and gets a '
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
    lead: 'Hearts drifting behind your other panels. They are just for looks unless you change that.',
    needs: 'Nothing.',
    why: 'It does not take a place of its own on the dashboard. It sits behind '
      + 'whatever else is on screen, like a wallpaper. Set to "Just for looks", '
      + 'it is only scenery. Set to "Something to catch", it becomes a small, '
      + 'quiet game worth points. It never covers the thing you were already '
      + 'looking at.',
    note: 'In "Something to catch" mode, a switch cannot reach it by stepping '
      + 'around the screen yet. A caregiver binds a switch to it directly, the same '
      + 'as for any module.',
  },

  {
    type: 'button',
    group: 'comfort',
    // `touch`: left alone it is a sign or a picture on the wall, and nothing waits on anybody.
    use: 'touch',
    lead: 'Words, a picture, or both, on something you can press.',
    // photo sources first (2026-10-09): the everyday ways named, not the media agent.
    needs: 'Nothing for words. A picture comes from this device, or from a folder on this computer '
      + 'connected in Media.',
    why: 'A name on a sign, a photo in a frame, a label on the wall. It is one button, set up from '
      + 'the settings menu. You choose the words, a font, the colors, a frame, and whether pressing '
      + 'it says the words out loud. The first step of the Nimrod game builds a profile out of two '
      + 'of them.',
    note: 'Six sign styles and seven frames, drawn with Claude Design. Until you pick a color for '
      + 'the words, they take the one that reads best on the sign. Choosing a picture walks '
      + 'the pictures in a source one at a time, so a small folder of the ones you want is '
      + 'quickest.',
  },

  // bricks module (row 2.76): ONE module for every Nimrod part, in place of a card per part in Modules. `watch`: a
  // picture of a part, asking nothing. `page`: the bricks page, where every part's model is (library "See every brick").
  {
    type: 'bricks',
    group: 'comfort',
    use: 'watch',
    lead: 'One Nimrod brick, plate or bracket, in any size, in the theme’s brick colors.',
    needs: 'Nothing. Every part and size is built in.',
    why: 'Every Nimrod part is on the same 40 mm grid, so any two fit together. In the settings menu, choose the '
      + 'part, its size in 40 mm steps, and its color. A baseplate can also be 5 or 10 mm thick. The parts that have a '
      + 'printed model show its picture. Every other size is drawn the same way.',
    note: 'The theme’s brick colors change with the theme and are chosen to stand out from it and from each other, '
      + 'color-blind too. The models themselves are on the bricks page, free to print.',
    page: '/bricks.html',
  },

  // ------------------------------------------------------------------ practice
  {
    type: 'educational',
    group: 'practice',
    use: 'watch',
    lead: 'Gentle alphabet, counting and vocabulary, spoken aloud.',
    needs: 'Nothing.',
    why: 'The easiest thing here, on purpose. It runs by itself. No answer is needed and nothing '
      + 'is scored. It is for times when taking part is not possible yet but hearing '
      + 'language still matters, such as early in a recovery.',
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
    lead: 'Where you write and keep your own questions and words.',
    needs: 'Nothing. Type them, or paste a list in.',
    why: 'Trivia and Word Forge both read this, so a word written once can be practiced in one '
      + 'and asked as a question in the other. Put it on a screen with either of them and you '
      + 'can edit while somebody plays.',
    note: 'It tells you which lines it could not read, and their line numbers. Without that, a hand-written '
      + 'list can lose half of itself with nobody noticing.',
  },
  {
    type: 'trivia',
    group: 'practice',
    use: 'answer',
    lead: 'A quiz built from questions you write yourself.',
    needs: 'Nothing. Add your own questions in settings.',
    why: 'The score is about knowing things, never about how clearly somebody '
      + 'speaks. Somebody whose speech is hard to understand is never marked down for '
      + 'it. There are 4 choices by default and one button, so a switch is enough.',
    note: 'It can also record the room while it is played. That is how a computer can later '
      + 'learn to understand one person’s speech. Recording is off unless you turn it on.',
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
    needs: 'Nothing. But no lesson videos are chosen yet, so today it unlocks topics and '
      + 'does not play anything.',
    why: 'Attention and memory, in the order they are used. First take something in, then '
      + 'be asked about it. A topic’s questions are asked only after its lesson is '
      + 'marked as watched.',
  },
  {
    type: 'algebra',
    group: 'practice',
    use: 'answer',
    lead: 'Counting and small sums for beginners, then solve for x with a calculator on screen.',
    needs: 'Nothing.',
    why: 'The calculator is on screen on purpose. Somebody whose arithmetic is slower than '
      + 'it used to be has not lost the method. Making them do sums by hand tests the wrong '
      + 'thing, and it is discouraging.',
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
    why: 'The letters are on a board. A switch can step through it: first a row, then a letter. The letters '
      + 'can be touched or said aloud too. A miss gets a hint: first the first letter, then how many '
      + 'letters there are. There is never a buzzer.',
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
    why: 'Each player gets questions at their own level. It gets harder when a player keeps getting them right. '
      + 'Two people can take turns on one screen. Missed questions come back later, with a longer gap each time.',
  },
  {
    type: 'word_builder',
    title: 'Word builder',
    group: 'practice',
    use: 'answer',
    lead: 'A few big letters: find the words they make.',
    needs: 'Nothing. The words are built in.',
    why: 'It starts with 3 letters, and adds more as the words come easily, for each player. The letters are read aloud. '
      + 'Say the word, build it with a switch, or touch the letters. A real word that is not on its list is not marked wrong.',
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
  // 2026-10-06 (Mike): every kind of question in one game, round by round.
  {
    type: 'quiz_mix',
    title: 'Quiz mix',
    group: 'practice',
    use: 'answer',
    lead: 'Trivia, math, words, spelling, brain and thinking games in one game: a new kind each round.',
    needs: 'Nothing. The questions are built in or come with the site.',
    why: 'Two to four people take turns on one screen. Each gets their own question at their own level, so a grandparent '
      + 'and a teenager can play each other. A question that is harder for that player is worth more. Every answer also counts '
      + 'for that player in the game the question came from. It waits for Start.',
  },
  // 2026-10-02: name the suit, then put the card in order among the ones already done.
  {
    type: 'card_sort',
    group: 'practice',
    use: 'answer',
    lead: 'Name the suit of a big playing card, then say whether it is higher or lower than cards already done.',
    needs: 'Nothing. The deck is built in.',
    why: 'It starts with the suit alone. It works up to putting a card in order among several, each player at '
      + 'their own level. Say the answer, touch it, or step through the choices with a switch. Every suit has its '
      + 'color, its symbol and its name, never a color alone. It waits for Start.',
  },
  // 2026-10-02 (Mike's landing Home): the guide, the devices list, and What's new.
  {
    type: 'nimrod',
    title: 'Nimrod',
    group: 'ai',      // 2026-10-04: the AI set (was 'practice')
    use: 'touch',
    lead: 'A guide: what everything does, and what to try next.',
    needs: 'Nothing.',
    why: 'He offers choices you can step back through, a map of where you are, and an explanation of whatever you point at. Put something else in his place whenever you like. To '
      + 'find him again, say the wake phrase (the words that tell the screen to listen), wait, then say “tutorial”.',
  },
  {
    type: 'devices',
    group: 'practice',
    use: 'touch',
    lead: 'Every way of telling the screen what to do, and where each is set up.',
    needs: 'Nothing.',
    why: 'Voice, tracking (a movement used as the pointer), keys and switches, phones and other screens, in one list. Each is one press from where it is set up.',
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
    why: 'Sort and filter by what you are after (games, learning, something to look at, people), or search. '
      + 'One press shows what a thing is and what it needs. A second press puts it where this panel is. '
      + 'Switch module opens this list in the place of the panel you chose. It puts that panel back if you change your mind.',
    note: 'Nothing here costs money. In the Nimrod Game some things unlock as you play. Sandbox (the game turned off) is one choice away '
      + 'and unlocks everything.',
  },
  // 2026-10-06 (Mike: "its own themes module that is also a tab on the settings menu"): the theme gallery as a panel.
  // `touch`: left alone it is a grid of pictures, and nothing waits on anybody.
  {
    type: 'themes',
    title: 'Themes',
    group: 'comfort',
    use: 'touch',
    lead: 'Every theme, each with a picture of how it looks, to choose the look of the screen.',
    needs: 'Nothing.',
    why: 'The everyday themes, the four seasons and the holiday themes. Any of them can be used at any time. “With the '
      + 'seasons” follows the date instead. Search, order and filter them (light or dark, moving or still, easy to read) the '
      + 'same way as in Modules. It is the same list as the Theme tab in the ⚙ settings menu, so a choice in one shows in the other.',
  },
  {
    type: 'whats_new',
    title: 'What’s new',
    group: 'record',
    use: 'touch',
    lead: 'What changed lately, newest first, and where to find it.',
    needs: 'Nothing.',
    why: 'The list of changes, in plain words, so a new thing is something you can go and use.',
  },
  // 2026-10-02 (ai_characters.js): a person or an AI character, as a card.
  {
    type: 'profile',
    title: 'Profile',
    group: 'ai',      // 2026-10-04: the AI set, for its AI characters (was 'record')
    use: 'touch',
    lead: 'A person or an AI character, as a card: their face, their name, and what you can do with them.',
    needs: 'Nothing for the card. Talking to an AI needs one connected to this device. That can be Ollama, which is free, or a key of your own.',
    why: 'Talk to an AI character, or open its room. For example, a math tutor’s room has the calculator. People on '
      + 'this account show here too. Friends on other accounts will show once accounts can be linked.',
  },
  // 2026-10-04 (DECISIONS.md, "The landing is a very simple profile page"): you and your people, as cards. `touch`:
  // left alone it is faces and names, and nothing waits on anybody. Words a visitor reads (the hover line uses them).
  {
    type: 'people',
    title: 'Your people',
    group: 'comfort',
    use: 'touch',
    lead: 'You and your people, each with a picture and big buttons to call them or leave them a message.',
    needs: 'Nothing. Calls and messages need the person to have a screen, and to have said yes to you.',
    why: 'The simplest way in: who you keep in touch with, and how to reach them, on one page. On a screen in '
      + 'somebody’s room it shows their people’s faces and the messages left for them; calls and messages are made '
      + 'from a phone or computer. Sharing a picture, a song or a video is coming.',
  },
  // 2026-10-04: Nimrod at the bottom of a page, small, over it.
  {
    type: 'helper',
    title: 'Nimrod, the helper',
    group: 'ai',
    use: 'touch',
    lead: 'Nimrod’s face and “Ask Nimrod”, small, in a corner over the page.',
    needs: 'Nothing.',
    why: 'Help is one press away, without giving him a whole quarter of the screen. A press opens him beside your people.',
  },
  // 2026-10-02 (edit_mode.js): the panel editor's options, as a panel of their own.
  {
    type: 'options',
    group: 'practice',
    use: 'touch',
    lead: 'The options of whatever you choose in a panel you are editing.',
    needs: 'Nothing.',
    why: 'Press ✎ on a panel, then press a thing in it: its words, its picture, or the whole panel. Its options show here.',
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
    lead: 'Klondike solitaire, with big cards in four suit colors.',
    needs: 'Nothing. The deck and the rules are built in.',
    why: 'A move is two short choices. Pick a card, then pick one of the places it can go. One switch '
      + 'can play a whole game. So can a touch or a mouse. Nothing needs dragging. There is no '
      + 'timer and no losing screen. When no move helps, it offers Undo or a new game.',
  },
  // Row 2.37 item 10: games on the room's bricks and floor tiles, standalone first.
  {
    type: 'brickbreaker',
    group: 'practice',
    use: 'answer',
    lead: 'Knock down a wall of Nimrod bricks with a ball and a paddle.',
    needs: 'Nothing. The wall, the ball and the sounds are built in.',
    why: 'One switch can play. The paddle glides by itself and a press stops it where the ball will land. '
      + 'The ball is slow by default. A missed ball just comes back, and there is no losing screen. '
      + 'The bricks take the theme’s colors.',
  },
  // brick games (2026-10-09, row 2.76): stack Nimrod bricks into a wall.
  {
    type: 'brickdrop',
    group: 'practice',
    use: 'answer',
    lead: 'Stack Nimrod bricks into a wall: fill a row and it is built.',
    needs: 'Nothing. The bricks, the levels and the sounds are built in.',
    why: 'One switch can play. The brick glides along the top by itself and a press drops it. Or Left, Turn, Right '
      + 'and Drop light up in turn, and a press does the lit one. The easiest levels are slow and use small bricks, and '
      + 'a full wall just starts a fresh one. Harder levels are faster, with bigger pieces.',
  },
  // brick builder (2026-10-09): make a model from Nimrod parts, and a game of building one you are shown.
  {
    type: 'brickbuilder',
    title: 'Brick builder',   // title-casing the type would say "Brickbuilder" (composer_reach checks it is the manifest's)
    group: 'practice',
    use: 'touch',
    lead: 'Make a model from Nimrod bricks, plates and brackets: any size, stacked, turned and colored.',
    needs: 'Nothing. Every part is built in. Models are kept for you, and can be saved to your Nimrod folder.',
    why: 'Every part is on the same 40 mm grid, so anything put down fits. A cursor shows where the next part goes, and '
      + 'everything is a button: a mouse, a finger, the keys or one switch can build. Parts fall onto what is under '
      + 'them, Undo takes back any step, and on screen there is no printer size limit.',
  },
  {
    type: 'buildit',
    title: 'Build it',   // not "Buildit"
    group: 'practice',
    use: 'answer',
    lead: 'See a finished model of Nimrod bricks and build the same, from two bricks up to twelve.',
    needs: 'Nothing. The models, the levels and the sounds are built in.',
    why: 'At the easy levels the next part is offered as two or three pictures that light in turn: one press takes the '
      + 'lit one and the right one snaps into place, so one switch can build every model. A wrong one just is not '
      + 'offered again. From the middle level the model is built in the brick builder and checked as it goes.',
  },
  // brick games (2026-10-10, row 2.76): a one-press tower game, and a picture built from bricks.
  {
    type: 'stackline',
    title: 'Stack to the line',   // title-casing the type would say "Stackline"
    group: 'practice',
    use: 'answer',
    lead: 'A brick slides along above a tower. One press drops it. Build up to the line.',
    needs: 'Nothing. The bricks, the levels and the sounds are built in.',
    why: 'One press is the whole game, so one switch can play: a key, a click or a touch works too. What hangs '
      + 'over the edge is cut off. The easy levels are slow and wide, a brick lands on the nearest whole '
      + 'cell, and a miss just brings the same brick again.',
  },
  {
    type: 'brickmosaic',
    title: 'Brick mosaic',   // not "Brickmosaic"
    group: 'comfort',
    use: 'touch',
    lead: 'One of your photos, built from Nimrod bricks one brick at a time, in the theme’s brick colors.',
    needs: 'Nothing. It uses a photo source if there is one, and a built-in painting if not. The picture never leaves '
      + 'the browser.',
    why: 'It builds by itself, slowly, from the bottom row up, so there is nothing to press. A press lays the rest of '
      + 'the row at once, or finishes the picture, and on a finished one it starts the next. It can also be set to '
      + 'build only when pressed.',
  },
  // sortbricks (2026-10-10, row 2.76): a shape sorter, then sorting by colour and by size.
  {
    type: 'sortbricks',
    title: 'Sort the bricks',   // not "Sortbricks"
    group: 'practice',
    use: 'answer',
    lead: 'Put each brick where it goes: in the slot it fits, then with its color, then with its size.',
    needs: 'Nothing. The bricks, the levels and the sounds are built in.',
    why: 'At the first level there is one slot, and any press puts the brick in. Later levels light the places '
      + 'up in turn, so one switch can choose; a touch, a key or two switches work too. It says each brick\'s '
      + 'color aloud, and a wrong place just brings the same brick back.',
  },
  {
    type: 'rhythm',
    group: 'practice',
    use: 'answer',
    lead: 'Tiles light up to a beat; press on the beat.',
    needs: 'Nothing. The beat is built in, or it can follow a tempo on the screen.',
    why: 'One press is the whole game, so one switch plays it. Slow and forgiving by default, it never '
      + 'flashes more than three times a second, and a hit shows as a mark and words, not only a color.',
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
    lead: 'A Pomodoro focus timer. Finish a sprint of focused work and earn the points.',
    needs: 'Nothing.',
    why: 'A short stretch of effort with a clear end. This is the Pomodoro technique: 25 '
      + 'minutes of work, then a break. It helps when starting is the hard part, which it '
      + 'often is after a brain injury.',
  },
  {
    type: 'quests',
    group: 'practice',
    use: 'answer',
    lead: 'Points, tasks and rewards.',
    needs: 'Nothing.',
    why: 'The games pay their points in here. The points can be spent on things that matter '
      + 'to the person, not to the software.',
  },

  // ------------------------------------------------------------------ record
  {
    type: 'progress',
    group: 'record',
    use: 'watch',
    lead: 'How they are doing over time.',
    needs: 'Anything above that asks questions.',
    why: 'How many answers were right, which ideas are hard, and how quickly answers come. '
      + 'It is for the conversation where somebody has to say whether a person is '
      + 'improving, and wants more than an impression to go on.',
  },
  {
    type: 'calculator',
    group: 'practice',
    // `touch`, not `answer`: it asks nothing and waits on nobody. Left alone it just shows 0, and
    // a screen that has one on it is not stalled by it, which is what the `touch` legend says.
    // It does need somebody to press keys to be of any use, and the copy below does not hide that.
    use: 'touch',
    lead: 'A calculator that adds, subtracts, multiplies and divides, on a panel of its own.',
    needs: 'Nothing. It works with no internet.',
    why: 'For working something out without leaving the screen, and without having to open '
      + 'the Math game. The keys can be touched, or stepped through with a switch. It can '
      + 'also pass its answer to another panel that takes one. There is no screen for '
      + 'setting that up yet, so today that link is written by hand into the data behind the screen.',
  },
  {
    type: 'reading_log',
    group: 'record',
    use: 'touch',
    lead: 'What they have read — title, author, how far, and when.',
    needs: 'Nothing. Type it in as you go.',
    why: 'A plain record of what was read, worth keeping on its own. Anyone can '
      + 'read it to see what someone has gotten through lately. A later feature '
      + 'could build questions from it. That is not built yet, so today this '
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
    why: 'Books read this week, glasses of water today, questions right in Trivia. One board shows '
      + 'all of them, so each game does not draw its own. A target is a fact, not a verdict, '
      + 'so nothing turns red for being under it. It can also show a single count, large, on its '
      + 'own.',
  },
  // Row 2.62 step 2: charts of what played (play_charts.js). `watch`: it keeps itself up to date and asks nothing;
  // its buttons only say it aloud or show it another way.
  {
    type: 'charts',
    title: 'Charts',
    group: 'record',
    use: 'watch',
    lead: 'What played on this screen, as a chart or graph: bars, a line over time, a pie, one number or a list.',
    needs: 'Nothing to set up. It counts what YouTube, photos, personal videos and music from folders play here.',
    why: 'It starts as “Top played this week”, and “Next view” shows the same plays other ways: each day this '
      + 'month, today in one number, by kind, of all time. Every chart can be read as a plain list and said '
      + 'aloud - press “Say it”, or say “computer please, what played most”.',
    note: 'Counted on this device from this screen’s own plays. Nothing goes to the Nimrod site. Spotify plays are left '
      + 'out, because Spotify’s rules for developers say an app should not make listening statistics from them.',
  },
  // Row 2.62 step 4: the same plays as things in a room (modules/play_objects.js). `watch`: looked at; one press reads it.
  {
    type: 'play_objects',
    title: 'Plays as objects',
    group: 'record',
    use: 'watch',
    lead: 'What played on this screen as things in a room: a stack of bricks for each, a pie, or posters on the wall.',
    needs: 'Nothing to set up. Home’s Add has “Top played this week” as a stack, a pie or posters. In a room it goes '
      + 'on the wall with no panel around it.',
    why: 'The same plays that the Charts panel counts, as something to look at across a room. Press it to hear what '
      + 'played most and see it as a list. The bricks are the Nimrod brick, as it is printed.',
    note: 'Counted on this device from this screen’s own plays. Nothing goes to the Nimrod site. Spotify plays are left '
      + 'out. Posters show names only. There are no cover pictures until the services’ rules on showing them are checked.',
  },
  // Row 2.44: the recordings voice_recording.js kept on this device, reviewed a pair at a time. `touch`: it
  // plays nothing until somebody presses Play, and left alone it is a list.
  {
    type: 'voice_review',
    title: 'Voice recordings',
    group: 'record',
    use: 'touch',
    lead: 'The voice recordings this screen kept. Play each one and say what was meant.',
    needs: 'Voice recording turned on for a person, and speech listening.',
    why: 'Each recording is a pair: what was said, and what the speech program wrote down. Play one and type '
      + 'what was meant. That is how a speech program can learn a voice it keeps getting wrong. The '
      + 'recordings stay on this screen. They leave it only when somebody exports them (copies them to a folder).',
    note: 'Recording is off unless it is turned on for one person, and the screen shows whenever it records.',
  },
  // 2026-10-04 (modules/voice_model.js): the six voice-model steps as a guided panel, in the AI set. `touch`: left
  // alone it shows one step and waits on nobody; the recording in step 1 happens only after Start.
  {
    type: 'voice_model',
    title: 'Voice model',
    group: 'ai',
    use: 'touch',
    lead: 'A speech program trained on one person’s own voice, set up one step at a time.',
    needs: 'A microphone on the screen, to read about 100 short phrases. Then a computer: a free Google account to '
      + 'train on, or a computer with a graphics card, and the speech service running on it.',
    why: 'For somebody whose speech an ordinary speech program keeps getting wrong. It takes you through 6 steps, one at a time. You record the '
      + 'phrases here and export them (copy them to a folder). Then you train, convert, put the folder in place, and start the service. It works '
      + 'out which step you are on from what it can see. Afterwards its settings stay in the same panel: the folder, the port (the number the service '
      + 'answers on) and on or off.',
    note: 'This site does not send the recordings anywhere. They stay on the screen until you export them (copy them to a folder). It does not run '
      + 'on a Raspberry Pi (a small, low-cost computer).',
  },
  // 2026-10-12 (Mike: "have a conversation with people in the town ... choose your own adventure stories ... free form
  // like D&D"): story_ai.js and modules/adventure.js. `answer`: it asks what happens next and waits; left alone it just
  // sits on its page.
  {
    type: 'adventure',
    title: 'Adventure',
    group: 'ai',
    use: 'answer',
    lead: 'Talk with the people in town, or play a story where you choose what happens.',
    needs: 'An AI (artificial intelligence) storyteller: Ollama on this computer (free), a computer in the house that has one, '
      + 'or an online AI with your own key.',
    why: 'The story is read aloud and shown in big letters. Each turn offers 2 to 4 choices: touch one, say its number '
      + 'or its words, or step through them with a switch. Or say or type anything else, and the story goes that way. '
      + 'The storyteller keeps it gentle and kind. If it is slow to answer, the choices are offered again.',
    note: 'The story is kept on this device only, and in your Nimrod folder if you ask. It is never kept on the website’s '
      + 'server. The words are sent to whichever AI this device uses.',
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
