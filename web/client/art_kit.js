// art_kit.js — THE ART KIT: which pictures a person can make for Nimrod (with their own AI, or by hand), and for each
// one its size, its shape, its file type, whether its background is clear, its name and its folder. Row 2.64.
//
// Mike, 2026-10-07: *"There should be something for people to give to their AI with our design setup, so they can just
// say they want some artwork for this or that thing, and then build their own whatever ... it should cover anything
// that there would be artwork for."* Chat's outline (note BF item 7): one plain document a person gives to any AI - the
// look in words, a sheet per kind of artwork, a ready sentence to fill in - and a checker on the site that says what is
// wrong with a file. THE LOOK IS DESIGN'S (`ART_LOOK` below is a stand-in until Design writes it); the sizes, file types,
// names and folders are Code's, and are this file.
//
// ONE SOURCE, THREE READERS: the Artwork folder's README.txt (user_folders.js writes `artKitText()` into it, so the kit is
// a file a person can attach to their AI), the "Copy the art kit" button and the Artwork section of "Your own folders"
// (user_folders_page.js), and the checker (art_check.js), which judges a file against the same table.
//
// *** ONLY WHAT THE SITE CAN TAKE FROM A FILE TODAY IS A KIND HERE (verified 2026-10-07, public repo). ***
//   avatar     modules/avatar.js "Use a picture instead" -> picture_picker.js; drawn by avatar_display.js in a square,
//              `object-fit: cover`, cut to a circle by default (`round`). An .svg is drawn inline through svg_sanitize.js
//              and blinks and talks when it has `id="eyes"` / `id="mouth"` groups (the avatar's own PROMPT_DESCRIBE).
//   button     modules/button.js "Picture" (`kind: 'picture'`): `object-fit: contain` inside a frame whose shape is
//              square or 4:3, picked from the picture's own proportions (ASPECT_CUTOFF, the square root of 4/3).
//   card       the AAC board's card picture (board_editor.js -> picture_picker.js; card_face.js): a SQUARE slot,
//              `object-fit: contain`, with the card's word printed under it (modules.css `.ab-card .ab-img`).
//   wallpaper  the Wallpaper panel, which plays Artwork/Wallpapers by itself (its "Pictures from" row, folder art
//              2026-10-07), and the Photos panel's "Photos from" + "Album" (a connected folder and one of its subfolders).
// LEFT OUT, because nothing reads them from a file yet: room objects and furniture (drawn from code and the brick
// models), a room's picture frames (preset pictures only - room_scene.js `pictureFor` has no host that supplies one),
// a room's backdrop picture (room_backdrop.js takes a same-site path; nothing makes one), trophies and badges, theme
// scenes (drawn in CSS, no pictures), module icons, game pieces, playing cards, pets. A kind nothing reads is a promise
// nothing keeps (the same rule user_folders.js applied to Notes); each gets a row here the day something reads it.
//
// *** WHERE THE FILES GO, AND HOW THEY REACH THE SITE. *** `<your Nimrod folder>/Artwork/<the kind's folder>`, made by
// "Set up your Nimrod folder". The Artwork folder is then "Connected for pictures" (a media source, a handle on this
// device, nothing copied), and every picture picker can browse it a subfolder at a time; the Photos panel takes it with
// Album = "Wallpapers". An .svg IS listed from a folder (folder art, 2026-10-07: folder_source.js IMAGE_EXTS and the
// media agent both list it), and is only ever shown as a picture or through svg_sanitize.js - never run.
//
// No imports: user_folders.js reads this for the README, and must stay cheap to load.

/** The Nimrod folder's subfolder for artwork. user_folders.js SUBFOLDERS uses this name. */
export const ART_FOLDER = 'Artwork';

