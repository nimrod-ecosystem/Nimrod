// livescene.js — LIVE THEMES: animated scenes and overlays, in plain DOM. No framework, no build.
//
// Generated from the design system's `AacGround.jsx` (Claude Design) by compiling its JSX against
// the tiny `__lsh()` below, so the scenes here are the SAME drawings Design iterated on, not a port
// that can drift from them. Regenerate rather than hand-edit the scene bodies.
//
// TWO CATEGORIES, and they compose:
//   SCENE    a whole world behind everything: fall, steampunk, cyberpunk, cozy, winter, ocean
//            (aquarium), night, nimrod. One at a time.
//   OVERLAY  one small inhabitant that can sit on ANY scene. Any number. Three kinds:
//              weather  rain, snow, leaves, petals, fog  (can follow the real forecast: live_weather.js)
//              calm     fireflies, dog, moon (tonight's real phase), cat
//              rare     ufo, balloon, shootingStar, boat, butterfly — off screen most of the loop
//
// THE RULES, inherited from the rest of the product and none of them optional:
//   1. EVERY MOVING PART IS DECORATION. Nothing here carries state, marks a cursor, or reacts to
//      input. It is all aria-hidden and pointer-events:none. A person who never notices it has
//      lost nothing.
//   2. MOTION IS OPT-IN. Every keyframe sits inside `prefers-reduced-motion: no-preference`, and
//      the Wallpaper module's ladder is honoured: gentle | calm (slower) | still (no clock at all).
//      The machine can only ever ask for LESS motion than the person chose (wallpaper.js motionOf).
//      With motion off every scene is still composed: elements are PLACED, not piled at a start.
//   3. THE SCENE SERVES WHAT IS ON TOP OF IT. Each scene carries board tokens tuned so cards stay
//      legible over it. Those numbers are Design's ESTIMATES; Code measures them (PRIORITY.md #2).

// ---------------------------------------------------------------------------------------------
// __lsh() — the whole "framework". JSX compiled with pragma `__lsh` lands here. Deliberately NOT
// `h`: the scene bodies use `h` as a local (a tree's height), which shadowed a pragma of that name.
// ---------------------------------------------------------------------------------------------
const Fragment = Symbol('fragment');
// Mirrors React's rule for which numeric style values get `px`, so the compiled scene bodies mean
// exactly what they meant in the design system.
const UNITLESS = new Set(['opacity', 'zIndex', 'flex', 'flexGrow', 'flexShrink', 'fontWeight',
  'lineHeight', 'order', 'zoom', 'scale']);

function appendKids(el, kids) {
  for (const k of kids) {
    if (k == null || k === false || k === true) continue;
    if (Array.isArray(k)) { appendKids(el, k); continue; }
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}

function __lsh(tag, props, ...kids) {
  if (tag === Fragment) return kids.flat(Infinity);
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k === 'key' || v == null || v === false) continue;
    if (k === 'className') el.setAttribute('class', v);
    else if (k === 'style') {
      for (const [sk, sv] of Object.entries(v)) {
        if (sv == null || sv === '') continue;
        if (sk.startsWith('--')) el.style.setProperty(sk, String(sv));
        else el.style[sk] = (typeof sv === 'number' && !UNITLESS.has(sk)) ? sv + 'px' : sv;
      }
    } else if (k === 'children') appendKids(el, [v]);
    else el.setAttribute(k, v === true ? '' : v);
  }
  appendKids(el, kids);
  return el;
}

// ---------------------------------------------------------------------------------------------
// SCENE AND OVERLAY BODIES — generated. Everything from here to the public API is compiled.
// ---------------------------------------------------------------------------------------------

/* AacGround — LIVE, THEMED GROUNDS FOR A BOARD.
 *
 * An addition, not something the source defines: Nimrod ships one live background (Wallpaper,
 * which drifts around --wallpaper-hue) and its rule for it is the one that matters here — what
 * shows while a video is paused, so a screen somebody stepped away from looks like it is waiting
 * rather than broken. These grounds are that idea with a theme on it.
 *
 * HOW THE DEPTH IS BUILT (four devices, no WebGL, no images):
 *   1. CONVERGING GEOMETRY — a ground plane is a clip-path trapezoid narrowing to a vanishing
 *      point; walls are trapezoids leaning in from the frame edges. That single cue does more for
 *      "3D world" than any amount of detail on one flat plane.
 *   2. GRADED SCALE — the same object drawn small/high/hazy in the far band and large/low/sharp in
 *      the near band. Fall's trunks, cyberpunk's signs and steampunk's gears all come in three
 *      size bands.
 *   3. ATMOSPHERIC HAZE BETWEEN BANDS — a translucent sheet of the sky colour laid over each band
 *      before the next is drawn. Real distance desaturates and lifts black level; skipping this is
 *      what makes layered silhouettes read as stickers.
 *   4. DEPTH OF FIELD — the far band blurred a little, the near band blurred a lot at the frame
 *      edge, so the middle distance is where the eye settles. That is also where the cards sit.
 *
 * Palettes are the user's, used as given:
 *   fall       — "Earth Tones" 30-colour Procreate palette
 *   steampunk  — Dark Chocolate #443025 / Aloewood #7F5836 / Milk Tea #AA7F66 / Sakura #EC9C9D /
 *                Misty Rose #F2CF2A
 *   cozy       — Mist #f5f6f4 / Sandstone #f2e6c9 / Alabaster #ebc4b2 / Lichen #b7c4b4 /
 *                Sea Glass #6f8676
 *   cyberpunk  — Rhythm #766DA7 / Eerie Black #15191E / Camouflage Green #7A9663 /
 *                Ebony #556842 / Laurel Green #A0AE91
 *
 * THREE RULES, ALL INHERITED FROM THE REST OF THE SYSTEM AND NONE OF THEM OPTIONAL:
 *
 * 1. EVERY MOVING PART IS DECORATION. Nothing here carries state, marks a cursor, or indicates
 *    anything. A person is meant to be able to ignore all of it, and a caregiver who turns motion
 *    off loses nothing but the drift.
 * 2. MOTION IS OPT-IN. Every animation sits inside `prefers-reduced-motion: no-preference`. With
 *    motion off the ground still looks composed: every travelling element carries a placed inline
 *    position, which the keyframe overrides only while it animates.
 * 3. THE GROUND SERVES THE CARDS. Each theme re-declares the --ab-* tokens — surface, ink, line,
 *    scan colour, the --ab-sym-* word accents and --ab-veil — plus its own tinted icon set, so the
 *    cards stay above 4.5:1 and a card's word still matches the accent inside its symbol.
 *
 *    THE DEFAULT IS A VEIL, AND `transparent` IS THE CLAIM THAT NEEDS EVIDENCE. Every ground here
 *    has scenery reaching the card band, so every one declares a translucent --ab-veil, and the
 *    ALPHA IS DERIVED FROM WHATEVER CROSSES THAT BAND AND MINIMISES CONTRAST WITH THE WORD —
 *    the BRIGHTEST thing where the ink is light, the DARKEST thing where the ink is dark. Not the
 *    base gradient, and not whichever mover is most obvious: on `cozy` the lamp glow is eye-catching
 *    and irrelevant, while its dark shelf boards are what the dark ink has to survive. Worst case
 *    per ground as shipped: fall .8 over a #dcc08a leaf → 6.4:1 · steampunk .6 over a .42-alpha
 *    #F2CF2A tooth → 6.5:1 · cyberpunk .68 over an #A0AE91 lit window → 5.7:1 · cozy .9 over a
 *    #3b2f22 shelf board → 5.1:1.
 */

const CSS = `
.ng{position:absolute;inset:0;overflow:hidden;pointer-events:none}
.ng>*{position:absolute}

/* depth structure */
.ng-plane{}
.ng-wall{}
.ng-haze{left:-6%;right:-6%}
.ng-tree{bottom:0;clip-path:polygon(50% 0,100% 100%,0 100%)}
.ng-trunk{}
.ng-canopy{border-radius:50%;filter:blur(2.5px)}
.ng-bldg{background-repeat:repeat}
.ng-book{border-radius:1px}
.ng-win{border-radius:3px}
.ng-sign{border-radius:2px}

/* movers */
.ng-leaf{}
.ng-seed{border-radius:50%;opacity:.5}
.ng-mist{left:-10%;right:-10%;filter:blur(20px)}
.ng-shaft{transform-origin:top center;filter:blur(12px)}
.ng-kelp{transform-origin:bottom center}
.ng-gear{border-radius:50%}
.ng-steam{border-radius:50%;filter:blur(7px)}
.ng-rivet{border-radius:50%}
.ng-rain{border-radius:1px}
.ng-bar{border-radius:1px}
.ng-lit{border-radius:1px}
.ng-glow{border-radius:50%;filter:blur(30px)}
.ng-blob{border-radius:50%;filter:blur(26px)}
.ng-dust{border-radius:50%}
.ng-fish{}
.ng-ufo{}
.ng-tail{transform-origin:bottom left}
.ng-eye{border-radius:50%}
.ng-vig{inset:0}
/* overlays */
.ng-pulse{border-radius:50%}
.ng-breath{transform-origin:bottom center}
.ng-wing{transform-origin:right center}
.ng-rare{}

@media (prefers-reduced-motion: no-preference){
  /* A TRAVELLING ELEMENT ANIMATES \`top\`, NOT \`translateY(%)\`: a percentage translate resolves
     against the ELEMENT's own height, so a 20px leaf told to move 120% moved 24px and vanished a
     fifth of the way down. A percentage \`top\` resolves against the container. */
  .ng-leaf,.ng-seed{animation:ngFall linear infinite}
  .ng-rain{animation:ngStreak linear infinite}
  .ng-fish{animation:ngSwim linear infinite}
  .ng-ufo{animation:ngUfo 40s linear infinite}
  .ng-balloon{animation:ngBalloon 160s linear infinite}
  .ng-shoot{animation:ngShoot 70s linear infinite}
  .ng-butterfly{animation:ngButterfly 50s ease-in-out infinite}
  .ng-tail{animation:ngTail ease-in-out infinite alternate}
  .ng-eye{animation:ngBlink 7s steps(1,end) infinite}
  .ng-mist,.ng-haze{animation:ngSlide ease-in-out infinite alternate}
  .ng-shaft,.ng-kelp{animation:ngSway ease-in-out infinite alternate}
  .ng-gear{animation:ngSpin linear infinite}
  .ng-steam{animation:ngRise ease-out infinite}
  .ng-rivet,.ng-lit{animation:ngGlint ease-in-out infinite alternate}
  .ng-bar,.ng-sign{animation:ngFlicker steps(1,end) infinite}
  .ng-glow{animation:ngBreathe ease-in-out infinite}
  .ng-canopy{animation:ngSlide ease-in-out infinite alternate}
  .ng-blob{animation:ngDrift ease-in-out infinite alternate}
  .ng-dust{animation:ngFloat ease-in-out infinite alternate}
  .ng-pulse{animation:ngPulse ease-in-out infinite alternate}
  .ng-breath{animation:ngBreath 4.2s ease-in-out infinite alternate}
  .ng-wing{animation:ngFlap 1.4s ease-in-out infinite alternate}
}
@keyframes ngFall{from{top:-14%;transform:translateX(0) rotate(0deg) scale(var(--s,1))}to{top:112%;transform:translateX(var(--sway,18px)) rotate(var(--spin,420deg)) scale(var(--s,1))}}
@keyframes ngStreak{from{top:-18%}to{top:118%}}
@keyframes ngSwim{from{left:-16%}to{left:116%}}
/* THE UFO IS OFFSCREEN FOR 82% OF ITS CYCLE. "Every once in a while" in an endless loop means the
   element spends most of the loop out of frame and crosses briefly; a continuous drift would make
   it furniture, and furniture is not an event. */
@keyframes ngUfo{0%,72%{left:-22%;top:12%;opacity:0}74%{opacity:.95}80%{top:8%}88%{opacity:.95}92%,100%{left:118%;top:14%;opacity:0}}
@keyframes ngSlide{from{transform:translateX(-3%)}to{transform:translateX(3%)}}
@keyframes ngSway{from{transform:rotate(-2.5deg)}to{transform:rotate(2.5deg)}}
@keyframes ngSpin{to{transform:rotate(360deg)}}
@keyframes ngRise{0%{transform:translateY(20%) scale(.7);opacity:0}30%{opacity:.5}100%{transform:translateY(-140%) scale(1.6);opacity:0}}
@keyframes ngGlint{from{opacity:.3}to{opacity:.9}}
@keyframes ngFlicker{0%,88%,100%{opacity:.85}90%{opacity:.3}93%{opacity:1}96%{opacity:.38}}
@keyframes ngBreathe{0%,100%{opacity:.4}50%{opacity:.8}}
@keyframes ngDrift{from{transform:translate(0,0) scale(1)}to{transform:translate(var(--dx,30px),var(--dy,-22px)) scale(1.16)}}
@keyframes ngFloat{from{transform:translateY(0)}to{transform:translateY(var(--dy,-16px))}}
@keyframes ngTail{from{transform:rotate(-7deg)}to{transform:rotate(9deg)}}
/* A blink is two frames long out of a seven-second cycle, and it is the only thing on the nimrod
   ground that changes shape rather than brightness. Long gaps, brief event — same reasoning as the
   UFO: a cat that blinks every second is a strobe, not a cat. */
@keyframes ngPulse{from{opacity:.12}to{opacity:.95}}
/* A sleeping animal's breath: four seconds a cycle, four percent of its height. Slower than that and
   nobody sees it; faster and it is panting, which reads as distress rather than sleep. */
@keyframes ngBreath{from{transform:scaleY(1)}to{transform:scaleY(1.045)}}
@keyframes ngFlap{from{transform:scaleX(1)}to{transform:scaleX(.35)}}
/* RARE CROSSINGS, same rule as the UFO: most of the loop off screen, a brief visit. */
@keyframes ngBalloon{0%,55%{left:-16%;top:30%;opacity:0}57%{opacity:1}98%{opacity:1}100%{left:108%;top:12%;opacity:0}}
@keyframes ngShoot{0%,97%{transform:translate(0,0) rotate(-24deg);opacity:0}97.4%{opacity:1}99.2%,100%{transform:translate(190px,86px) rotate(-24deg);opacity:0}}
@keyframes ngButterfly{0%{left:-10%;top:18%;opacity:0}2%{opacity:1}9%,38%{left:var(--rest-x,62%);top:var(--rest-y,58%)}48%{left:112%;top:10%;opacity:1}49%,100%{left:112%;top:10%;opacity:0}}
@keyframes ngBlink{0%,93%,100%{transform:scaleY(1)}95%,97%{transform:scaleY(.08)}}
`;
const spread = (i, seed) => (i * 37 + seed * 61) % 100;
const vignette = (inner, outer) => __lsh("span", {
  key: "vig",
  className: "ng-vig",
  style: {
    background: `radial-gradient(120% 90% at 50% 40%, ${inner}, ${outer})`
  }
});

