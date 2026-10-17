// modules/page_parts.js - THE HOME PAGE'S PARTS, EACH A MODULE OF ITS OWN. Row 2.102, Mike 2026-10-17: "The different
// panels on the page like messages and your people should be modules."
//
// The page ("Your people", modules/people.js) is a list of sections - You, Messages for you, Recommended for you, Your
// people, Connect with someone - that "Edit my page" adds, removes and moves. Each of those is now ALSO a module that
// can be placed anywhere a module can (a dashboard, a room, beside the clock).
//
// ONE RENDERER, NOT A COPY OF IT. Each part mounts the same page module with `ctx.pagePart` set to its section's kind,
// and the page draws only that part (people.js `shownSections`). So a part on a dashboard reads the same messages,
// cards and buttons as the page, through the same code, and the two cannot drift. FOR this over five new modules:
// every rule the page already follows - who may be called, the reasons a button is dimmed, the switch walk, the
// theme - holds for the part with no second copy to keep in step. AGAINST: each part loads the whole page module (one
// file, already loaded wherever the page is). A part shows no "Edit my page": the whole page is where it is edited.
//
// Left out: "Ask Nimrod", which is the `helper` module already; and the boxes a page can hold (clock, pictures, a
// video), which are modules already.
//
// NAMES. Each part's title is the section's own name on the page, except "Your people", which is the name of the
// whole landing page everywhere (dashboards.js, the bar, the Modules library): the cards alone are "Your people's
// cards". A guess for Mike, on his list.

import { registerModule, mountModule, extendCtx } from '../module.js';
import { PEOPLE_TYPE } from '../people_page.js';
import './people.js';   // registers the page these parts are drawn by

export const PAGE_PARTS = Object.freeze([
  Object.freeze({ type: 'page_you', kind: 'self', title: 'You, on your page',
    description: 'Your picture and your name, with the way to change them, as on your page.' }),
  Object.freeze({ type: 'page_messages', kind: 'messages', title: 'Messages for you',
    description: 'The newest messages left for you, as on your page.' }),
  Object.freeze({ type: 'page_recommended', kind: 'recommended', title: 'Recommended for you',
    description: 'Songs and videos your people sent you, as on your page.' }),
  Object.freeze({ type: 'page_people', kind: 'people', title: 'Your people’s cards',
    description: 'A card for each of your people, with big buttons to call them or leave them a message.' }),
  Object.freeze({ type: 'page_connect', kind: 'connect', title: 'Connect with someone',
    description: 'How to invite someone to use this with you, as on your page.' }),
]);

/** A part's module: the page, drawing only `kind`. Everything the page answers is passed through. */
function partFactory(kind) {
  return (ctx) => {
    let child = null;
    const impl = () => child?.impl || child || null;
    const call = (name, ...a) => { try { return impl()?.[name]?.(...a); } catch (err) { console.error(`page part ${kind}: ${name}`, err); return undefined; } };
    return {
      init() {
        child = mountModule(PEOPLE_TYPE, extendCtx(ctx, { pagePart: kind }));
        return child.init();
      },
      onResize: () => call('onResize'),
      onShow: () => call('onShow'),
      onHide: () => call('onHide'),
      menuItems: (o) => call('menuItems', o),
      settingsChoices: () => call('settingsChoices'),
      settingsWrite: (k, v) => call('settingsWrite', k, v),
      __probe: () => call('__probe'),
      destroy() { try { child?.destroy?.(); } catch (err) { console.error(`page part ${kind}: destroy`, err); } child = null; },
    };
  };
}

for (const p of PAGE_PARTS) {
  registerModule(
    { type: p.type, title: p.title, core: 'new', dependsOn: 'server', importance: 'optional', description: p.description,
      settings: [] },
    partFactory(p.kind),
  );
}