// *** THE LOOK, IN WORDS - A STAND-IN UNTIL DESIGN WRITES IT (note 37 in NOTES_FOR_DESIGN). *** It is the avatar
// prompt's own style line (modules/avatar.js PROMPT_PHOTO), so nothing new is claimed about the look here.
export const ART_LOOK = 'Friendly and simple: flat colours with soft shading, clean dark outlines, warm colours, '
  + 'and easy to read when small. No words in the picture unless you ask for them.';

// *** THE NUMBERS, EACH ARGUED. A spec, not a setting: they describe what the site draws, so they change when the
// site changes, not per person. The checker takes the table as a parameter (`kinds`), so a different table is a call
// away. ***
//   avatar 512 x 512     the size the avatar's own SVG prompt already asks for (viewBox 0 0 512 512): one number on the
//                        site, not two. The largest an avatar is drawn is a profile-sized face, a few hundred pixels on
//                        a high-density screen. Smallest 256: below that a large face is blurred. Largest 2048: past it
//                        a Pi 400 decodes pixels nobody sees, on every screen that shows the person.
//   button 1024 x 768    a Button can be as big as a quarter of a 1920-wide screen (about 960 wide); 1024 covers it.
//                        4:3 or square, the button frame's own two shapes. Smallest 256, largest 4096 (the long side).
//   card 512 x 512       square, the card's own slot. A card is at most a few hundred pixels even on a 2 x 2 board;
//                        512 is that at twice the density. Smallest 128: a board of many small cards is still clear.
//   wallpaper 1920 x 1080  16:9, the size of the screens this runs on (the Pi kiosks are 1080p); 3840 x 2160 is fine
//                        and is the largest. Smallest 720 on the short side: a 1280 x 720 picture still fills a screen
//                        without looking soft from across a room.
//   maxBytes             avatar and card 1 MB (a 512 PNG with a clear background is usually 100-400 KB), button 2 MB,
//                        wallpaper 8 MB (a 1920 x 1080 PNG from an AI is often 3-5 MB). Over it still WORKS - it is
//                        said as "loads slowly", never as broken. A picture added from this device is copied into the
//                        browser's storage, and a Pi reads every one again at each start.
//   clear                'wanted': the background should be clear (transparent), so the card's or the circle's own
//                        colour shows round it. 'either': it is fitted inside a frame; clear or not both look right.
//                        'no': a full-screen picture with a clear part shows black there.
const MB = 1000 * 1000;
function kind(k) { return Object.freeze({ ...k, shapes: Object.freeze(k.shapes.map((s) => Object.freeze(s))), types: Object.freeze(k.types) }); }
export const ART_KINDS = Object.freeze([
  kind({
    id: 'avatar', folder: 'Avatars', prefix: 'avatar', title: 'Avatar', plural: 'Avatars',
    what: 'a person’s picture: small beside their name, larger on their page, shown in a circle',
    use: 'the Avatar maker: “Use a picture instead”',
    width: 512, height: 512, shapes: [[1, 1]], minSide: 256, maxSide: 2048,
    types: ['png', 'webp', 'svg'], clear: 'wanted', maxBytes: 1 * MB, circle: true,
    advice: 'Keep the face in the middle with space all round: the circle cuts off the corners.',
    ask: 'a friendly cartoon avatar of <who: hair, glasses, skin tone, clothes, one thing they are known for>, '
      + 'head and shoulders',
    example: 'avatar-sam.png',
  }),
  kind({
    id: 'button', folder: 'Buttons', prefix: 'button', title: 'Button picture', plural: 'Button pictures',
    what: 'the picture on a Button panel, inside its frame',
    use: 'a Button panel’s settings: “Picture”',
    width: 1024, height: 768, shapes: [[4, 3], [1, 1]], minSide: 256, maxSide: 4096,
    types: ['png', 'webp', 'jpg'], clear: 'either', maxBytes: 2 * MB,
    advice: '4:3 (a little wider than tall) or square: the frame takes the picture’s shape. Any other shape is fitted inside, with space at the sides.',
    ask: '<what the button is for>, bold and simple so it reads from across a room',
    example: 'button-music.png',
  }),
  kind({
    id: 'card', folder: 'Board cards', prefix: 'card', title: 'Board card', plural: 'Board cards',
    what: 'the picture on a card of the AAC board, above the card’s word',
    use: 'the AAC board’s editor: a card’s picture',
    width: 512, height: 512, shapes: [[1, 1]], minSide: 128, maxSide: 2048,
    types: ['png', 'webp'], clear: 'wanted', maxBytes: 1 * MB,
    advice: 'One clear thing, big and simple. No words in the picture: the card prints its own word under it.',
    ask: 'a simple picture of <the word>, filling most of the square',
    example: 'card-drink.png',
  }),
  kind({
    id: 'wallpaper', folder: 'Wallpapers', prefix: 'wallpaper', title: 'Wallpaper', plural: 'Wallpapers',
    what: 'a full-screen picture, for a slideshow or a calm background',
    use: 'the Wallpaper panel, by itself (its “Pictures from” setting starts on this folder), or a Photos panel’s settings: '
      + '“Photos from” your Artwork folder, “Album” Wallpapers',
    width: 1920, height: 1080, shapes: [[16, 9]], minSide: 720, maxSide: 3840,
    types: ['jpg', 'webp', 'png'], clear: 'no', maxBytes: 8 * MB,
    advice: 'Wide (16:9). Keep anything important away from the left and right edges: a taller screen cuts a little off the sides.',
    ask: 'a calm, wide picture of <the scene>',
    example: 'wallpaper-autumn-lake.jpg',
  }),
]);