/* The haze sheet that sits BETWEEN depth bands. Distance desaturates and lifts black level; a
   silhouette stack without this reads as stickers on glass rather than as a receding world. */
const haze = (key, color, top, height, blur = 9) => __lsh("span", {
  key: key,
  className: "ng-haze",
  style: {
    top,
    height,
    background: `linear-gradient(180deg,${color},transparent)`,
    filter: `blur(${blur}px)`,
    animationDuration: 26 + key.length % 5 * 3 + 's'
  }
});

/* A GEAR THAT READS AS A GEAR. Stacked backgrounds, painted front to back: hub, rim highlight,
   opaque body, and one repeating-conic wedge underneath them all. The body covers the conic out to
   80% of the radius so only the outer fifth survives as teeth.
   `closest-side` IS LOAD-BEARING: by default a radial-gradient sizes to the box's farthest CORNER,
   so a "80%" stop resolves against r√2 and lands at 1.13r — outside the circle, swallowing every
   tooth. The body must also be LIGHTER THAN THE GROUND; an opaque disc at 1.22:1 against its
   backdrop is invisible by construction.
   Interlocking is geometry: a pair's centres are exactly r1 + r2 apart and TOOTH COUNT IS DERIVED
   FROM A SHARED PITCH, because partners must have the same tooth spacing or the teeth cannot line
   up however well the circles touch. Durations are proportional to radius, directions opposed. */
const TOOTH_PITCH = 17;
function gear({
  key,
  cx,
  cy,
  r,
  spin,
  dir,
  hub,
  body,
  rim,
  tooth,
  blur,
  opacity
}) {
  const teeth = Math.max(6, Math.round(2 * Math.PI * r / TOOTH_PITCH));
  const step = 360 / teeth;
  const t = (step * 0.34).toFixed(2);
  return __lsh("span", {
    key: key,
    className: "ng-gear",
    style: {
      width: r * 2,
      height: r * 2,
      left: cx - r,
      top: cy - r,
      background: [`radial-gradient(circle closest-side, ${hub} 0 15%, transparent 16%)`, `radial-gradient(circle closest-side, transparent 0 62%, ${rim} 63% 80%, transparent 81%)`, `radial-gradient(circle closest-side, transparent 0 19%, ${body} 20% 80%, transparent 81%)`, `repeating-conic-gradient(from 0deg, ${tooth} 0 ${t}deg, transparent ${t}deg ${step.toFixed(2)}deg)`].join(','),
      filter: blur ? `blur(${blur}px)` : undefined,
      opacity,
      animationDuration: spin + 's',
      animationDirection: dir < 0 ? 'reverse' : 'normal'
    }
  });
}

/* A TRUNK IS NOT A RECTANGLE. Four things turn a pole into a tree, and all four are cheap:
   TAPER (a clip-path narrowing upward — trees are cones, and a constant-width bar reads as scaffold),
   ROOT FLARE (a wider wedge in the bottom eighth, which is what visually plants it on the ground),
   BARK (a vertical streak texture, so the silhouette has grain instead of being a flat fill), and
   BRANCHES (two or three thin strokes leaving the upper third at a rising angle). */
/* LIMB TABLE, not a formula. `deg = side * (18 + b*9)` could only ever make 18/27/36 degrees —
   near-horizontal bars of constant thickness, longest at the bottom, on strictly alternating sides
   at regular intervals. That is the geometry of a utility-pole crossarm, and it is what made these
   read as poles even after the trunk taper landed. A real limb rises steeply, tapers to a point,
   varies in length and angle from its neighbours, gets SHORTER toward the base, and ends in
   foliage rather than in mid-air.
     [height fraction up the trunk, angle above horizontal, length factor] */
const LIMBS = [[0.13, 64, 1.00], [0.22, 47, 0.84], [0.33, 68, 0.72], [0.45, 53, 0.60], [0.57, 42, 0.48], [0.69, 59, 0.37]];
function tree({
  key,
  l,
  w,
  top,
  base,
  color,
  dark,
  blur,
  opacity,
  branches = 2,
  lean = 0,
  seed = 0,
  foliage,
  snow
}) {
  const h = base - top;
  const flare = Math.max(3, w * 1.7);
  const parts = [__lsh("span", {
    key: key + '-t',
    style: {
      position: 'absolute',
      left: l + '%',
      top: top + '%',
      height: h + '%',
      width: flare,
      marginLeft: -flare / 2,
      clipPath: `polygon(${50 - w / flare * 50}% 0, ${50 + w / flare * 50}% 0, 100% 100%, 0 100%)`,
      background: `linear-gradient(90deg,${dark} 0 22%,${color} 40% 62%,${dark} 100%),
        repeating-linear-gradient(90deg,rgba(0,0,0,.22) 0 1px,transparent 1px 3px)`,
      backgroundBlendMode: 'multiply',
      transform: lean ? `rotate(${lean}deg)` : undefined,
      transformOrigin: 'bottom center',
      filter: blur ? `blur(${blur}px)` : undefined,
      opacity
    }
  })];
  for (let i = 0; i < branches; i += 1) {
    const [frac, deg, lenF] = LIMBS[(i * 2 + seed) % LIMBS.length];
    /* CSS rotate is clockwise, so a left-extending arm rises at +deg and a right-extending one at
       -deg. Both therefore use rotate(-side * deg). */
    const side = (i + seed) % 2 ? 1 : -1;
    const len = Math.max(9, w * 4.2 * lenF);
    const thick = Math.max(3, w * 0.55);
    parts.push(__lsh("span", {
      key: key + '-b' + i,
      style: {
        position: 'absolute',
        left: l + '%',
        top: top + h * frac + '%',
        width: len,
        height: thick,
        marginLeft: side < 0 ? -len : 0,
        transform: `rotate(${-side * deg}deg)`,
        transformOrigin: side < 0 ? 'right center' : 'left center',
        filter: blur ? `blur(${blur}px)` : undefined,
        opacity
      }
    }, __lsh("span", {
      style: {
        position: 'absolute',
        inset: 0,
        background: dark,
        clipPath: side < 0 ? 'polygon(0 42%, 100% 0, 100% 100%, 0 58%)' : 'polygon(0 0, 100% 42%, 100% 58%, 0 100%)'
      }
    }), snow &&
    /* SNOW IS DRAWN INSIDE THE LIMB'S OWN BOX. Sharing the wedge clip-path is not enough on
       its own: a NEGATIVE `top` translates the snow out of the box it is meant to be riding,
       and half of it then hangs in open sky — which is exactly what the floating chevrons
       were. It stays at top:0, no taller than the wedge, and stops at 56% of the limb's
       length, because snow sits on the inner, thicker part of a branch. */
    __lsh("span", {
      style: {
        position: 'absolute',
        top: 0,
        height: Math.max(1.5, thick * 0.42),
        left: side < 0 ? '44%' : 0,
        width: '56%',
        background: snow,
        opacity: .72,
        borderRadius: 2,
        clipPath: side < 0 ? 'polygon(0 55%, 100% 12%, 100% 72%, 0 100%)' : 'polygon(0 12%, 100% 55%, 100% 100%, 0 72%)'
      }
    }), foliage && __lsh("span", {
      style: {
        position: 'absolute',
        top: '50%',
        left: side < 0 ? 0 : '100%',
        width: len * 0.5,
        height: thick * 3.4,
        marginLeft: side < 0 ? -len * 0.25 : -len * 0.25,
        marginTop: -thick * 1.7,
        borderRadius: '50%',
        background: foliage,
        filter: 'blur(2px)',
        opacity: .85
      }
    })));
  }
  return parts;
}

/* A RIDGE IS A FILL PLUS A RIM. Two copies of the same silhouette, the lighter one offset upward a
   couple of pixels, so what shows along each crest is mist catching it. This is what separates
   layered ridges whose fills are only 1.2:1 apart — the alternative, grading the fills themselves,
   needs luminance range a night sky does not have below its own sky value. */
