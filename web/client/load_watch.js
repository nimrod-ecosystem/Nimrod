// load_watch.js - WHEN SOMETHING THE PAGE NEEDS COULD NOT LOAD, SAY SO (row 2.148, chat's note DG, 2026-10-28).
//
// Mike: "ad blockers have broken Nimrod before - Can we fix Nimrod so this doesn't happen?" When a blocker refuses one
// file of a page's module code, NONE of that page's code runs: no error on screen, a page that just sits there (the
// bench Pi's "Starting Nimrod..." with hitbox.js). And when it refuses an outside script (YouTube's player, Spotify's),
// the panel that needed it just stays empty. The browser does tell the page: the <script> that failed gets an `error`
// event. This file, an ORDINARY script loaded before everything else, so it runs even when the module code cannot,
// listens for those and says what happened in plain words.
//
// NOT A GATE (CLAUDE.md): a line along the bottom of the page, over nothing that matters, with a Close. Nothing waits
// on it. Its words are site copy: they name nobody.
//
// Its own name is checked like every other site file (web/tools/check_blocked_names.py), so a blocker does not refuse
// the very file that would explain the others.
(function () {
  if (typeof window === 'undefined' || window.__nimrodLoadWatch) return;
  var state = { own: false, outside: {} };
  window.__nimrodLoadWatch = state;

  // What each outside host's script is for, so the line says what stopped working.
  var WHAT = {
    'www.youtube.com': 'YouTube videos', 'www.youtube-nocookie.com': 'YouTube videos', 's.ytimg.com': 'YouTube videos',
    'sdk.scdn.co': 'Spotify', 'api.spotify.com': 'Spotify'
  };
  var BLOCKER = ' If this browser or your network blocks ads, allowing this site may fix it.';

  function words() {
    if (state.own) {
      return 'Part of this page could not load, so some of it may not work.' + BLOCKER;
    }
    var hosts = Object.keys(state.outside);
    if (!hosts.length) return '';
    var what = [];
    for (var i = 0; i < hosts.length; i++) {
      var w = WHAT[hosts[i]] || hosts[i];
      if (what.indexOf(w) < 0) what.push(w);
    }
    return what.join(' and ') + ' could not load here, so ' + (what.length > 1 ? 'they' : 'it')
      + ' may not play.' + ' If this browser or your network blocks ads, allowing ' + hosts.join(' and ') + ' may fix it.';
  }

  var bar = null;
  function show() {
    var text = words();
    if (!text || !document.body) return;
    if (!bar) {
      bar = document.createElement('div');
      bar.setAttribute('data-load-watch', '');
      bar.setAttribute('role', 'status');
      bar.style.cssText = 'position:fixed;left:8px;right:8px;bottom:8px;z-index:2147483000;display:flex;gap:10px;'
        + 'align-items:center;padding:10px 14px;border-radius:10px;font:15px/1.4 system-ui,sans-serif;'
        + 'background:var(--surface,#fff);color:var(--text,#222);border:2px solid var(--accent,#2b6cb0);'
        + 'box-shadow:0 4px 16px rgba(0,0,0,.3)';
      var p = document.createElement('span');
      p.setAttribute('data-load-watch-text', '');
      p.style.flex = '1';
      var close = document.createElement('button');
      close.type = 'button';
      close.textContent = 'Close';
      close.setAttribute('data-load-watch-close', '');
      close.style.cssText = 'min-height:40px;padding:4px 12px;border-radius:8px;font:inherit;cursor:pointer';
      close.addEventListener('click', function () { if (bar && bar.parentNode) bar.parentNode.removeChild(bar); bar = null; });
      bar.appendChild(p);
      bar.appendChild(close);
      document.body.appendChild(bar);
    }
    bar.querySelector('[data-load-watch-text]').textContent = text;
  }

  function hostOf(src) {
    try { return new URL(src, location.href).host; } catch (e) { return ''; }
  }

  // A <script> (or a module's import) that failed to load: the error event goes to the element and does not bubble,
  // so it is caught on the way down.
  window.addEventListener('error', function (e) {
    var t = e && e.target;
    if (!t || t === window || t.tagName !== 'SCRIPT') return;
    var src = t.src || '';
    var host = src ? hostOf(src) : location.host;
    if (!src || host === location.host) state.own = true;
    else state.outside[host] = true;
    if (document.body) show();
    else document.addEventListener('DOMContentLoaded', show);
  }, true);

  // For a page or a suite: the words it would show now, and showing them.
  state.words = words;
  state.show = show;
})();