// What a file type is called in words, and its MIME type (the checker's second opinion when a name has no extension).
export const TYPE_WORDS = Object.freeze({ png: 'PNG', webp: 'WebP', jpg: 'JPG', jpeg: 'JPG', svg: 'SVG', gif: 'GIF',
  bmp: 'BMP', avif: 'AVIF', heic: 'HEIC', heif: 'HEIF', tif: 'TIFF', tiff: 'TIFF' });
export const MIME_EXT = Object.freeze({ 'image/png': 'png', 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/svg+xml': 'svg',
  'image/gif': 'gif', 'image/bmp': 'bmp', 'image/avif': 'avif', 'image/heic': 'heic', 'image/heif': 'heif', 'image/tiff': 'tif' });

// *** THE NAME. A TIP, NEVER A FAULT: the site shows a picture whatever it is called. *** Small letters, numbers and
// hyphens, starting with the kind (`avatar-sam.png`), at most NAME_MAX characters. Argued: it reads the same on Windows,
// a Mac, Linux and a phone, survives a zip and a USB stick, sorts by kind in a flat folder, and tells the checker which
// kind a file is when it is not in that kind's folder. Against: people name things their own way, and the picker shows
// any name - which is why it is a tip.
export const NAME_MAX = 60;
export const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// *** SHAPE TOLERANCE: 3 %. *** Lets an AI's own near sizes through (1792 x 1024 is 1.6 % off 16:9), and still catches
// the wrong shape (3:2 given for 16:9 is 16 % off; 3:2 for 4:3 is 12 %).
export const ASPECT_TOLERANCE = 0.03;

export const extOfName = (name) => {
  const s = String(name || '').toLowerCase().replace(/^\.+/, '');
  const dot = s.lastIndexOf('.');
  return dot > 0 ? s.slice(dot + 1) : '';
};
export const baseOfName = (name) => {
  const s = String(name || '');
  const dot = s.lastIndexOf('.');
  return dot > 0 ? s.slice(0, dot) : s;
};
export const artKind = (id, kinds = ART_KINDS) => kinds.find((k) => k.id === id) || null;