function ridge({
  key,
  left,
  bottom,
  width,
  height,
  clip,
  fill,
  rim,
  blur,
  opacity
}) {
  const box = {
    left,
    width,
    marginLeft: -width / 2,
    height,
    clipPath: clip,
    filter: blur ? `blur(${blur}px)` : undefined,
    opacity
  };
  return [__lsh("span", {
    key: key + '-r',
    className: "ng-tree",
    style: {
      ...box,
      bottom: `calc(${bottom} + 3px)`,
      background: rim
    }
  }), __lsh("span", {
    key: key + '-f',
    className: "ng-tree",
    style: {
      ...box,
      bottom,
      background: fill
    }
  })];
}
const GROUND_THEMES = {
  /* THE BOARD'S OWN DARK SURFACE. The black cat that used to live here is now the `cat` OVERLAY,
     and can sit on any scene; the notes below on drawing it on black still apply wherever it goes.
     Requested addition — the repo ships this surface plain, with the Wallpaper module's slow hue
     drift; the cat is ours, not upstream.
      A BLACK CAT ON BLACK CANNOT READ BY ITS FILL, so it is drawn by the three things that do read:
       1. IT IS DARKER THAN THE GROUND (#05070a against #12181c), so it reads as a hole in the room
          rather than as a shape painted on it. Lightening it to "show" it would make it a grey cat.
       2. A RIM. The same silhouette, offset up-left in a cool light and sitting behind the fill, so
          what you see along the head and back is the moss glow catching its fur. This is the
          `ridge()` idea applied to an animal, and it is the whole reason the cat has an edge.
       3. THE EYES, which are the only bright thing, and which blink.
     Everything else about it is scenery: it marks nothing, and a person who never notices the cat
     has lost nothing. */
  nimrod: {
    label: 'Nimrod',
    ground: 'linear-gradient(168deg,#0b0f12,#12181c 58%,#0b0f12)',
    tokens: {
      '--ab-bg': '#12181c',
      '--ab-card': '#1b2429',
      '--ab-ink': '#e8eef0',
      '--ab-line': '#7d939d',
      '--ab-lit': '#8fae63',
      /* brightest thing crossing the card band is a #8fae63 eye at .62 -> 7.1:1 */
      '--ab-veil': 'rgba(18,24,28,.62)'
    },
    halo: 'dark',
    base: 'color',
    render: () => {
      return [__lsh("span", {
        key: "g1",
        className: "ng-glow",
        style: {
          width: '48%',
          height: '60%',
          left: '-10%',
          top: '-16%',
          background: 'rgba(131,153,88,.30)',
          animationDuration: '13s'
        }
      }), __lsh("span", {
        key: "g2",
        className: "ng-glow",
        style: {
          width: '42%',
          height: '52%',
          right: '-8%',
          bottom: '-14%',
          background: 'rgba(16,86,102,.36)',
          animationDuration: '17s',
          animationDelay: '-4s'
        }
      }), __lsh("span", {
        key: "g3",
        className: "ng-glow",
        style: {
          width: '30%',
          height: '34%',
          left: '38%',
          top: '52%',
          background: 'rgba(211,150,140,.16)',
          animationDuration: '21s',
          animationDelay: '-9s'
        }
      }), ...Array.from({
        length: 10
      }, (_, i) => __lsh("span", {
        key: 'd' + i,
        className: "ng-dust",
        style: {
          width: 2 + i % 3,
          height: 2 + i % 3,
          left: spread(i, 3) + '%',
          top: spread(i, 7) + '%',
          background: 'rgba(232,238,240,.24)',
          animationDuration: 9 + i % 5 * 3 + 's',
          animationDelay: -(i * 1.4) + 's',
          '--dy': (i % 2 ? -1 : 1) * (10 + i * 2) + 'px'
        }
      })), vignette('transparent', 'rgba(3,5,7,.6)')];
    }
  },
  /* FALL — a path INTO a forest, after the reference: lit canopy overhead, trunks receding in three
     bands, a leaf-littered trail narrowing to a bright vanishing point, and leaves coming down
     through all three depths. */
  fall: {
    label: 'Fall',
    ground: 'linear-gradient(176deg,#1c2216 0%,#242c1a 20%,#2b3620 38%,#3a3a24 64%,#2f3524 100%)',
    tokens: {
      '--ab-bg': '#2a2a1e',
      '--ab-card': '#2f3524',
      '--ab-ink': '#f0e6e2',
      '--ab-line': '#a89c8e',
      '--ab-lit': '#dcc08a',
      '--ab-sym-yes': '#cfdcc4',
      '--ab-sym-no': '#e0bfc4',
      '--ab-sym-need': '#dcc08a',
      '--ab-sym-hot': '#dba179',
      '--ab-sym-cold': '#8fa9bd',
      '--ab-sym-love': '#e0bfc4',
      '--ab-veil': 'rgba(42,42,30,.8)'
    },
    halo: 'dark',
    /* its own tinted icon set: the word takes its symbol's accent, so re-theming --ab-sym-*
       without re-tinting the ART would split the pair */
    base: 'fall',
    render: () => {
      const hues = ['#d2823f', '#a96a3a', '#dba179', '#7d3230', '#dcc08a', '#b99a94'];
      const shapes = ['60% 10% 60% 10%', '50% 0 50% 50%', '80% 20% 80% 20%', '0 60% 0 60%'];
      /* [left%, trunk width, top%, height%] — three bands, each smaller and hazier going back */
      /* TRUNK BASES ARE DERIVED FROM THE TRAIL, NOT GUESSED. The trail's top edge is the HORIZON
         (38% down), and below it the trapezoid's edges run x = 42 - 50d (left) and 58 + 50d
         (right) for depth d. A trunk whose base sat inside that silhouette was a tree growing out
         of the middle of the path, cut off with a flat horizontal edge — which is exactly what
         made both bands read as floating bars.
           far  = [left%, width, top%]           — every base lands ON the horizon
           mid  = [left%, width, top%, base%]    — each base is the depth where the verge is still
                                                   outside the trail at that x */
      const HORIZON = 38;
      const far = [[8, 6, 14], [21, 7, 16], [34, 5, 17], [46, 6, 16], [57, 6, 15], [68, 5, 17], [79, 7, 14], [91, 6, 16]];
      const mid = [[3, 15, 8, 86], [17, 12, 10, 69], [30, 11, 12, 53], [64, 11, 12, 45], [78, 14, 10, 63], [94, 12, 8, 83]];
      const near = [[-3, 16, -10, 116], [13, 11, -6, 112], [84, 12, -8, 114], [99, 17, -10, 116]];
      return [
      /* PAINT ORDER IS THE WHOLE TRICK HERE. Ground first, then the treeline, then the CANOPY,
         and only then the mid and near trunks — so the trunks rise THROUGH the lit foliage the
         way they do when you look up in a wood. Painted last, the canopy covered every trunk
         above its lower edge and became one horizontal band with V-notches cut into it, which is
         geometrically a mountain range. */

      /* --- 1. the light at the gap the trail leads to --- */
      __lsh("span", {
        key: "vp",
        className: "ng-glow",
        style: {
          left: '38%',
          top: '22%',
          width: '24%',
          height: '22%',
          background: 'rgba(240,230,200,.45)',
          animationDuration: '23s'
        }
      }),
      /* --- 2. THE TRAIL. Its upper stops recede into shadow: a trail that gets brighter toward
             the horizon reads as a snowfield. --- */
      __lsh("span", {
        key: "path",
        className: "ng-plane",
        style: {
          left: 0,
          right: 0,
          top: HORIZON + '%',
          bottom: 0,
          clipPath: 'polygon(42% 0, 58% 0, 108% 100%, -8% 100%)',
          background: 'linear-gradient(180deg,#6f6a55 0%,#8a7355 24%,#a46b3a 58%,#7d3230 100%)'
        }
      }), __lsh("span", {
        key: "pathlit",
        className: "ng-plane",
        style: {
          left: 0,
          right: 0,
          top: '58%',
          bottom: 0,
          clipPath: 'polygon(46% 0, 54% 0, 84% 100%, 16% 100%)',
          background: 'linear-gradient(180deg,transparent,rgba(220,192,138,.28))'
        }
      }),
      /* --- 3. the treeline: light hazy trunks standing ON the horizon, each topped with dark
             foliage so the far band is a wood rather than a row of stubs --- */
      ...far.flatMap(([l, w, t], i) => tree({
        key: 'tf' + i,
        l,
        w,
        top: t,
        base: HORIZON,
        color: '#8fa39c',
        dark: '#7b8f88',
        blur: .6,
        opacity: .8,
        branches: 2,
        seed: i
      })), ...far.map(([l, w, t], i) => __lsh("span", {
        key: 'ff' + i,
        className: "ng-canopy",
        style: {
          left: l + '%',
          top: t - 7 + '%',
          width: 34 + i % 3 * 14,
          height: '15%',
          marginLeft: -(17 + i % 3 * 7),
          background: i % 2 ? '#2f3a22' : '#26301c',
          opacity: .9,
          filter: 'blur(2px)',
          animationDuration: 33 + i * 3 + 's'
        }
      })), haze('hz-far', 'rgba(168,156,142,.30)', '18%', '30%', 9), /* --- 4. canopy: ONE irregular mass with a ragged underside --- */
      __lsh("span", {
        key: "canopy",
        className: "ng-canopy",
        style: {
          left: '-6%',
          right: '-6%',
          top: '-26%',
          height: '62%',
          clipPath: 'polygon(0 0,100% 0,100% 62%,92% 78%,84% 58%,74% 82%,63% 62%,54% 86%,44% 64%,35% 84%,26% 60%,17% 80%,8% 58%,0 74%)',
          background: ['radial-gradient(38% 46% at 12% 58%, #dcc08a, transparent 72%)', 'radial-gradient(42% 52% at 38% 66%, #d2823f, transparent 74%)', 'radial-gradient(36% 48% at 62% 60%, #b8a05a, transparent 72%)', 'radial-gradient(40% 50% at 86% 64%, #a96a3a, transparent 74%)', 'radial-gradient(60% 40% at 50% 30%, #c98a35, transparent 78%)', 'linear-gradient(180deg,#8c5a1e,#a96a3a)'].join(','),
          opacity: .95,
          animationDuration: '31s'
        }
      }), haze('hz-can', 'rgba(220,192,138,.16)', '-4%', '18%', 7), __lsh("span", {
        key: "shaft",
        className: "ng-shaft",
        style: {
          width: '30%',
          height: '110%',
          left: '46%',
          top: '-20%',
          background: 'linear-gradient(180deg,rgba(240,230,200,.22),transparent 70%)',
          animationDuration: '19s'
        }
      }),
      /* --- 5. mid trunks: painted AFTER the canopy so they run up through it, and down to a
             verge outside the trail --- */
      ...mid.flatMap(([l, w, t, b], i) => tree({
        key: 'tm' + i,
        l,
        w,
        top: t,
        base: b,
        color: i % 2 ? '#5c4832' : '#6b5335',
        dark: '#33281b',
        branches: 4,
        lean: (i % 2 ? 1 : -1) * 1.5,
        seed: i,
        foliage: '#a96a3a'
      })), /* --- 6. undergrowth along both verges, painted over the trunk bases so no flat cut shows --- */
      ...Array.from({
        length: 12
      }, (_, i) => {
        const d = i / 11;
        const w = 12 + d * 40;
        return __lsh("span", {
          key: 'ug' + i,
          className: "ng-tree",
          style: {
            left: (i % 2 ? 4 + d * 22 : 96 - d * 22) + '%',
            bottom: 34 - d * 34 + '%',
            height: 6 + d * 22 + '%',
            width: w,
            marginLeft: -w / 2,
            background: i % 3 ? '#4a5230' : '#5e6b3f',
            opacity: .75 + d * .25
          }
        });
      }), /* --- 7. near band: big dark trunks running off both edges of the frame --- */
      ...near.flatMap(([l, w, t, h], i) => tree({
        key: 'tn' + i,
        l,
        w,
        top: t,
        base: t + h,
        color: i % 2 ? '#2e2318' : '#3a2c1d',
        dark: '#1a140d',
        blur: 1.2,
        branches: 3,
        seed: i + 1,
        foliage: '#8c5a1e'
      })), /* --- 8. leaves in three depth bands --- */
      ...Array.from({
        length: 22
      }, (_, i) => {
        const band = i % 3;
        const sc = [0.55, 0.85, 1.3][band];
        return __lsh("span", {
          key: 'l' + i,
          className: "ng-leaf",
          style: {
            width: 9 + i % 4 * 5,
            height: 13 + i % 3 * 6,
            left: spread(i, 2) + '%',
            top: spread(i, 9) + '%',
            background: hues[i % hues.length],
            borderRadius: shapes[i % shapes.length],
            opacity: [0.5, 0.72, 0.92][band],
            filter: band === 0 ? 'blur(1px)' : band === 2 ? 'blur(.4px)' : undefined,
            '--s': sc,
            '--sway': (i % 2 ? 1 : -1) * (14 + i % 5 * 12) + 'px',
            '--spin': (i % 3 ? 1 : -1) * (300 + i % 4 * 160) + 'deg',
            animationDuration: [17, 13, 9][band] + i % 5 * 1.6 + 's',
            animationDelay: -(i * 1.1) + 's'
          }
        });
      }), ...Array.from({
        length: 7
      }, (_, i) => __lsh("span", {
        key: 'sd' + i,
        className: "ng-seed",
        style: {
          width: 3 + i % 2 * 2,
          height: 3 + i % 2 * 2,
          left: spread(i, 11) + '%',
          top: spread(i, 4) + '%',
          background: '#dcc08a',
          '--sway': (i % 2 ? 1 : -1) * (26 + i * 7) + 'px',
          animationDuration: 15 + i % 4 * 4 + 's',
          animationDelay: -(i * 2.6) + 's'
        }
      })), vignette('transparent', 'rgba(26,22,12,.62)')];
    }
  },
  /* STEAMPUNK — the reference is a wall of machinery with no background at all: gears overlapping
     gears at every scale, some cut off by the frame, a belt running across, pipes and springs
     behind. So this ground has no sky — it is three depth bands of meshing pairs, the far ones
     small and blurred, the near ones huge and running off the edges. */
  steampunk: {
    label: 'Steampunk',
    ground: 'radial-gradient(90% 70% at 30% 8%,rgba(242,207,42,.14),transparent 62%),linear-gradient(150deg,#1d1309,#32220f 46%,#463012 100%)',
    tokens: {
      '--ab-bg': '#2b1d14',
      '--ab-card': '#3a281e',
      '--ab-ink': '#f5e3db',
      '--ab-line': '#AA7F66',
      '--ab-lit': '#F2CF2A',
      '--ab-sym-yes': '#c8d8a8',
      '--ab-sym-no': '#EC9C9D',
      '--ab-sym-need': '#F2CF2A',
      '--ab-sym-hot': '#e8a87c',
      '--ab-sym-cold': '#a8c4cf',
      '--ab-sym-love': '#EC9C9D',
      /* brightest mover is a .42-alpha #F2CF2A brass tooth — .6 puts the word at 6.5:1 */
      '--ab-veil': 'rgba(46,32,25,.6)'
    },
    halo: 'dark',
    base: 'steampunk',
    render: () => {
      const brass = 'rgba(242,207,42,.42)';
      const hub = '#2b1d14';
      const milkTea = '#AA7F66';
      /* Opaque bodies, LIGHTER than the ground they are bolted to (Aloewood at .1218 luminance vs
         the ground's .0270 = 2.9:1; the earlier #4a3524 was 1.22:1 and vanished). */
      const bodyA = '#7F5836';
      const bodyB = '#8d6440';
      const bodyFar = '#5e4228';
      /* Three bands. Far: small, blurred, dim. Mid: the meshing pairs you read. Near: oversized and
         part-cropped by the frame, which is what makes the wall feel deep rather than tiled. */
      const far = [{
        cx: 60,
        cy: 40,
        r: 17,
        spin: 15,
        dir: 1
      }, {
        cx: 60 + 17 + 11,
        cy: 40,
        r: 11,
        spin: 10,
        dir: -1
      }, {
        cx: 178,
        cy: 26,
        r: 14,
        spin: 13,
        dir: -1
      }, {
        cx: 178 + 14 + 10,
        cy: 26,
        r: 10,
        spin: 9,
        dir: 1
      }, {
        cx: 128,
        cy: 150,
        r: 15,
        spin: 14,
        dir: 1
      }, {
        cx: 128 + 15 + 10,
        cy: 150,
        r: 10,
        spin: 9,
        dir: -1
      }, {
        cx: 296,
        cy: 158,
        r: 13,
        spin: 12,
        dir: -1
      }];
      const mid = [{
        cx: 34,
        cy: 30,
        r: 34,
        spin: 29,
        dir: 1
      }, {
        cx: 34 + 34 + 21,
        cy: 30,
        r: 21,
        spin: 18,
        dir: -1
      }, {
        cx: 96,
        cy: 128,
        r: 29,
        spin: 25,
        dir: -1
      }, {
        cx: 96 + 29 + 18,
        cy: 128,
        r: 18,
        spin: 16,
        dir: 1
      }, {
        cx: 222,
        cy: 74,
        r: 31,
        spin: 27,
        dir: 1
      }, {
        cx: 222 + 31 + 19,
        cy: 74,
        r: 19,
        spin: 17,
        dir: -1
      }];
      const near = [{
        cx: -18,
        cy: 128,
        r: 62,
        spin: 52,
        dir: -1
      }, {
        cx: -18 + 62 + 38,
        cy: 128,
        r: 38,
        spin: 32,
        dir: 1
      }, {
        cx: 336,
        cy: 30,
        r: 56,
        spin: 47,
        dir: 1
      }];
      return [/* backplate: rusted metal, so the far gears have something to sit on rather than sky */
      __lsh("span", {
        key: "plate",
        style: {
          inset: 0,
          background: 'repeating-linear-gradient(118deg,rgba(125,50,48,.16) 0 9px,transparent 9px 26px),repeating-linear-gradient(28deg,rgba(242,207,42,.07) 0 14px,transparent 14px 34px)'
        }
      }), /* rust: irregular patches eating the plate, not a uniform tint */
      __lsh("span", {
        key: "rust",
        style: {
          inset: 0,
          opacity: .8,
          background: ['radial-gradient(28% 34% at 12% 22%, rgba(125,50,48,.55), transparent 70%)', 'radial-gradient(22% 30% at 78% 14%, rgba(168,71,28,.5), transparent 72%)', 'radial-gradient(34% 26% at 58% 88%, rgba(125,50,48,.45), transparent 74%)', 'radial-gradient(18% 22% at 32% 62%, rgba(168,71,28,.42), transparent 70%)', 'radial-gradient(14% 18% at 92% 58%, rgba(125,50,48,.5), transparent 70%)'].join(',')
        }
      }), ...far.map((g, i) => gear({
        key: 'gf' + i,
        ...g,
        hub,
        body: bodyFar,
        rim: '#7F5836',
        tooth: 'rgba(242,207,42,.3)',
        blur: 1.6,
        opacity: .7
      })), haze('hz-mach', 'rgba(68,48,37,.5)', '0%', '100%', 12), /* oil: dark drips running down from the bearings */
      ...[[19, 24, 34], [41, 6, 52], [63, 40, 30], [82, 18, 44], [8, 54, 26], [71, 62, 22]].map(([l, t, h], i) => __lsh("span", {
        key: 'oil' + i,
        style: {
          left: l + '%',
          top: t + '%',
          width: 3 + i % 3,
          height: h + '%',
          background: 'linear-gradient(180deg,rgba(12,8,4,.75),rgba(12,8,4,.15))',
          borderRadius: '0 0 3px 3px',
          filter: 'blur(.6px)'
        }
      })), /* grime: soot gathering in the corners and along the bottom, where it always does */
      __lsh("span", {
        key: "soot",
        style: {
          inset: 0,
          background: ['radial-gradient(60% 40% at 8% 100%, rgba(10,7,4,.75), transparent 70%)', 'radial-gradient(55% 38% at 94% 96%, rgba(10,7,4,.7), transparent 72%)', 'radial-gradient(48% 30% at 50% -6%, rgba(10,7,4,.6), transparent 70%)'].join(',')
        }
      }), /* scratches and wear marks */
      __lsh("span", {
        key: "scratch",
        style: {
          inset: 0,
          opacity: .5,
          background: 'repeating-linear-gradient(72deg,rgba(242,207,42,.10) 0 1px,transparent 1px 21px),repeating-linear-gradient(-58deg,rgba(0,0,0,.22) 0 1px,transparent 1px 17px)'
        }
      }), /* the belt: one long shape across the machine, behind the mid gears */
      __lsh("span", {
        key: "belt",
        style: {
          left: '-6%',
          right: '-6%',
          top: '46%',
          height: 5,
          background: 'linear-gradient(180deg,#1d1409,#3a2a1a,#1d1409)',
          transform: 'rotate(-7deg)'
        }
      }), __lsh("span", {
        key: "spring",
        style: {
          left: '52%',
          top: '62%',
          width: 54,
          height: 16,
          background: 'repeating-linear-gradient(90deg,#1d1409 0 3px,transparent 3px 8px)',
          transform: 'rotate(-7deg)',
          opacity: .8
        }
      }), ...[['16%', 0, 5, '100%', true], ['66%', 0, 5, '100%', true]].map(([a, b, w, h, v], i) => __lsh("span", {
        key: 'p' + i,
        style: {
          width: w,
          height: h,
          left: v ? a : b,
          top: v ? b : a,
          borderRadius: 2,
          background: 'linear-gradient(90deg,#2b1d14,#AA7F66,#2b1d14)',
          opacity: .75
        }
      })), ...mid.map((g, i) => gear({
        key: 'gm' + i,
        ...g,
        hub,
        rim: milkTea,
        tooth: brass,
        body: i % 2 ? bodyB : bodyA
      })), ...Array.from({
        length: 12
      }, (_, i) => __lsh("span", {
        key: 'rv' + i,
        className: "ng-rivet",
        style: {
          width: 4,
          height: 4,
          left: spread(i, 5) + '%',
          top: spread(i, 13) + '%',
          background: '#F2CF2A',
          animationDuration: 4 + i % 4 + 's',
          animationDelay: -(i * 0.9) + 's'
        }
      })), /* near band last, blurred at the edge of the lens */
      ...near.map((g, i) => gear({
        key: 'gn' + i,
        ...g,
        hub,
        rim: milkTea,
        tooth: brass,
        body: i % 2 ? bodyB : bodyA,
        blur: 1.1,
        opacity: .96
      })), ...Array.from({
        length: 12
      }, (_, i) => __lsh("span", {
        key: 'gd' + i,
        className: "ng-dust",
        style: {
          width: 2 + i % 3,
          height: 2 + i % 3,
          left: spread(i, 7) + '%',
          top: spread(i, 3) + '%',
          background: 'rgba(242,207,42,.5)',
          animationDuration: 8 + i % 5 * 3 + 's',
          animationDelay: -(i * 1.2) + 's',
          '--dy': (i % 2 ? -1 : 1) * (9 + i * 2) + 'px'
        }
      })), ...Array.from({
        length: 6
      }, (_, i) => __lsh("span", {
        key: 's' + i,
        className: "ng-steam",
        style: {
          width: 24 + i * 8,
          height: 24 + i * 8,
          left: 10 + i * 16 + '%',
          bottom: '-12%',
          background: 'rgba(236,156,157,.16)',
          animationDuration: 8 + i * 1.7 + 's',
          animationDelay: -(i * 1.9) + 's'
        }
      })), vignette('transparent', 'rgba(12,8,3,.72)')];
    }
  },
  /* CYBERPUNK — the reference is a street CANYON, not a skyline: walls of building on both sides
     leaning into a wet street, signs stacked down both walls getting smaller, a tower at the
     vanishing point, gears and pipes overhead, mist and rain through all of it. */
  cyberpunk: {
    label: 'Cyberpunk',
    ground: 'linear-gradient(176deg,#4e566f 0%,#5a4f78 28%,#2a3040 62%,#101520 100%)',
    tokens: {
      '--ab-bg': '#15191E',
      '--ab-card': '#1b2026',
      '--ab-ink': '#cfd6c4',
      '--ab-line': '#766DA7',
      '--ab-lit': '#7A9663',
      '--ab-sym-yes': '#c3ceb4',
      '--ab-sym-no': '#d6a0b8',
      '--ab-sym-need': '#e0d39a',
      '--ab-sym-hot': '#e3a98a',
      '--ab-sym-cold': '#a9c3d6',
      '--ab-sym-love': '#b3a8d9',
      /* brightest mover is a #A0AE91 lit window — .68 puts the word at 5.7:1 */
      '--ab-veil': 'rgba(21,25,30,.68)'
    },
    halo: 'dark',
    base: 'cyberpunk',
    render: () => {
      const win = (c, sx, sy) => ({
        backgroundImage: `radial-gradient(${c} 0 38%, transparent 40%)`,
        backgroundSize: `${sx}px ${sy}px`
      });
      return [/* --- far: the tower at the vanishing point, and the glow behind it --- */
      __lsh("span", {
        key: "skyglow",
        className: "ng-glow",
        style: {
          left: '32%',
          top: '6%',
          width: '36%',
          height: '44%',
          background: 'rgba(118,109,167,.42)',
          animationDuration: '11s'
        }
      }), __lsh("span", {
        key: "tower",
        style: {
          left: '50%',
          top: '10%',
          width: 26,
          marginLeft: -13,
          height: '52%',
          background: '#2b3346',
          ...win('rgba(160,174,145,.5)', 6, 9),
          filter: 'blur(.8px)',
          opacity: .9
        }
      }), __lsh("span", {
        key: "towertop",
        style: {
          left: '50%',
          top: '6%',
          width: 14,
          marginLeft: -7,
          height: '7%',
          background: '#323b50',
          filter: 'blur(.6px)'
        }
      }), ...[[40, 18, 34], [62, 22, 30]].map(([l, t, h], i) => __lsh("span", {
        key: 'fb' + i,
        style: {
          left: l + '%',
          top: t + '%',
          width: 30,
          height: h + '%',
          background: '#2a3040',
          ...win('rgba(118,109,167,.30)', 7, 10),
          filter: 'blur(1.2px)',
          opacity: .85
        }
      })), haze('hz-deep', 'rgba(74,63,102,.58)', '22%', '36%', 12), /* --- THE CANYON: two walls leaning in, and the wet street between them --- */
      __lsh("span", {
        key: "wallL",
        className: "ng-wall",
        style: {
          left: 0,
          top: 0,
          bottom: 0,
          width: '52%',
          clipPath: 'polygon(0 0, 78% 26%, 78% 74%, 0 100%)',
          /* the near walls are the DARKEST band: sky .06 > far blocks .028 > walls .008 */
          background: 'linear-gradient(90deg,#05070a,#0d1119)',
          ...win('rgba(160,174,145,.34)', 9, 12)
        }
      }), __lsh("span", {
        key: "wallR",
        className: "ng-wall",
        style: {
          right: 0,
          top: 0,
          bottom: 0,
          width: '52%',
          clipPath: 'polygon(100% 0, 22% 26%, 22% 74%, 100% 100%)',
          background: 'linear-gradient(270deg,#05070a,#0d1119)',
          ...win('rgba(118,109,167,.36)', 9, 12)
        }
      }), __lsh("span", {
        key: "street",
        className: "ng-plane",
        style: {
          left: 0,
          right: 0,
          top: '46%',
          bottom: 0,
          clipPath: 'polygon(44% 0, 56% 0, 112% 100%, -12% 100%)',
          /* a receding plane is only a plane if it separates from the walls it sits between */
          background: 'linear-gradient(180deg,#4a5266 0%,#5a6480 40%,#626d84 100%)'
        }
      }), /* reflections: vertical smears of the sign colours down the wet street */
      ...[[46, '#766DA7'], [50, '#7A9663'], [54, '#A0AE91'], [42, '#766DA7'], [58, '#7A9663']].map(([l, c], i) => __lsh("span", {
        key: 'rf' + i,
        className: "ng-glow",
        style: {
          left: l + '%',
          top: '52%',
          width: 12 + i * 5,
          height: '44%',
          marginLeft: -(6 + i * 2),
          background: c,
          opacity: .22,
          filter: 'blur(9px)',
          animationDuration: 7 + i * 2 + 's',
          animationDelay: -(i * 1.4) + 's'
        }
      })), /* --- signs down both walls: bigger and brighter as they come forward --- */
      ...Array.from({
        length: 10
      }, (_, i) => {
        const d = i / 9; /* 0 = far, 1 = near */
        const leftSide = i % 2 === 0;
        const w = 5 + d * 8;
        const h = 16 + d * 46;
        const c = ['#766DA7', '#7A9663', '#A0AE91', '#e0d39a'][i % 4];
        return __lsh("span", {
          key: 'sg' + i,
          className: "ng-sign",
          style: {
            left: leftSide ? 6 + (1 - d) * 26 + '%' : 'auto',
            right: leftSide ? 'auto' : 6 + (1 - d) * 26 + '%',
            top: 24 + (1 - d) * 14 + i % 3 * 10 + '%',
            width: w,
            height: h,
            background: c,
            opacity: .5 + d * .4,
            boxShadow: `0 0 ${6 + d * 14}px ${c}`,
            animationDuration: 5 + i % 5 * 1.7 + 's',
            animationDelay: -(i * 1.1) + 's'
          }
        });
      }), ...Array.from({
        length: 10
      }, (_, i) => __lsh("span", {
        key: 'lt' + i,
        className: "ng-lit",
        style: {
          width: 4,
          height: 5,
          left: (i % 2 ? 8 + i % 4 * 5 : 86 - i % 4 * 5) + '%',
          top: 30 + i % 5 * 11 + '%',
          background: i % 3 ? '#A0AE91' : '#766DA7',
          animationDuration: 5 + i % 5 * 2 + 's',
          animationDelay: -(i * 1.3) + 's'
        }
      })),
      /* --- overhead: the things a street canyon actually carries. Gears lived here briefly and
         read as dark toothed portholes floating over a neon street; toothed machinery belongs to
         `steampunk`, and a canyon's overhead clutter is boxes, cable runs and hanging lanterns. */
      ...[[7, 20, 26, 18], [30, 12, 20, 14], [78, 17, 23, 16]].map(([l, t, w, h], i) => __lsh("span", {
        key: 'ac' + i,
        style: {
          left: l + '%',
          top: t + '%',
          width: w,
          height: h,
          borderRadius: 2,
          background: 'linear-gradient(180deg,#39424e,#1b2028)',
          boxShadow: 'inset 0 0 0 1px rgba(160,174,145,.22)',
          opacity: .9,
          filter: i === 2 ? 'blur(.6px)' : undefined
        }
      })), /* cable runs, sagging across the gap */
      ...[[16, -4, 62], [23, 40, 58], [11, 30, 44]].map(([t, l, w], i) => __lsh("span", {
        key: 'cab' + i,
        style: {
          left: l + '%',
          top: t + '%',
          width: w + '%',
          height: 18,
          borderBottom: '1px solid rgba(20,24,30,.9)',
          borderRadius: '0 0 50% 50% / 0 0 100% 100%',
          opacity: .85
        }
      })), /* lanterns strung on the near cable — the only warm light up there */
      ...Array.from({
        length: 7
      }, (_, i) => __lsh("span", {
        key: 'lan' + i,
        className: "ng-lit",
        style: {
          left: 42 + i * 8 + '%',
          top: 25 + (i % 2 ? 1.5 : 0) + '%',
          width: 5,
          height: 7,
          borderRadius: '50% 50% 40% 40%',
          background: i % 3 ? '#E8DCA8' : '#F0B894',
          boxShadow: '0 0 7px 2px rgba(232,220,168,.4)',
          animationDuration: 4 + i % 4 * 2 + 's',
          animationDelay: -(i * 0.8) + 's'
        }
      })), __lsh("span", {
        key: "pipe",
        style: {
          left: '-4%',
          right: '-4%',
          top: '30%',
          height: 7,
          borderRadius: 3,
          background: 'linear-gradient(180deg,#0e1218,#39424e,#0e1218)',
          opacity: .9
        }
      }), /* --- weather: mist low in the canyon, rain in three depth bands --- */
      __lsh("span", {
        key: "mist1",
        className: "ng-mist",
        style: {
          height: '30%',
          bottom: '8%',
          background: 'linear-gradient(180deg,transparent,rgba(160,174,145,.22))',
          animationDuration: '25s'
        }
      }), ...Array.from({
        length: 18
      }, (_, i) => {
        const band = i % 3;
        return __lsh("span", {
          key: 'rn' + i,
          className: "ng-rain",
          style: {
            width: band === 2 ? 2 : 1,
            height: [14, 24, 38][band] + i % 3 * 8,
            left: spread(i, 4) + '%',
            top: spread(i, 8) + '%',
            background: `linear-gradient(180deg,transparent,${i % 3 ? 'rgba(160,174,145,.5)' : 'rgba(118,109,167,.55)'},transparent)`,
            opacity: [0.4, 0.7, 0.95][band],
            animationDuration: [8, 6, 4][band] + i % 4 + 's',
            animationDelay: -(i * 0.5) + 's'
          }
        });
      }), vignette('transparent', 'rgba(0,0,0,.6)')];
    }
  },
  /* WINTER — snow woods at blue hour. Palette: Earth Tones' dusk blues and cool greys. The trick
     here is that the SNOW is the light source: the ground plane is the brightest thing in the frame
     and everything else silhouettes against it, which is the opposite of `fall`. */
  winter: {
    label: 'Winter',
    ground: 'linear-gradient(176deg,#23263a 0%,#3b4a68 26%,#5b6f8c 46%,#8fa9bd 66%,#c9d4dd 100%)',
    tokens: {
      '--ab-bg': '#1b2130',
      '--ab-card': '#232a3a',
      '--ab-ink': '#eef3f6',
      '--ab-line': '#8fa9bd',
      '--ab-lit': '#c9d4dd',
      '--ab-sym-yes': '#bfe0c4',
      '--ab-sym-no': '#e8c0c4',
      '--ab-sym-need': '#e8d6a0',
      '--ab-sym-hot': '#e8b394',
      '--ab-sym-cold': '#bfe0ee',
      '--ab-sym-love': '#e4b8cc',
      /* the snow plane is the brightest thing crossing the band: #dfe7ec at .78 puts the word at 5.2:1 */
      '--ab-veil': 'rgba(27,33,48,.78)'
    },
    halo: 'dark',
    base: 'winter',
    render: () => {
      const H = 44;
      const wfar = [[7, 5, 20], [19, 6, 22], [31, 4, 23], [43, 5, 21], [55, 5, 22], [67, 4, 23], [79, 6, 20], [92, 5, 22]];
      const wmid = [[5, 13, 12, 84], [21, 10, 15, 68], [34, 9, 18, 56], [68, 9, 17, 52], [82, 12, 14, 70], [96, 10, 12, 86]];
      const wnear = [[-3, 16, -10, 116], [13, 11, -6, 112], [84, 12, -8, 114], [99, 17, -10, 116]];
      return [__lsh("span", {
        key: "moon",
        className: "ng-glow",
        style: {
          left: '62%',
          top: '4%',
          width: '20%',
          height: '26%',
          background: 'rgba(201,212,221,.7)',
          animationDuration: '27s'
        }
      }), /* the snowfield: a plane, brightest at the viewer's feet */
      __lsh("span", {
        key: "snow",
        className: "ng-plane",
        style: {
          left: 0,
          right: 0,
          top: H + '%',
          bottom: 0,
          background: 'linear-gradient(180deg,#8fa9bd 0%,#b2c3cf 34%,#dfe7ec 100%)'
        }
      }), ...[[-4, 62, 150], [26, 74, 190], [62, 68, 170], [92, 80, 160]].map(([l, t, w], i) => __lsh("span", {
        key: 'dr' + i,
        style: {
          left: l + '%',
          top: t + '%',
          width: w,
          height: w * 0.3,
          marginLeft: -w / 2,
          borderRadius: '50% 50% 0 0 / 100% 100% 0 0',
          background: 'linear-gradient(180deg,#f2f6f8,#cdd8e0)',
          opacity: .9
        }
      })), ...wfar.flatMap(([l, w, t], i) => tree({
        key: 'wf' + i,
        l,
        w,
        top: t,
        base: H,
        /* NO SNOW on the far band: it would be the brightest thing in the frame, riding a limb
           that is ~1.05:1 against the sky. Distant snow must read as LESS than near snow. */
        color: '#5e6c82',
        dark: '#4c5a70',
        blur: .8,
        opacity: .85,
        branches: 2,
        seed: i
      })), haze('hz-wf', 'rgba(143,169,189,.42)', '26%', '26%', 9), ...wmid.flatMap(([l, w, t, b], i) => tree({
        key: 'wm' + i,
        l,
        w,
        top: t,
        base: b,
        color: '#4a5568',
        dark: '#3c4759',
        branches: 4,
        lean: (i % 2 ? 1 : -1) * 1.5,
        seed: i,
        snow: '#9fb0be' /* mid band: dimmer than the near band's snow */
      })), ...wnear.flatMap(([l, w, t, h], i) => tree({
        key: 'wn' + i,
        l,
        w,
        top: t,
        base: t + h,
        color: '#242c3a',
        dark: '#18202c',
        blur: 1.2,
        branches: 3,
        seed: i + 1,
        snow: '#e6eef3'
      })), ...Array.from({
        length: 26
      }, (_, i) => {
        const band = i % 3;
        return __lsh("span", {
          key: 'sn' + i,
          className: "ng-seed",
          style: {
            width: [2, 3, 5][band],
            height: [2, 3, 5][band],
            borderRadius: '50%',
            left: spread(i, 2) + '%',
            top: spread(i, 9) + '%',
            background: '#f4f8fa',
            opacity: [0.5, 0.75, 0.95][band],
            filter: band === 2 ? 'blur(.5px)' : undefined,
            '--sway': (i % 2 ? 1 : -1) * (10 + i % 5 * 9) + 'px',
            '--spin': '90deg',
            animationDuration: [19, 14, 10][band] + i % 4 * 2 + 's',
            animationDelay: -(i * 0.9) + 's'
          }
        });
      }), vignette('transparent', 'rgba(20,26,40,.55)')];
    }
  },
  /* AQUARIUM — seen from OUTSIDE the glass, which is what makes it a tank rather than open water:
     a dark trim frame, a lit water column, a gravel bed, planting at the back, an airstone column,
     and fish crossing the tank on long loops. Depth runs front-to-back here: the back glass is
     hazed, the planting sits mid-tank, and the front glass carries highlights over everything. */
  ocean: {
    label: 'Aquarium',
    ground: 'linear-gradient(176deg,#0b3346 0%,#12536b 22%,#1d6280 48%,#0e3a52 78%,#07202f 100%)',
    tokens: {
      '--ab-bg': '#08222f',
      '--ab-card': '#0e3242',
      '--ab-ink': '#e4f4f8',
      '--ab-line': '#7fc6d8',
      '--ab-lit': '#a8e6c4',
      '--ab-sym-yes': '#a8e6b4',
      '--ab-sym-no': '#f0b8b0',
      '--ab-sym-need': '#f0dca0',
      '--ab-sym-hot': '#f4b894',
      '--ab-sym-cold': '#bfeaf4',
      '--ab-sym-love': '#f0b4c8',
      /* brightest thing crossing the band is the tank lamp's shaft at .76 -> 5.4:1 */
      '--ab-veil': 'rgba(8,34,47,.76)'
    },
    halo: 'dark',
    base: 'ocean',
    render: () => {
      const fish = [[0, 16, 22, '#f0dca0', 1], [1, 30, 15, '#f4b894', -1], [2, 44, 26, '#bfeaf4', 1], [0, 56, 13, '#f0b4c8', -1], [1, 24, 18, '#a8e6b4', 1], [2, 66, 20, '#f0dca0', -1], [1, 38, 12, '#bfeaf4', 1], [0, 72, 16, '#f4b894', -1]];
      return [/* the lamp in the hood, and the shaft it throws down the tank */
      __lsh("span", {
        key: "hood",
        style: {
          left: 0,
          right: 0,
          top: 0,
          height: '9%',
          background: 'linear-gradient(180deg,#0a1216,#16242b)'
        }
      }), __lsh("span", {
        key: "lamp",
        style: {
          left: '12%',
          right: '12%',
          top: '7%',
          height: 3,
          borderRadius: 2,
          background: '#dff6fb',
          boxShadow: '0 0 14px 5px rgba(212,244,250,.55)'
        }
      }), ...[[24, 34], [56, 40], [80, 30]].map(([l, w], i) => __lsh("span", {
        key: 'ray' + i,
        className: "ng-shaft",
        style: {
          left: l + '%',
          top: '8%',
          width: w + '%',
          height: '92%',
          marginLeft: -w / 2 + '%',
          background: 'linear-gradient(180deg,rgba(212,244,250,.34),transparent 74%)',
          animationDuration: 19 + i * 6 + 's',
          animationDelay: -(i * 4) + 's'
        }
      })), /* waterline just under the hood */
      __lsh("span", {
        key: "waterline",
        style: {
          left: 0,
          right: 0,
          top: '11%',
          height: 4,
          background: 'repeating-linear-gradient(94deg,rgba(223,246,251,.6) 0 6px,rgba(127,198,216,.3) 6px 16px)',
          filter: 'blur(1px)'
        }
      }), /* back glass, hazed: the far plane of the tank */
      haze('hz-aq', 'rgba(18,83,107,.5)', '12%', '46%', 12), /* planting along the back wall, smaller and paler than the front planting */
      ...Array.from({
        length: 7
      }, (_, i) => __lsh("span", {
        key: 'pb' + i,
        className: "ng-kelp",
        style: {
          left: 6 + i * 14 + '%',
          bottom: '14%',
          width: 6 + i % 3 * 3,
          height: 26 + i % 4 * 12 + '%',
          borderRadius: '50% 50% 3px 3px',
          background: 'linear-gradient(180deg,#2d6f5c,#14443c)',
          opacity: .6,
          filter: 'blur(1px)',
          animationDuration: 13 + i % 4 * 4 + 's',
          animationDelay: -(i * 2.1) + 's'
        }
      })), /* an ornament: a piece of bogwood, mid-tank */
      __lsh("span", {
        key: "wood",
        className: "ng-tree",
        style: {
          left: '70%',
          bottom: '12%',
          width: 120,
          marginLeft: -60,
          height: '34%',
          background: 'linear-gradient(180deg,#4a3324,#2a1d14)',
          clipPath: 'polygon(40% 100%,34% 54%,10% 34%,26% 40%,40% 22%,48% 44%,66% 14%,58% 44%,80% 38%,60% 56%,62% 100%)'
        }
      }), /* front planting */
      ...Array.from({
        length: 6
      }, (_, i) => __lsh("span", {
        key: 'pf' + i,
        className: "ng-kelp",
        style: {
          left: 4 + i * 11 + '%',
          bottom: '8%',
          width: 9 + i % 3 * 5,
          height: 34 + i % 4 * 16 + '%',
          borderRadius: '50% 50% 4px 4px',
          background: 'linear-gradient(180deg,' + (i % 2 ? '#2f7a52' : '#3c8f5e') + ',#0f3d33)',
          opacity: .95,
          animationDuration: 9 + i % 5 * 3 + 's',
          animationDelay: -(i * 1.7) + 's'
        }
      })), /* gravel bed */
      __lsh("span", {
        key: "gravel",
        style: {
          left: 0,
          right: 0,
          bottom: 0,
          height: '13%',
          background: 'linear-gradient(180deg,#5b5344,#2e2a22)',
          borderRadius: '40% 46% 0 0 / 22% 26% 0 0'
        }
      }), __lsh("span", {
        key: "grain",
        style: {
          left: 0,
          right: 0,
          bottom: 0,
          height: '13%',
          opacity: .7,
          background: 'radial-gradient(rgba(233,226,204,.5) 0 34%, transparent 36%)',
          backgroundSize: '7px 5px'
        }
      }), /* the airstone column, off to one side where it always is */
      ...Array.from({
        length: 12
      }, (_, i) => __lsh("span", {
        key: 'ab' + i,
        className: "ng-steam",
        style: {
          left: 90 + i % 3 * 1.5 + '%',
          bottom: '10%',
          width: 4 + i % 4 * 3,
          height: 4 + i % 4 * 3,
          background: 'rgba(223,246,251,.55)',
          filter: 'blur(.8px)',
          animationDuration: 5 + i % 4 * 1.6 + 's',
          animationDelay: -(i * 0.55) + 's'
        }
      })),
      /* FISH, crossing the tank. Three depth bands: small and hazy at the back, large and sharp
         at the front, and the two directions alternate so the tank does not read as a conveyor. */
      ...fish.map(([band, top, len, colour, dir], i) => __lsh("span", {
        key: 'fish' + i,
        className: "ng-fish",
        style: {
          /* a PLACED position, spread across the tank: under prefers-reduced-motion the keyframe
             is suppressed and this is all that is left, so it has to read as a stocked tank */
          left: 8 + spread(i, 5) * 0.78 + '%',
          top: top + '%',
          width: len,
          height: len * 0.52,
          opacity: [0.5, 0.78, 0.96][band],
          filter: band === 0 ? 'blur(1.1px)' : undefined,
          transform: dir < 0 ? 'scaleX(-1)' : undefined,
          animationDuration: [46, 34, 25][band] + i % 4 * 4 + 's',
          animationDelay: -(i * 6) + 's',
          animationDirection: dir < 0 ? 'reverse' : 'normal'
        }
      }, __lsh("span", {
        style: {
          position: 'absolute',
          inset: 0,
          borderRadius: '50% 42% 50% 42%',
          background: colour
        }
      }), __lsh("span", {
        style: {
          position: 'absolute',
          right: '-26%',
          top: '18%',
          width: '34%',
          height: '64%',
          background: colour,
          opacity: .9,
          clipPath: 'polygon(0 50%, 100% 0, 100% 100%)'
        }
      }), __lsh("span", {
        style: {
          position: 'absolute',
          left: '22%',
          top: '22%',
          width: '16%',
          height: '30%',
          borderRadius: '50%',
          background: 'rgba(10,30,40,.65)'
        }
      }))),
      /* THE FRONT GLASS, over everything: two highlight streaks and the trim. Without this the
         scene is open water; with it you are standing in a room looking into a tank. */
      __lsh("span", {
        key: "glass",
        style: {
          inset: 0,
          opacity: .5,
          background: 'linear-gradient(104deg,transparent 12%,rgba(223,246,251,.22) 17%,transparent 22%,transparent 62%,rgba(223,246,251,.14) 67%,transparent 72%)'
        }
      }), __lsh("span", {
        key: "trimL",
        style: {
          left: 0,
          top: 0,
          bottom: 0,
          width: 5,
          background: 'linear-gradient(90deg,#0a1216,#1b2b33)'
        }
      }), __lsh("span", {
        key: "trimR",
        style: {
          right: 0,
          top: 0,
          bottom: 0,
          width: 5,
          background: 'linear-gradient(270deg,#0a1216,#1b2b33)'
        }
      }), __lsh("span", {
        key: "trimB",
        style: {
          left: 0,
          right: 0,
          bottom: 0,
          height: 6,
          background: 'linear-gradient(0deg,#0a1216,#1b2b33)'
        }
      }), vignette('transparent', 'rgba(4,16,24,.55)')];
    }
  },
  /* NIGHT — a hillside under stars, with an aurora. The quietest of the dark themes: nothing
     travels, everything breathes, and the only hard edges are the ridge silhouettes. */
  night: {
    label: 'Night',
    ground: 'linear-gradient(176deg,#080a14 0%,#111a33 34%,#1b2a4a 58%,#0d1424 82%,#060810 100%)',
    tokens: {
      '--ab-bg': '#070a12',
      '--ab-card': '#131a2a',
      '--ab-ink': '#e6ecf6',
      '--ab-line': '#5b6f8c',
      '--ab-lit': '#8fa9bd',
      '--ab-sym-yes': '#b4e0c0',
      '--ab-sym-no': '#e8bcc0',
      '--ab-sym-need': '#e8dca8',
      '--ab-sym-hot': '#e8b498',
      '--ab-sym-cold': '#b8dcee',
      '--ab-sym-love': '#dcb4dc',
      /* brightest thing crossing the band is the aurora at .72 -> 5.9:1 */
      '--ab-veil': 'rgba(7,10,18,.72)'
    },
    halo: 'dark',
    base: 'night',
    render: () => [...Array.from({
      length: 46
    }, (_, i) => {
      const band = i % 3;
      const sz = [1, 2, 3][band];
      return __lsh("span", {
        key: 'st' + i,
        className: "ng-dust",
        style: {
          left: spread(i, 3) + '%',
          top: spread(i, 11) * 0.62 + '%',
          width: sz,
          height: sz,
          background: '#eef3fb',
          opacity: [0.35, 0.6, 0.95][band],
          boxShadow: band === 2 ? '0 0 5px 1px rgba(238,243,251,.7)' : undefined,
          animationDuration: 5 + i % 7 * 2 + 's',
          animationDelay: -(i * 0.6) + 's',
          '--dy': '3px'
        }
      });
    }), ...[['#7fc6d8', 10, 34, 18], ['#8bd8a8', 42, 30, 26], ['#b3a8d9', 70, 28, 14]].map(([c, l, w, t], i) => __lsh("span", {
      key: 'au' + i,
      className: "ng-glow",
      style: {
        left: l + '%',
        top: t + '%',
        width: w + '%',
        height: '34%',
        background: c,
        opacity: .3,
        filter: 'blur(22px)',
        animationDuration: 15 + i * 6 + 's',
        animationDelay: -(i * 4) + 's'
      }
    })), __lsh("span", {
      key: "mw",
      style: {
        left: '-10%',
        right: '-10%',
        top: '6%',
        height: '40%',
        background: 'linear-gradient(74deg,transparent,rgba(180,200,240,.16) 40%,rgba(180,200,240,.07) 60%,transparent)',
        filter: 'blur(9px)'
      }
    }), __lsh("span", {
      key: "airglow",
      style: {
        left: '-8%',
        right: '-8%',
        bottom: '14%',
        height: '34%',
        background: 'linear-gradient(0deg,rgba(143,169,189,.55),rgba(91,111,140,.22) 46%,transparent)',
        filter: 'blur(10px)'
      }
    }), ...ridge({
      key: 'h1',
      left: '40%',
      bottom: '22%',
      width: 420,
      height: '28%',
      clip: 'polygon(0 100%,18% 46%,34% 64%,52% 30%,68% 58%,84% 42%,100% 100%)',
      fill: '#1d2740',
      rim: '#7591b0',
      blur: 1,
      opacity: .95
    }), haze('hz-ni', 'rgba(27,42,74,.6)', '44%', '26%', 10), ...ridge({
      key: 'h2',
      left: '55%',
      bottom: '10%',
      width: 480,
      height: '30%',
      clip: 'polygon(0 100%,14% 54%,30% 70%,46% 38%,62% 62%,78% 44%,100% 100%)',
      fill: '#121a2c',
      rim: '#52688a'
    }), ...ridge({
      key: 'h3',
      left: '30%',
      bottom: '-6%',
      width: 560,
      height: '30%',
      clip: 'polygon(0 100%,10% 60%,26% 74%,44% 46%,60% 68%,80% 52%,100% 100%)',
      fill: '#070c16',
      rim: '#33456280'
    }), ...Array.from({
      length: 11
    }, (_, i) => __lsh("span", {
      key: 'nt' + i,
      className: "ng-tree",
      style: {
        left: 4 + i * 9.4 + '%',
        bottom: '14%',
        height: 7 + i % 3 * 5 + '%',
        width: 10 + i % 3 * 5,
        marginLeft: -(5 + i % 3 * 2.5),
        background: '#0a1224'
      }
    })), vignette('transparent', 'rgba(2,3,8,.6)')]
  },
  /* COZY — the reference is a window seat sunk into a wall of shelves: shelves left and right
     running toward the viewer, a bright window straight ahead, cushions piled on the bench, a
     blanket in the foreground, a warm lamp low left, fairy lights. Renamed from `relaxed`.
   *
   * It re-declares the symbol accents DARK. The global --sym-* hexes were measured against a dark
   * card and run 1.91–3.35 on white, which is exactly why the source keeps the board dark; these
   * are darker forms of the same six hues, measured on #ffffff. */
  cozy: {
    label: 'Cozy',
    ground: 'linear-gradient(176deg,#e8e6dc 0%,#dedbcd 46%,#cfcbba 100%)',
    tokens: {
      '--ab-bg': '#f5f6f4',
      '--ab-card': '#ffffff',
      '--ab-ink': '#2f3a33',
      '--ab-line': '#6f8676',
      '--ab-lit': '#4d6730',
      '--ab-sym-yes': '#2c6e49',
      /* 5.28:1 on white */
      '--ab-sym-no': '#9e5449',
      /* 5.41 */
      '--ab-sym-need': '#8a5a12',
      /* 5.64 */
      '--ab-sym-hot': '#a0461b',
      /* 6.02 */
      '--ab-sym-cold': '#14636A',
      /* 5.60 */
      '--ab-sym-love': '#9c3357',
      /* 7.09 */
      /* DARK INK, so the binding backdrop is the DARKEST thing crossing the band — the #3b2f22
         shelf boards, not the lamp glow. .9 holds 5.1–5.3:1 across board, wall and highlight. */
      '--ab-veil': 'rgba(255,255,255,.9)'
    },
    halo: 'light',
    base: 'cozy',
    render: () => {
      const spines = ['#6f8676', '#ebc4b2', '#b7c4b4', '#f2e6c9', '#8a9c8a', '#d8a894', '#9aab98', '#c2b79a'];
      const out = [];
      /* --- back wall and the window in it: the brightest thing, straight ahead --- */
      out.push(__lsh("span", {
        key: "backwall",
        style: {
          left: '22%',
          right: '22%',
          top: 0,
          bottom: 0,
          background: 'linear-gradient(180deg,#d8d4c4,#c9c4b2)'
        }
      }), __lsh("span", {
        key: "winglow",
        className: "ng-glow",
        style: {
          left: '26%',
          top: '2%',
          width: '48%',
          height: '54%',
          background: 'rgba(242,230,201,.9)',
          animationDuration: '21s'
        }
      }), __lsh("span", {
        key: "window",
        className: "ng-win",
        style: {
          left: '30%',
          top: '8%',
          width: '40%',
          height: '40%',
          background: 'linear-gradient(170deg,#fffdf2,#eef0e2 58%,#dfe6d4)',
          boxShadow: '0 0 0 4px #b7c4b4, 0 0 30px 12px rgba(242,230,201,.8)'
        }
      }), /* garden showing through, hazed by the glass */
      __lsh("span", {
        key: "garden",
        style: {
          left: '30%',
          top: '30%',
          width: '40%',
          height: '18%',
          background: 'linear-gradient(180deg,rgba(111,134,118,.5),rgba(111,134,118,.16))',
          filter: 'blur(3px)'
        }
      }), __lsh("span", {
        key: "mullv",
        style: {
          left: '49.4%',
          top: '8%',
          width: 4,
          height: '40%',
          background: '#b7c4b4'
        }
      }), __lsh("span", {
        key: "mullh",
        style: {
          left: '30%',
          top: '27%',
          width: '40%',
          height: 4,
          background: '#b7c4b4'
        }
      }), /* curtain, one side, catching the light */
      __lsh("span", {
        key: "curtain",
        style: {
          left: '20%',
          top: 0,
          width: '11%',
          height: '64%',
          background: 'linear-gradient(90deg,rgba(242,230,201,.95),rgba(235,196,178,.55))',
          clipPath: 'polygon(0 0, 100% 0, 78% 100%, 0 100%)'
        }
      }));
      /* --- SHELF WALLS: left and right, leaning toward the viewer --- */
      [['L', 0, 'polygon(0 0, 100% 12%, 100% 88%, 0 100%)', 'linear-gradient(90deg,#4a3b2c,#6b5740)'], ['R', 1, 'polygon(100% 0, 0 12%, 0 88%, 100% 100%)', 'linear-gradient(270deg,#4a3b2c,#6b5740)']].forEach(([side, isR, clip, bg]) => {
        out.push(__lsh("span", {
          key: 'sw' + side,
          className: "ng-wall",
          style: {
            left: isR ? 'auto' : 0,
            right: isR ? 0 : 'auto',
            top: 0,
            bottom: 0,
            width: '24%',
            clipPath: clip,
            background: bg
          }
        }));
        /* three shelves per wall, converging; books smaller toward the back */
        [0.18, 0.44, 0.7].forEach((sy, r) => {
          out.push(__lsh("span", {
            key: `shelf${side}${r}`,
            style: {
              left: isR ? 'auto' : '1%',
              right: isR ? '1%' : 'auto',
              top: 14 + sy * 74 + '%',
              width: '22%',
              height: 4,
              background: '#3b2f22',
              transform: `rotate(${isR ? -7 : 7}deg)`,
              transformOrigin: isR ? 'right center' : 'left center'
            }
          }));
          for (let i = 0; i < 6; i += 1) {
            const d = i / 5; /* 0 = back of the shelf, 1 = front */
            const h = 7 + d * 7;
            const w = 4 + (i + r) % 3 * 2;
            out.push(__lsh("span", {
              key: `bk${side}${r}${i}`,
              className: "ng-book",
              style: {
                left: isR ? 'auto' : 2 + i * 3.4 + '%',
                right: isR ? 2 + i * 3.4 + '%' : 'auto',
                top: `calc(${14 + sy * 74}% - ${h}%)`,
                width: w,
                height: h + '%',
                background: spines[(i + r * 3 + (isR ? 2 : 0)) % spines.length],
                opacity: .6 + d * .35,
                transform: (i + r) % 5 === 0 ? `rotate(${isR ? -12 : 12}deg)` : 'none',
                transformOrigin: 'bottom center'
              }
            }));
          }
        });
      });
      /* --- the bench, cushions, and a blanket in the foreground --- */
      out.push(__lsh("span", {
        key: "bench",
        style: {
          left: '16%',
          right: '16%',
          bottom: '4%',
          height: '30%',
          borderRadius: '10px 10px 4px 4px',
          background: 'linear-gradient(180deg,#8f6a4a,#6b4e35)'
        }
      }), ...[[20, 16, 13, '#f2e6c9'], [33, 18, 15, '#ebc4b2'], [47, 17, 14, '#b7c4b4'], [60, 19, 15, '#f2e6c9'], [73, 16, 13, '#d8a894']].map(([l, w, h, c], i) => __lsh("span", {
        key: 'cu' + i,
        style: {
          left: l + '%',
          bottom: '22%',
          width: w + '%',
          height: h + '%',
          borderRadius: 9,
          background: c,
          opacity: .95,
          transform: `rotate(${(i % 2 ? 1 : -1) * (3 + i)}deg)`,
          boxShadow: '0 2px 6px rgba(74,59,44,.25)'
        }
      })), __lsh("span", {
        key: "blanket",
        style: {
          left: '10%',
          right: '10%',
          bottom: '-4%',
          height: '26%',
          borderRadius: '18px 26px 0 0',
          background: 'linear-gradient(180deg,#c9803f,#a4652f)',
          boxShadow: '0 -3px 10px rgba(74,59,44,.3)'
        }
      }), __lsh("span", {
        key: "book-open",
        style: {
          left: '44%',
          bottom: '14%',
          width: '16%',
          height: '9%',
          background: 'linear-gradient(90deg,#fffdf2 0 48%,#e8e2cf 49% 51%,#fffdf2 52%)',
          transform: 'rotate(-3deg)',
          borderRadius: 2,
          boxShadow: '0 2px 5px rgba(74,59,44,.3)'
        }
      }), __lsh("span", {
        key: "cup",
        style: {
          left: '66%',
          bottom: '25%',
          width: 14,
          height: 12,
          borderRadius: '3px 3px 5px 5px',
          background: '#f5f6f4',
          boxShadow: '0 2px 4px rgba(74,59,44,.3)'
        }
      }), ...[0, 1, 2].map(i => __lsh("span", {
        key: 'cs' + i,
        className: "ng-steam",
        style: {
          left: 66.5 + i * 0.6 + '%',
          bottom: '30%',
          width: 9 + i * 4,
          height: 9 + i * 4,
          background: 'rgba(245,246,244,.6)',
          animationDuration: 7 + i * 2 + 's',
          animationDelay: -(i * 2.2) + 's'
        }
      })), /* the lamp, low left — the one thing that breathes */
      __lsh("span", {
        key: "lampglow",
        className: "ng-glow",
        style: {
          left: '-6%',
          bottom: '18%',
          width: '30%',
          height: '34%',
          background: 'rgba(235,196,178,.85)',
          animationDuration: '17s'
        }
      }), __lsh("span", {
        key: "lampcore",
        style: {
          left: '2%',
          bottom: '30%',
          width: 26,
          height: 26,
          borderRadius: '50%',
          background: 'radial-gradient(circle closest-side,#fff6dc,#f2cf9a)',
          boxShadow: '0 0 22px 10px rgba(242,207,154,.55)'
        }
      }), /* fairy lights along the right shelf */
      ...Array.from({
        length: 9
      }, (_, i) => __lsh("span", {
        key: 'fl' + i,
        className: "ng-lit",
        style: {
          right: 3 + i % 5 * 4 + '%',
          top: 30 + i % 4 * 14 + '%',
          width: 5,
          height: 5,
          borderRadius: '50%',
          background: '#f2e6c9',
          boxShadow: '0 0 8px 3px rgba(242,230,201,.8)',
          animationDuration: 5 + i % 4 * 2 + 's',
          animationDelay: -(i * 1.2) + 's'
        }
      })), ...Array.from({
        length: 9
      }, (_, i) => __lsh("span", {
        key: 'd' + i,
        className: "ng-dust",
        style: {
          width: 4 + i % 3 * 2,
          height: 4 + i % 3 * 2,
          left: 28 + i % 6 * 8 + '%',
          top: 14 + spread(i, 2) * 0.4 + '%',
          background: 'rgba(242,230,201,.85)',
          animationDuration: 7 + i % 5 * 3 + 's',
          animationDelay: -(i * 1.3) + 's',
          '--dy': (i % 2 ? -1 : 1) * (12 + i * 3) + 'px'
        }
      })), vignette('transparent', 'rgba(74,59,44,.4)'));
      return out;
    }
  }
};

