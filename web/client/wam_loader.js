// wam_loader.js — AN AUDIO PLUGIN FROM THE `audio-plugins/` FOLDER INTO THE MIXER'S SLOT (row 2.49).
//
// Mike, 2026-10-01: user folders for "fonts, LUTs, VSTs". *** A VST CANNOT RUN IN A BROWSER *** —
// it is a native program (a .dll/.vst3/.component) and a web page cannot load native code. The
// browser's equivalent is a WEB AUDIO MODULE (WAM 2.0): an open plugin standard built on Web Audio
// and AudioWorklet. Status checked 2026-10-01: the standard and its SDK are published and used
// (`@webaudiomodules/sdk` 0.0.12 on npm, MIT, last released July 2024; example plugins updated
// November 2025) — alive, but small and slow-moving. A desktop helper that hosts real VSTs and
// streams their sound to the page is possible later work; nothing here pretends to be that.
//
// *** CAN A WAM LOAD FROM A LOCAL FOLDER WITHOUT A SERVER? — YES, WITH A CATCH, SAID PLAINLY. ***
// A WAM is a FOLDER of JavaScript: `index.js` imports its other files by RELATIVE path and finds its
// audio processor with `new URL('./Processor.js', import.meta.url)`. Normally a web server hands
// those out. From a folder the page can only make `blob:` URLs, and a blob: URL has no folder to be
// relative to — `import './x.js'` inside one fails. So this file READS EVERY FILE in the plugin's
// folder and, for each JavaScript file, REWRITES its relative references to the blob: URLs of the
// files they name (dependencies first), then imports the result. Proven in the suite against real
// module imports and a real AudioWorklet in Chromium. WHAT IT CANNOT DO, so a failure is explained
// rather than mysterious:
//   * a path BUILT at run time (`import(base + name)`, `fetch(import.meta.url + '/../x')`) cannot be
//     seen in the text, so it cannot be rewritten — that file fails to load;
//   * two files that import EACH OTHER (a cycle) cannot both be given each other's blob: URL — the
//     loader refuses, naming them;
//   * a plugin that fetches anything from the network can still do so: it is a program on the page.
//   Such a plugin needs a web server to serve its folder; that is the honest answer for it.
//
// *** THE HOST FILES. *** A WAM 2.0 plugin expects the host to have run the SDK's
// `initializeWamHost(audioContext)` first. The SDK is not in this repository and NOTHING IS
// DOWNLOADED, so the person puts the SDK (the `@webaudiomodules/sdk` package's files) in a folder
// named `wam-sdk` inside `audio-plugins/`; it is loaded the same way. Missing, the plugin is refused
// with that sentence. (A guess for Mike: vendoring the MIT-licensed SDK into the repo would remove
// this step — his call, as it is third-party code in the public repo.)
//
// *** A PLUGIN IS A PROGRAM. *** Whatever is in that folder runs with everything this page can do.
// So: OFF BY DEFAULT — nothing here runs until somebody presses something that names a plugin
// (`mixer_fx.js` `addWamFromFolder`), and nothing loads a plugin on its own at boot.

import { listFiles, listFolders, extOf } from './user_folders.js';

export const SDK_FOLDER = 'wam-sdk';
const MAX_FILES = 400;
const MAX_BYTES = 20 * 1024 * 1024;