/** "512 × 512", or "1024 × 768 (or square)" for a kind with more than one shape. */
export function sizeWords(k) {
  const main = `${k.width} × ${k.height}`;
  const rest = k.shapes.slice(1).map(([a, b]) => (a === b ? 'square' : `${a}:${b}`));
  return rest.length ? `${main} (or ${rest.join(', ')})` : main;
}
export const shapeWords = (k) => k.shapes.map(([a, b]) => (a === b ? 'square' : `${a}:${b}`)).join(' or ');
export const typesWords = (k) => {
  const names = [...new Set(k.types.map((t) => TYPE_WORDS[t] || t.toUpperCase()))];
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}` : names[0];
};
export const clearWords = (k) => (k.clear === 'wanted' ? 'a clear (transparent) background'
  : k.clear === 'no' ? 'no clear parts: it fills the screen' : 'a clear background or a plain one, either works');
export const bytesWords = (n) => (n >= MB ? `${Math.round((n / MB) * 10) / 10} MB` : `${Math.max(1, Math.round(n / 1000))} KB`);

/** The sentence to give an AI for one kind. `what` fills the kind's <...> part when given. Pure. */
export function promptFor(k, what = '') {
  const first = k.types[0];
  const type = TYPE_WORDS[first] || first.toUpperCase();
  const bg = k.clear === 'wanted' ? ' with a transparent background' : '';
  const ask = what ? k.ask.replace(/<[^>]*>/, String(what)) : k.ask;
  return `Make a ${k.width} × ${k.height} ${type}${bg} of ${ask}. ${k.advice} In this style: ${ART_LOOK}`;
}

/** The kit as plain text: the Artwork folder's README.txt and what "Copy the art kit" copies. Pure. */
export function artKitText(kinds = ART_KINDS) {
  const L = [];
  L.push('NIMROD ART KIT');
  L.push('');
  L.push('Pictures you make for Nimrod yourself, with your own AI or by hand. Give this whole file to your AI, then ask');
  L.push('for what you want, for example: "Using the Nimrod art kit, make me a board card of a cup of tea."');
  L.push('');
  L.push('Put each picture in its folder inside this Artwork folder. Then in Nimrod, in the settings menu: This screen,');
  L.push('Your own folders, Artwork: "Connect it for pictures" (once), and choose the picture wherever a panel asks for one.');
  L.push('"Check pictures" on that page says what is wrong with a file, if anything. Nothing is uploaded: your pictures stay');
  L.push('on this computer.');
  L.push('');
  L.push('THE LOOK');
  L.push(ART_LOOK);
  L.push('It gets close, not exact: an AI follows a written style loosely. Your own style is fine too - it is your room.');
  for (const k of kinds) {
    L.push('');
    L.push(`${k.plural.toUpperCase()} - folder: Artwork/${k.folder}`);
    L.push(`For: ${k.what}. Used in ${k.use}.`);
    L.push(`Size: ${k.width} × ${k.height} pixels (${shapeWords(k)}). At least ${k.minSide} on the short side.`);
    L.push(`File: ${typesWords(k)}, with ${clearWords(k)}. Under ${bytesWords(k.maxBytes)}.`);
    L.push(k.advice);
    L.push(`Name: ${k.example} - small letters, numbers and hyphens, starting with "${k.prefix}-".`);
    if (k.types.includes('svg')) {
      L.push('SVG: a square viewBox="0 0 512 512", no text and no pictures inside it. Put the eyes in a group with id="eyes"');
      L.push('and the mouth in a group with id="mouth", and it blinks and talks.');
    }
    L.push(`Ask: "${promptFor(k)}"`);
  }
  L.push('');
  L.push('NOT YET');
  L.push('Room objects and furniture, posters and picture frames in a room, trophies and badges, theme scenes, module');
  L.push('icons, game pieces and playing cards: nothing in Nimrod takes these from a file yet. Each gets a section here');
  L.push('when something does.');
  L.push('');
  L.push('WHO OWNS IT');
  L.push('Who owns what an AI makes depends on the service you use. Pictures of real people, and of other people\'s');
  L.push('characters or brands, are yours to answer for.');
  return `${L.join('\n')}\n`;
}