/* NO HELPER FUNCTIONS HERE ON PURPOSE. Only exports starting with a capital letter reach the
   bundle's namespace, so a lowercase `groundIconBase()` is documentable but not callable — read
   the plain data fields instead: `GROUND_THEMES[theme].base` for the icon set (with `|| 'color'`)
   and `.halo` for the halo direction. The card surface needs no lookup at all: ask for it in CSS
   with `background="veil"`. */

/* *** OVERLAYS: A SECOND CATEGORY, INDEPENDENT OF THE SCENE. ***
   A scene is a world; an overlay is one small inhabitant that can sit in ANY world. The cat began
   life baked into `nimrod` and the UFO into `night`; pulled out, either can visit fall, the
   aquarium, or a plain dark board. Same three rules as the scenes, and one more:
     4. AN OVERLAY IS NEVER THE ONLY PLACE ANYTHING HAPPENS. It marks nothing, reacts to nothing,
        and a person who never notices it has lost nothing. The rare ones (UFO) spend most of their
        loop off screen, because a rare event that is always visible is furniture. */
/* A rare crossing's delay and play state can be set from outside, so a showcase can freeze one
   mid-visit (--ng-rare-play: paused) instead of waiting for it. The number is the delay that puts
   the visit on screen; a real screen leaves both variables unset and gets the natural loop. */