const JS_EXT = new Set(['js', 'mjs']);
const MIME = { js: 'text/javascript', mjs: 'text/javascript', json: 'application/json', wasm: 'application/wasm',
  css: 'text/css', html: 'text/html', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp', wav: 'audio/wav', mp3: 'audio/mpeg', ogg: 'audio/ogg', txt: 'text/plain' };

/** Every file under `dir`, as `{ 'path/in/folder.js': FileSystemFileHandle }`. Bounded. */
export async function readTree(dir, { prefix = '', out = {}, count = { n: 0 } } = {}) {
  for (const { name, handle } of await listFiles(dir, [])) {
    if (++count.n > MAX_FILES) throw new Error(`more than ${MAX_FILES} files in the plugin's folder`);
    out[prefix + name] = handle;
  }
  for (const { name, handle } of await listFolders(dir)) {
    await readTree(handle, { prefix: `${prefix}${name}/`, out, count });
  }
  return out;
}

// Resolve `spec` (relative) against the file at `from`, inside the folder. null when it leaves it.
export function resolvePath(from, spec) {
  const parts = from.split('/').slice(0, -1);
  for (const seg of String(spec).split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') { if (!parts.length) return null; parts.pop(); } else parts.push(seg);
  }
  return parts.join('/');
}

// The relative references a JS file makes that can be seen in its text: static imports and
// re-exports, side-effect imports, dynamic imports of a literal, and `new URL('<literal>', import.meta.url)`.
const REFS = [
  /(\bfrom\s*)(['"])(\.{1,2}\/[^'"\n]+)\2/g,
  /(\bimport\s*)(['"])(\.{1,2}\/[^'"\n]+)\2/g,
  /(\bimport\s*\(\s*)(['"])(\.{1,2}\/[^'"\n]+)\2(?=\s*\))/g,
];
const META_URL = /new\s+URL\(\s*(['"])([^'"\n]+)\1\s*,\s*import\.meta\.url\s*\)/g;

/** The paths (inside the folder) a JS source refers to. */
export function referencesOf(path, source) {
  const out = new Set();
  for (const rx of REFS) for (const m of String(source).matchAll(rx)) { const p = resolvePath(path, m[3]); if (p != null) out.add(p); }
  for (const m of String(source).matchAll(META_URL)) {
    if (/^[a-z]+:/i.test(m[2])) continue;
    const p = resolvePath(path, m[2]); if (p != null) out.add(p);
  }
  return [...out];
}

/** `source` with each visible relative reference replaced by the URL `urlOf(path)` gives. */
export function rewriteSource(path, source, urlOf) {
  const swap = (spec) => { const p = resolvePath(path, spec); const u = p == null ? null : urlOf(p); return u || spec; };
  let s = String(source);
  for (const rx of REFS) s = s.replace(rx, (all, head, q, spec) => `${head}${q}${swap(spec)}${q}`);
  s = s.replace(META_URL, (all, q, spec) => (/^[a-z]+:/i.test(spec) ? all : `new URL(${q}${swap(spec)}${q})`));
  return s;
}

/**
 * A folder of files as blob: URLs with every visible relative reference rewritten. Resolves
 * `{ urls: { path: url }, release() }`. Throws an Error with a plain message on a cycle, a missing
 * file or a folder too big. `URLImpl`/`BlobImpl` are injectable.
 */
export async function folderToUrls(dir, { URLImpl = URL, BlobImpl = Blob } = {}) {
  const files = await readTree(dir);
  const urls = {};
  const made = [];
  const texts = {};
  let bytes = 0;
  for (const [path, h] of Object.entries(files)) {
    const f = await h.getFile();
    bytes += f.size || 0;
    if (bytes > MAX_BYTES) throw new Error('the plugin\'s folder is bigger than 20 MB');
    if (JS_EXT.has(extOf(path))) texts[path] = await f.text();
    else { const u = URLImpl.createObjectURL(f); urls[path] = u; made.push(u); }
  }
  // JavaScript, dependencies first.
  const state = {};
  const visit = (path, chain) => {
    if (state[path] === 'done') return;
    if (state[path] === 'busy') throw new Error(`these files import each other in a circle (${[...chain, path].join(' -> ')}), so they cannot be loaded from a folder; this plugin needs a web server`);
    state[path] = 'busy';
    for (const dep of referencesOf(path, texts[path])) {
      if (dep in texts) visit(dep, [...chain, path]);
      else if (!(dep in urls)) throw new Error(`${path} needs ${dep}, which is not in the plugin's folder`);
    }
    const code = rewriteSource(path, texts[path], (p) => urls[p]);
    const u = URLImpl.createObjectURL(new BlobImpl([code], { type: MIME.js }));
    urls[path] = u; made.push(u);
    state[path] = 'done';
  };
  for (const path of Object.keys(texts)) visit(path, []);
  return { urls, release: () => { for (const u of made) { try { URLImpl.revokeObjectURL(u); } catch { /* gone */ } } } };
}

// The entry file of a plugin folder: `index.js` at the top, else the only top-level .js file.
function entryOf(urls) {
  if (urls['index.js']) return 'index.js';
  const top = Object.keys(urls).filter((p) => !p.includes('/') && JS_EXT.has(extOf(p)));
  return top.length === 1 ? top[0] : null;
}

/**
 * The host, once per audio context: the SDK from `audio-plugins/wam-sdk/`, then its
 * `initializeWamHost(audioContext)` -> `[hostGroupId, hostGroupKey]`.
 */
const hosts = new WeakMap();
export async function wamHost(pluginsDir, audioContext, { importModule = (u) => import(/* @vite-ignore */ u), URLImpl, BlobImpl } = {}) {
  if (hosts.has(audioContext)) return hosts.get(audioContext);
  const p = (async () => {
    let sdkDir = null;
    try { sdkDir = await pluginsDir.getDirectoryHandle(SDK_FOLDER); } catch { sdkDir = null; }
    if (!sdkDir) {
      throw new Error(`Web Audio Module plugins need the free WAM host files: put the @webaudiomodules/sdk package's files in a folder named ${SDK_FOLDER} inside the audio plugins folder. Nothing is downloaded.`);
    }
    const { urls } = await folderToUrls(sdkDir, { URLImpl, BlobImpl });
    const entry = urls['initializeWamHost.js'] ? 'initializeWamHost.js' : urls['dist/index.js'] ? 'dist/index.js' : entryOf(urls);
    if (!entry) throw new Error(`no initializeWamHost.js or index.js in the ${SDK_FOLDER} folder`);
    const mod = await importModule(urls[entry]);
    const init = mod.initializeWamHost || mod.default;
    if (typeof init !== 'function') throw new Error(`the ${SDK_FOLDER} folder does not provide initializeWamHost`);
    const group = await init(audioContext);
    return Array.isArray(group) ? group : [group];
  })();
  hosts.set(audioContext, p);
  p.catch(() => hosts.delete(audioContext));
  return p;
}

/**
 * Load ONE plugin folder and make its instance in `audioContext` (the mixer's own — `fx.context()`).
 * Resolves `{ ok: true, plugin }` — `plugin` is the `{ id, label, create }` object `mixer_fx.js`'s
 * `addPlugin` takes, its node already made — or `{ ok: false, why }`. Never throws.
 */
export async function loadWam(pluginDir, { pluginsDir, audioContext, id = '', importModule = (u) => import(/* @vite-ignore */ u),
  URLImpl, BlobImpl } = {}) {
  let release = () => {};
  try {
    if (!pluginDir || !audioContext) return { ok: false, why: 'no plugin folder, or no audio on this device' };
    const [hostGroupId] = await wamHost(pluginsDir, audioContext, { importModule, URLImpl, BlobImpl });
    const built = await folderToUrls(pluginDir, { URLImpl, BlobImpl });
    release = built.release;
    const entry = entryOf(built.urls);
    if (!entry) { release(); return { ok: false, why: 'no index.js in the plugin\'s folder' }; }
    const mod = await importModule(built.urls[entry]);
    const WAM = mod.default || mod.WebAudioModule || mod;
    if (!WAM || typeof WAM.createInstance !== 'function') { release(); return { ok: false, why: 'this folder\'s index.js is not a Web Audio Module (no createInstance)' }; }
    const instance = await WAM.createInstance(hostGroupId, audioContext);
    const node = instance && instance.audioNode;
    if (!node || typeof node.connect !== 'function') { release(); return { ok: false, why: 'the plugin made no audio node' }; }
    const name = String(id || pluginDir.name || 'plugin').replace(/[^\w.-]+/g, '-').replace(/^[^A-Za-z0-9]+/, '').slice(0, 40) || 'plugin';
    const label = (instance.descriptor && instance.descriptor.name) || pluginDir.name || name;
    const plugin = {
      id: `wam-${name}`.slice(0, 40),
      label,
      create(ctx) {
        if (ctx !== audioContext) throw new Error('made for another audio context');
        return { input: node, output: node,
          destroy() { try { node.disconnect(); } catch { /* gone */ } try { instance.destroy?.(); node.destroy?.(); } catch { /* gone */ } release(); } };
      },
    };
    return { ok: true, plugin };
  } catch (err) {
    release();
    return { ok: false, why: String((err && err.message) || err) };
  }
}
