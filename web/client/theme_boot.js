// theme_boot.js — THIS PAGE'S LAST LOOK, PAINTED BEFORE ANYTHING ELSE IS (row 2.164, 2026-10-31).
//
// Mike, 2026-10-31: "The site always loads through all of your previous themes before landing on the current one
// when loading a page." Measured the same day (dev/theme_boot_test.html, and a hook on the page's own <html> from its
// first byte): a page's first paint was its stylesheet's defaults (the Nimrod light colours, or the kiosk's bare dark
// frame), then each layer that knows something about the theme painted it as it arrived -- on Home: this browser's
// stored theme, the screen's row, the same row again, then the showing dashboard's own (Nimrod light, Warm, Halloween
// in 0.2 s); on a screen: the screen's row as this device last saw it, the server's answer, then the person's row
// (Warm, Halloween, High contrast in 0.3 s). Three looks a load, light-dark-light, is three flashes for anyone the
// photosensitivity setting is there for.
//
// The fix has two halves. THIS FILE is the first: a CLASSIC script in the <head> (not a module: a module runs after
// the whole page is parsed and its imports fetched, which is long after the first paint), so it runs before the body
// is drawn and paints the look this page last settled on, on this device -- the exact properties theme.js `applyTheme`
// wrote (theme.js `PAINT_KEY`, saved by every paint of the page's <html>). The second half is theme.js
// `holdPageTheme` and the kiosk's theme gate: while a page is still finding out its theme, nothing new is painted,
// and the answer is painted once.
//
// `data-theme-page` on the script tag names WHICH look: pages that settle on the same theme share one name, so a look
// learned on one is right on the others ("stored": the per-browser choice; "profile": the signed-in default screen's;
// "home", "library", "kiosk" their own). A page this device has never shown under that name gets the look last
// painted on ANY page of this device ("*"): one later change at most, never the stylesheet's default first.
// A page without the attribute paints nothing and saves nothing. `data-theme-by` names words of the address that make
// it a different look (kiosk.html: the landing page's sample screen `?demo=1`, and `?profile=`).
//
// `<html data-theme-boot>` says what was painted ("page": this page's own look, "site": the device's last on any page;
// absent: none, so the stylesheet's defaults are showing). theme.js `pageLookPainted` reads it.
(function () {
  var script = document.currentScript;
  var page = script && script.getAttribute('data-theme-page');
  var root = document.documentElement;
  if (!page || !root) return;
  // `data-theme-by`: the address's own words that make it a different look (kiosk.html: `demo`, the landing page's
  // sample screen, must not become a real screen's saved look; `profile`, two screens opened on one device).
  var by = (script.getAttribute('data-theme-by') || '').split(/\s+/);
  try {
    var q = new URLSearchParams(location.search);
    for (var i = 0; i < by.length; i++) if (by[i] && q.get(by[i])) page += '?' + by[i] + '=' + q.get(by[i]);
  } catch (e) { /* no URLSearchParams: the page's plain name */ }
  root.setAttribute('data-theme-page', page);
  var PREFIX = 'nimrod:paint:';   // theme.js PAINT_KEY - the two must agree (dev/theme_boot_test.html checks it)
  function read(key) {
    try {
      var v = JSON.parse(window.localStorage.getItem(PREFIX + key) || 'null');
      return v && v.v === 1 && v.props && typeof v.props === 'object' ? v : null;
    } catch (e) { return null; }   // private mode, blocked storage, a damaged entry: the stylesheet's defaults stand
  }
  var own = read(page);
  var look = own || read('*');
  if (!look) return;
  for (var k in look.props) {
    if (!Object.prototype.hasOwnProperty.call(look.props, k) || k.indexOf('--') !== 0 && k !== 'color-scheme') continue;
    try { root.style.setProperty(k, String(look.props[k])); } catch (e) { /* one bad value never stops the rest */ }
  }
  root.setAttribute('data-theme-boot', own ? 'page' : 'site');
})();