const RARE = previewAt => ({
  animationDelay: 'var(--ng-rare-delay,0s)',
  animationPlayState: 'var(--ng-rare-play,running)',
  '--ng-rare-preview': previewAt + 's'
});

/**
 * *** LIVE WEATHER, AS AN OVERLAY. *** Maps a WMO weather code (what Open-Meteo returns) to one of
 * the weather overlays, or null for dry weather. Thunderstorms map to RAIN: lightning is a flash,
 * and nothing on these screens flashes.
 */
const WEATHER_CODES = {
  fog: [45, 48],
  snow: [71, 73, 75, 77, 85, 86],
  rain: [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99],
};
function weatherOverlay(code) {
  const c = Number(code);
  for (const [k, list] of Object.entries(WEATHER_CODES)) if (list.includes(c)) return k;
  return null;
}
const OVERLAYS = {
  cat: {
    label: 'Black cat',
    group: 'calm',
    note: 'Sits bottom right, blinks, flicks its tail. Drawn darker than a dark ground with a rim, so it reads on black.',
    render: () => {
      const cat = {
        clipPath: `polygon( 18% 0%, 26% 13%, 40% 2%, 46% 15%, 52% 25%, 50% 33%, 58% 41%, 70% 55%, 80% 73%, 86% 91%, 88% 100%, 34% 100%, 30% 99%, 26% 79%, 22% 57%, 16% 43%, 14% 31%, 14% 17% )`,
        position: 'absolute',
        inset: 0
      };
      return [/* the cat, in its own box so every part inside can be a percentage of the animal */
      __lsh("span", {
        key: "cat",
        style: {
          right: '7%',
          bottom: '7%',
          width: '31%',
          height: '62%'
        }
      }, __lsh("span", {
        className: "ng-tail",
        style: {
          position: 'absolute',
          left: '80%',
          bottom: '2%',
          width: '13%',
          height: '46%',
          borderRadius: '40% 40% 50% 50%',
          background: '#05070a',
          animationDuration: '6s',
          transform: 'rotate(-7deg)'
        }
      }), __lsh("span", {
        style: {
          ...cat,
          transform: 'translate(-2px,-2px)',
          background: 'linear-gradient(150deg,#46565e,#1b2429 62%)'
        }
      }), __lsh("span", {
        style: {
          ...cat,
          background: '#05070a'
        }
      }), __lsh("span", {
        className: "ng-eye",
        style: {
          position: 'absolute',
          left: '17%',
          top: '17%',
          width: '9%',
          height: '6%',
          background: '#8fae63',
          boxShadow: '0 0 6px 2px rgba(143,174,99,.5)',
          animationDelay: '-2s'
        }
      }), __lsh("span", {
        className: "ng-eye",
        style: {
          position: 'absolute',
          left: '33%',
          top: '15%',
          width: '9%',
          height: '6%',
          background: '#8fae63',
          boxShadow: '0 0 6px 2px rgba(143,174,99,.5)'
        }
      }))];
    }
  },
  ufo: {
    label: 'UFO',
    group: 'rare',
    note: 'Crosses the sky about once every 40 seconds and is off screen the rest of the time.',
    render: () => [
    /* A UFO, once in a while. It is scenery like everything else here — it marks nothing, and
       somebody who never looks up misses it, which is the point. */
    __lsh("span", {
      key: "ufo",
      className: "ng-ufo",
      style: {
        left: '-22%',
        top: '12%',
        width: 54,
        height: 22,
        opacity: 0,
        ...RARE(-32)
      }
    }, __lsh("span", {
      style: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 2,
        height: 9,
        borderRadius: '50%',
        background: 'linear-gradient(180deg,#9aa8c4,#3f4a63)',
        boxShadow: '0 0 10px 3px rgba(154,168,196,.35)'
      }
    }), __lsh("span", {
      style: {
        position: 'absolute',
        left: '32%',
        width: '36%',
        top: 0,
        height: 11,
        borderRadius: '50% 50% 0 0',
        background: 'radial-gradient(circle closest-side,#d8e4f4,#7f8db0)'
      }
    }), __lsh("span", {
      style: {
        position: 'absolute',
        left: '10%',
        right: '10%',
        bottom: 0,
        height: 4,
        borderRadius: 3,
        background: 'repeating-linear-gradient(90deg,#8bd8a8 0 3px,transparent 3px 9px)',
        animation: 'ngFlicker 1.6s steps(1,end) infinite'
      }
    }), __lsh("span", {
      style: {
        position: 'absolute',
        left: '34%',
        top: '100%',
        width: '32%',
        height: 34,
        background: 'linear-gradient(180deg,rgba(139,216,168,.45),transparent)',
        clipPath: 'polygon(30% 0,70% 0,100% 100%,0 100%)',
        filter: 'blur(2px)'
      }
    }))]
  },
  /* *** WEATHER. *** Five overlays that sit over any scene, so winter can have leaves and fall can
     have snow. Each is also what a LIVE WEATHER feed resolves to: see weatherOverlay() below. */
  rain: {
    label: 'Rain',
    group: 'weather',
    note: 'Soft vertical streaks in three depth bands. No lightning, ever: a flash is a flash.',
    render: () => Array.from({
      length: 34
    }, (_, i) => {
      const band = i % 3;
      return __lsh("span", {
        key: 'rn' + i,
        className: "ng-rain",
        style: {
          left: spread(i, 4) + '%',
          top: spread(i, 8) + '%',
          width: [1, 1.5, 2][band],
          height: [12, 18, 26][band],
          background: 'linear-gradient(180deg,transparent,rgba(210,225,240,' + [0.35, 0.5, 0.7][band] + '))',
          animationDuration: [1.9, 1.4, 1.05][band] + i % 4 * 0.15 + 's',
          animationDelay: -(i * 0.21) + 's'
        }
      });
    })
  },
  snow: {
    label: 'Snow',
    group: 'weather',
    note: 'Slow flakes in three depth bands, larger and sharper near the front.',
    render: () => Array.from({
      length: 28
    }, (_, i) => {
      const band = i % 3;
      return __lsh("span", {
        key: 'sf' + i,
        className: "ng-seed",
        style: {
          width: [2, 3, 5][band],
          height: [2, 3, 5][band],
          borderRadius: '50%',
          left: spread(i, 6) + '%',
          top: spread(i, 3) + '%',
          background: '#f4f8fa',
          opacity: [0.5, 0.75, 0.95][band],
          '--sway': (i % 2 ? 1 : -1) * (10 + i % 5 * 9) + 'px',
          '--spin': '90deg',
          animationDuration: [19, 14, 10][band] + i % 4 * 2 + 's',
          animationDelay: -(i * 0.9) + 's'
        }
      });
    })
  },
  leaves: {
    label: 'Falling leaves',
    group: 'weather',
    note: 'A few leaves turning as they fall, all the way to the bottom.',
    render: () => Array.from({
      length: 12
    }, (_, i) => __lsh("span", {
      key: 'lv' + i,
      className: "ng-leaf",
      style: {
        left: spread(i, 5) + '%',
        top: spread(i, 2) + '%',
        width: 9 + i % 3 * 3,
        height: 6 + i % 3 * 2,
        borderRadius: '0 80% 0 80%',
        background: ['#c96a21', '#d99a3f', '#a8471c', '#b8a05a'][i % 4],
        '--sway': (i % 2 ? 1 : -1) * (24 + i % 4 * 12) + 'px',
        '--s': 0.8 + i % 3 * 0.2,
        animationDuration: 13 + i % 5 * 3 + 's',
        animationDelay: -(i * 1.6) + 's'
      }
    }))
  },
  petals: {
    label: 'Blossom',
    group: 'weather',
    note: 'Pale petals drifting down. The spring counterpart to falling leaves.',
    render: () => Array.from({
      length: 16
    }, (_, i) => __lsh("span", {
      key: 'pt' + i,
      className: "ng-leaf",
      style: {
        left: spread(i, 7) + '%',
        top: spread(i, 4) + '%',
        width: 7 + i % 3 * 2,
        height: 5 + i % 2 * 2,
        borderRadius: '70% 0 70% 0',
        background: ['#f6d7de', '#efc0cc', '#fbe8ec'][i % 3],
        opacity: 0.9,
        '--sway': (i % 2 ? 1 : -1) * (30 + i % 4 * 10) + 'px',
        '--spin': '300deg',
        animationDuration: 15 + i % 5 * 3 + 's',
        animationDelay: -(i * 1.3) + 's'
      }
    }))
  },
  fog: {
    label: 'Fog',
    group: 'weather',
    note: 'Two slow banks of mist, one high and one low.',
    render: () => [__lsh("span", {
      key: "fg1",
      className: "ng-mist",
      style: {
        top: '22%',
        height: '30%',
        background: 'rgba(214,222,226,.34)',
        animationDuration: '44s'
      }
    }), __lsh("span", {
      key: "fg2",
      className: "ng-mist",
      style: {
        top: '58%',
        height: '34%',
        background: 'rgba(214,222,226,.42)',
        animationDuration: '57s',
        animationDelay: '-20s'
      }
    })]
  },
  /* *** THE CALM ONES. *** Sit there and breathe. */
  fireflies: {
    label: 'Fireflies',
    group: 'calm',
    note: 'A few soft lights that drift and pulse. Best on the dark scenes.',
    render: () => Array.from({
      length: 10
    }, (_, i) => __lsh("span", {
      key: 'ff' + i,
      className: "ng-dust",
      style: {
        left: spread(i, 9) + '%',
        top: 30 + spread(i, 5) * 0.6 + '%',
        width: 5,
        height: 5,
        '--dy': (i % 2 ? -1 : 1) * (14 + i * 3) + 'px',
        animationDuration: 7 + i % 4 * 3 + 's',
        animationDelay: -(i * 1.7) + 's'
      }
    }, __lsh("span", {
      className: "ng-pulse",
      style: {
        position: 'absolute',
        inset: 0,
        background: '#efe7a0',
        boxShadow: '0 0 8px 3px rgba(239,231,160,.65)',
        animationDuration: 2.4 + i % 4 * 0.9 + 's',
        animationDelay: -(i * 0.7) + 's'
      }
    })))
  },
  dog: {
    label: 'Sleeping dog',
    group: 'calm',
    note: 'Curled up bottom left, breathing slowly. The cat’s companion.',
    render: () => [__lsh("span", {
      key: "dog",
      style: {
        left: '5%',
        bottom: '5%',
        width: '30%',
        height: '26%'
      }
    }, __lsh("span", {
      style: {
        position: 'absolute',
        left: '8%',
        bottom: '2%',
        width: '62%',
        height: '26%',
        borderRadius: '50%',
        background: '#4f3524',
        transform: 'rotate(-4deg)'
      }
    }), __lsh("span", {
      className: "ng-breath",
      style: {
        position: 'absolute',
        left: '14%',
        right: 0,
        bottom: '8%',
        height: '80%',
        borderRadius: '52% 48% 40% 44% / 64% 60% 40% 36%',
        background: 'radial-gradient(120% 90% at 40% 20%,#8a6246,#5e412c 70%)',
        boxShadow: '0 -1px 0 rgba(255,236,210,.18) inset'
      }
    }), __lsh("span", {
      style: {
        position: 'absolute',
        left: 0,
        bottom: '6%',
        width: '38%',
        height: '54%',
        borderRadius: '50% 46% 44% 50% / 58% 56% 44% 42%',
        background: 'radial-gradient(90% 90% at 40% 30%,#93694b,#664730 72%)'
      }
    }), __lsh("span", {
      style: {
        position: 'absolute',
        left: '17%',
        bottom: '38%',
        width: '16%',
        height: '30%',
        borderRadius: '30% 70% 60% 40%',
        background: '#3f2a1c',
        transform: 'rotate(18deg)'
      }
    }), __lsh("span", {
      style: {
        position: 'absolute',
        left: '9%',
        bottom: '32%',
        width: '8%',
        height: 2,
        borderRadius: 2,
        background: '#2a1c12'
      }
    }), __lsh("span", {
      style: {
        position: 'absolute',
        left: '-1%',
        bottom: '22%',
        width: '6%',
        height: '9%',
        borderRadius: '50%',
        background: '#2a1c12'
      }
    }))]
  },
  moon: {
    label: 'Moon (tonight’s phase)',
    group: 'calm',
    note: 'Shows the moon as it really is tonight, so somebody who has lost track of days can watch time pass.',
    render: () => {
      /* THE REAL PHASE. Days since a known new moon (2000-01-06 18:14 UTC) over the synodic month.
         p=0 new, .25 first quarter, .5 full, .75 last quarter. Northern-hemisphere orientation:
         waxing is lit on the right. Drawn with no SVG and no knowledge of the sky behind it: the
         dark side is the moon's own earthshine grey, so it reads on any scene. */
      const p = ((Date.now() - Date.UTC(2000, 0, 6, 18, 14)) / 864e5 / 29.530588853 % 1 + 1) % 1;
      const waxing = p < 0.5;
      const gibbous = Math.abs(p - 0.5) < 0.25;
      const ellW = Math.abs(Math.cos(2 * Math.PI * p)) * 100;
      const LIT = '#eef0e6',
        DARK = 'rgba(56,64,82,.92)';
      return [__lsh("span", {
        key: "mglow",
        className: "ng-glow",
        style: {
          right: '8%',
          top: '4%',
          width: 110,
          height: 110,
          marginRight: -24,
          marginTop: -24,
          background: 'rgba(238,240,230,' + (0.12 + 0.3 * (1 - Math.abs(Math.cos(Math.PI * p)))) + ')',
          animationDuration: '19s'
        }
      }), __lsh("span", {
        key: "moon",
        style: {
          right: '8%',
          top: '4%',
          width: 62,
          height: 62,
          borderRadius: '50%',
          overflow: 'hidden',
          background: DARK
        }
      }, __lsh("span", {
        style: {
          position: 'absolute',
          top: 0,
          bottom: 0,
          width: '50%',
          [waxing ? 'right' : 'left']: 0,
          background: LIT
        }
      }), __lsh("span", {
        style: {
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: (100 - ellW) / 2 + '%',
          width: ellW + '%',
          borderRadius: '50%',
          background: gibbous ? LIT : DARK
        }
      }), __lsh("span", {
        style: {
          position: 'absolute',
          inset: 0,
          borderRadius: '50%',
          background: 'radial-gradient(circle at 36% 38%,rgba(0,0,0,.06) 0 9%,transparent 10%),radial-gradient(circle at 62% 64%,rgba(0,0,0,.07) 0 12%,transparent 13%)'
        }
      }))];
    }
  },
  /* *** THE RARE ONES. *** Off screen most of the loop, and absent entirely with motion off. */
  balloon: {
    label: 'Hot-air balloon',
    group: 'rare',
    note: 'Drifts across about once every two and a half minutes.',
    render: () => [__lsh("span", {
      key: "bal",
      className: "ng-balloon",
      style: {
        left: '-16%',
        top: '30%',
        width: 34,
        height: 52,
        opacity: 0,
        ...RARE(-120)
      }
    }, __lsh("span", {
      style: {
        position: 'absolute',
        left: 0,
        right: 0,
        top: 0,
        height: '72%',
        borderRadius: '50% 50% 44% 44% / 58% 58% 42% 42%',
        background: 'linear-gradient(90deg,#c96a21 0 20%,#e8d6a0 20% 40%,#9e5449 40% 60%,#e8d6a0 60% 80%,#c96a21 80%)'
      }
    }), __lsh("span", {
      style: {
        position: 'absolute',
        left: '30%',
        right: '30%',
        top: '70%',
        height: '14%',
        borderLeft: '1px solid rgba(40,30,20,.6)',
        borderRight: '1px solid rgba(40,30,20,.6)'
      }
    }), __lsh("span", {
      style: {
        position: 'absolute',
        left: '36%',
        right: '36%',
        bottom: 0,
        height: '14%',
        borderRadius: 2,
        background: '#5e412c'
      }
    }))]
  },
  shootingStar: {
    label: 'Shooting star',
    group: 'rare',
    note: 'About once a minute, for under a second. Best on night.',
    render: () => [__lsh("span", {
      key: "shoot",
      className: "ng-shoot",
      style: {
        left: '22%',
        top: '14%',
        width: 70,
        height: 2,
        borderRadius: 2,
        opacity: 0,
        transformOrigin: 'right center',
        background: 'linear-gradient(90deg,transparent,rgba(238,243,251,.95))',
        ...RARE(-68.8)
      }
    })]
  },
  boat: {
    label: 'Paper boat',
    group: 'rare',
    note: 'Floats slowly along the bottom. Best on the aquarium or any water.',
    render: () => [__lsh("span", {
      key: "boat",
      className: "ng-fish",
      style: {
        left: '-16%',
        bottom: '9%',
        width: 40,
        height: 28,
        animationDuration: '96s',
        animationDelay: '-30s'
      }
    }, __lsh("span", {
      className: "ng-dust",
      style: {
        position: 'absolute',
        inset: 0,
        '--dy': '-3px',
        animationDuration: '3.4s'
      }
    }, __lsh("span", {
      style: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        height: '38%',
        background: '#f0ece0',
        clipPath: 'polygon(0 0,100% 0,82% 100%,18% 100%)'
      }
    }), __lsh("span", {
      style: {
        position: 'absolute',
        left: '28%',
        width: '44%',
        bottom: '36%',
        height: '64%',
        background: '#e2ddcc',
        clipPath: 'polygon(50% 0,100% 100%,0 100%)'
      }
    })))]
  },
  butterfly: {
    label: 'Butterfly',
    group: 'rare',
    note: 'Flutters in, rests for a while, and leaves. Best on the light scenes.',
    render: () => [__lsh("span", {
      key: "bfly",
      className: "ng-butterfly",
      style: {
        left: '-10%',
        top: '18%',
        width: 24,
        height: 18,
        opacity: 0,
        '--rest-x': '66%',
        '--rest-y': '54%',
        ...RARE(-14)
      }
    }, __lsh("span", {
      className: "ng-wing",
      style: {
        position: 'absolute',
        right: '50%',
        top: 0,
        width: '46%',
        height: '100%',
        borderRadius: '60% 20% 40% 70%',
        background: 'linear-gradient(160deg,#e8b394,#cf6f86)'
      }
    }), __lsh("span", {
      className: "ng-wing",
      style: {
        position: 'absolute',
        left: '50%',
        top: 0,
        width: '46%',
        height: '100%',
        borderRadius: '20% 60% 70% 40%',
        background: 'linear-gradient(200deg,#e8b394,#cf6f86)',
        transformOrigin: 'left center'
      }
    }), __lsh("span", {
      style: {
        position: 'absolute',
        left: '46%',
        width: '8%',
        top: '10%',
        bottom: '10%',
        borderRadius: 3,
        background: '#3a2c1d'
      }
    }))]
  }
};

// ---------------------------------------------------------------------------------------------
// PUBLIC API
// ---------------------------------------------------------------------------------------------

// Exported as SCENES / SCENE_OVERLAYS rather than the design system's GROUND_THEMES / OVERLAYS, so
// the repo's names describe what they are here and cannot collide with the design system's own.
export const SCENES = GROUND_THEMES;
export const SCENE_OVERLAYS = OVERLAYS;
// Renamed on export for the same reason: the design system exports its own `weatherOverlay`.
export const overlayForWeatherCode = weatherOverlay;

/** [{value,label}] for a settings `choice`, in the order Design presents them. */
export function listScenes() {
  return Object.entries(SCENES).map(([id, s]) => ({ value: id, label: s.label }));
}
export function listOverlays() {
  return Object.entries(OVERLAYS).map(([id, o]) => ({ value: id, label: o.label, group: o.group, note: o.note }));
}

// The motion ladder, same words and same rule as wallpaper.js.
export const MOTIONS = ['gentle', 'calm', 'still'];
function motionOf(saved, systemReduced) {
  const m = MOTIONS.includes(saved) ? saved : 'gentle';
  return systemReduced ? 'still' : m;
}
// 'calm' is gentle slowed down — every layer's own duration stretched by the same factor, so the
// relationships Design tuned (far things slower than near things) are kept.
const CALM_STRETCH = 1.8;

/* *** SPEED AND FREQUENCY, PER OVERLAY. *** An overlay entry is a key, or { id, speed, every }:
     speed  multiplies how fast it moves (0.5 half, 2 double). Clamped .25–3: past 3 the fastest
            movers approach the flash-rate check; below .25 nothing visibly moves.
     every  seconds between visits, RARE overlays only (ufo, balloon, shootingStar, butterfly).
            Clamped 20–900. The visit stays the same share of the loop.
   Both optional; the defaults are what Design tuned. Any number of overlays can be combined.
   Settings shape for Code: one toggle per overlay plus two choices beside it —
     "How fast"  slower (.5) | as designed (1) | faster (1.5)
     "How often" (rare only)  now and then (default) | every few minutes (180) | rarely (600) */
function overlaySpec(entry) {
  const o = typeof entry === 'string' ? { id: entry } : (entry || {});
  const speed = Number.isFinite(+o.speed) ? Math.min(3, Math.max(0.25, +o.speed)) : 1;
  const every = Number.isFinite(+o.every) ? Math.min(900, Math.max(20, +o.every)) : null;
  return { id: o.id, speed, every };
}
function retime(root, speed, every) {
  if (speed === 1 && !every) return;
  for (const el of root.querySelectorAll('[style]')) {
    const rare = every && /\bng-(ufo|balloon|shoot|butterfly)\b/.test(el.className || '');
    if (rare) { el.style.animationDuration = every + 's'; continue; }
    const d = parseFloat(el.style.animationDuration);
    if (Number.isFinite(d) && d > 0) el.style.animationDuration = (d / speed) + 's';
  }
}

const MOTION_CSS = `
.ls{position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:var(--z-world,0)}
.ls .ng{position:absolute;inset:0}
.ls.ls-still .ng, .ls.ls-still .ng *{animation-play-state:paused !important}
`;

function injectCss(doc) {
  if (doc.getElementById('livescene-css')) return;
  const el = doc.createElement('style');
  el.id = 'livescene-css';
  el.textContent = CSS + MOTION_CSS;
  doc.head.append(el);
}

/**
 * Mount a scene (plus overlays) into `host`. The host should be positioned; the scene fills it.
 *
 *   const s = mountScene(el, { scene: 'fall', overlays: ['cat'], motion: 'gentle' });
 *   s.set({ overlays: [] });   // any subset of options
 *   s.destroy();
 *
 * `tokens` is the scene's board token set (--ab-*), for a host that wants to apply it.
 */
export function mountScene(host, { scene = 'nimrod', overlays = [], motion = 'gentle' } = {}) {
  const doc = host.ownerDocument || document;
  injectCss(doc);
  const root = doc.createElement('div');
  root.className = 'ls';
  root.setAttribute('aria-hidden', 'true');
  host.prepend(root);

  const mq = doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)');
  let systemReduced = !!mq?.matches;
  let cfg = { scene, overlays: [].concat(overlays || []), motion };

  function render() {
    const s = SCENES[cfg.scene] || SCENES.nimrod;
    const m = motionOf(cfg.motion, systemReduced);
    root.style.background = s.ground;
    root.classList.toggle('ls-still', m === 'still');
    root.dataset.scene = cfg.scene;
    const ng = __lsh('div', { className: 'ng' }, s.render());
    for (const entry of cfg.overlays) {
      const { id, speed, every } = overlaySpec(entry);
      if (!OVERLAYS[id]) continue;
      const box = __lsh('div', null, OVERLAYS[id].render());
      retime(box, speed, every);
      // Moved out of the temporary box, not left in a wrapper: the scene CSS positions `.ng > *`,
      // and a wrapper element would take every overlay out of that rule.
      ng.append(...box.childNodes);
    }
    if (m === 'calm') {
      for (const el of ng.querySelectorAll('[style]')) {
        const d = parseFloat(el.style.animationDuration);
        if (Number.isFinite(d) && d > 0) el.style.animationDuration = (d * CALM_STRETCH) + 's';
      }
    }
    root.replaceChildren(ng);
  }
  const onMq = (e) => { systemReduced = e.matches; render(); };
  mq?.addEventListener?.('change', onMq);
  render();

  return {
    get tokens() { return { ...((SCENES[cfg.scene] || SCENES.nimrod).tokens) }; },
    get halo() { return (SCENES[cfg.scene] || SCENES.nimrod).halo; },
    set(next = {}) {
      cfg = { ...cfg, ...next, overlays: [].concat(next.overlays ?? cfg.overlays) };
      render();
    },
    destroy() {
      mq?.removeEventListener?.('change', onMq);
      root.remove();
    },
  };
}

// ---------------------------------------------------------------------------------------------
// THEME HOOK — one call site in theme.js, so no page has to remember anything.
// ---------------------------------------------------------------------------------------------
//
// `applyTheme(rootEl, id)` calls `syncScene(rootEl, theme)` last. A theme with a `scene` field
// brings its scene along; a theme without one removes any scene a previous theme left behind —
// the same "switching always fully overwrites" rule theme.js already keeps for its variables.
//
// WHERE A SCENE MOUNTS, AND WHY IT IS OPT-IN PER ELEMENT: theme_test.html applies themes to
// scratch boxes, and a scene appearing in every scratch box would be noise at best. So:
//   * rootEl === document.documentElement -> a fixed layer at the back of the page
//   * rootEl has [data-scene-host]        -> a layer inside that element (a panel, a module)
//   * anything else                       -> variables only, exactly as today
const hosts = new WeakMap();

export function syncScene(rootEl, theme, { motion } = {}) {
  if (!rootEl) return;
  const doc = rootEl.ownerDocument || document;
  const isPage = rootEl === doc.documentElement;
  if (!isPage && !rootEl.hasAttribute?.('data-scene-host')) return;
  const host = isPage ? doc.body : rootEl;
  if (!host) return;
  const want = theme?.scene || null;
  const had = hosts.get(host);
  if (!want) {
    had?.destroy();
    hosts.delete(host);
    if (isPage) doc.documentElement.removeAttribute('data-live-scene');
    return;
  }
  const opts = { scene: want, overlays: theme.overlays || [], ...(motion ? { motion } : {}) };
  if (had) had.set(opts);
  else {
    const s = mountScene(host, opts);
    // Pinned to the viewport at the very back of the page, behind every panel.
    if (isPage) Object.assign(host.firstElementChild.style, { position: 'fixed', zIndex: '-1' });
    hosts.set(host, s);
  }
  // The page-level scene only shows where nothing opaque paints over it; this attribute is the
  // hook a page's CSS uses to stop painting --bg on the body while a live theme is on.
  if (isPage) doc.documentElement.setAttribute('data-live-scene', want);
}
