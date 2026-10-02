// modules/voice_review.js — the voice recordings kept on this screen, as a module (row 2.44).
//
// The review panel (voice_review.js) in a box, for the person this screen belongs to. It reads the
// recordings THIS screen kept (voice_recording.js keeps them in this browser, on this device), so it
// is useful on the screen that recorded them and empty everywhere else - which is the point: they
// never left it. A family member opens it here, plays each one, and says what was meant.
//
// It makes no recording of its own, opens no microphone, and plays a clip only when somebody presses
// Play. Settings: none - retention and the ceiling are the person's recording settings.
//
// *** "YOUR OWN VOICE MODEL" (2026-10-02, voice_model.js): a second tab. *** Where somebody making a speech
// model of their own voice finds the steps: read phrases into this screen's recorder (`ctx.voiceRecorder`,
// the screen's own - absent on a page that does not listen, which then says so), export them for Euphonia's
// notebook, and the commands that convert the result and start it. `ctx.saveVoiceModel` writes only that
// person's own voice-model settings; absent, the page names the settings instead.

import { registerModule } from '../module.js';
import { createIdbPairStore, createMemoryPairStore, voiceRecordingOptionsFrom } from '../voice_recording.js';
import { mountVoiceReview } from '../voice_review.js';
import { mountVoiceModel } from '../voice_model.js';
import { available as fsAvailable, pickFolder } from '../fs_sink.js';

const CSS = `
.m-voice-review{position:absolute;inset:0;overflow:auto;box-sizing:border-box;padding:16px;
  background:var(--surface,#fff);color:var(--text,#111);font:16px/1.4 var(--font,system-ui,sans-serif)}
.m-voice-review .vr-h{margin:0 0 6px;font-size:1.2em}
.m-voice-review .vr-summary,.m-voice-review .vr-said{margin:4px 0;color:var(--text-soft,inherit)}
.m-voice-review .vr-bar{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0}
.m-voice-review button{min-height:44px;padding:0 14px;border-radius:10px;border:1px solid var(--border,#999);
  background:var(--surface-alt,#eee);color:inherit;font:inherit;cursor:pointer}
.m-voice-review button[aria-pressed="true"]{background:var(--accent,#246);color:var(--on-accent,#fff);border-color:var(--accent,#246)}
.m-voice-review .vr-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:12px}
.m-voice-review .vr-row{border:1px solid var(--border,#ccc);border-radius:12px;padding:10px 12px;display:flex;flex-direction:column;gap:6px}
.m-voice-review .vr-meta{font-size:.85em;color:var(--text-soft,inherit)}
.m-voice-review .vr-heard{font-weight:600}
.m-voice-review .vr-meant{display:flex;flex-direction:column;gap:4px;font-weight:600}
.m-voice-review .vr-meant input{min-height:44px;font:inherit;padding:0 10px;border-radius:10px;
  border:1px solid var(--border,#999);background:var(--surface,#fff);color:inherit}
.m-voice-review .vr-play,.m-voice-review .vr-acts{display:flex;flex-wrap:wrap;gap:8px}
.m-voice-review .vr-tabs{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 10px}`;

registerModule(
  { type: 'voice_review', title: 'Voice recordings', core: 'new',
    description: 'Play the voice recordings this screen kept, see what the recogniser wrote, and say '
      + 'what was meant - so a recogniser can learn this voice. Recording is off unless it is turned '
      + 'on for a person. Nothing leaves this screen unless you export it to a folder.',
    dependsOn: 'none', importance: 'optional' },
  (ctx) => {
    const { mount } = ctx;
    let root = null;
    let panel = null;
    let model = null;
    let store = null;
    return {
      init() {
        root = document.createElement('div');
        root.className = 'm-voice-review';
        const style = document.createElement('style');
        style.textContent = CSS;
        const tabs = document.createElement('div');
        tabs.className = 'vr-tabs';
        tabs.innerHTML = '<button type="button" data-tab="recordings" aria-pressed="true">Recordings</button>'
          + '<button type="button" data-tab="model" aria-pressed="false">Your own voice model</button>';
        const body = document.createElement('div');
        const modelBox = document.createElement('div');
        modelBox.dataset.model = '';
        modelBox.hidden = true;
        root.append(style, tabs, body, modelBox);
        mount.appendChild(root);
        try { store = ctx.voiceStore || createIdbPairStore(); }
        catch (err) { console.error('voice review: no storage', err); store = createMemoryPairStore(); }
        tabs.addEventListener('click', (e) => {
          const b = e.target.closest('[data-tab]');
          if (!b) return;
          const showModel = b.dataset.tab === 'model';
          for (const t of tabs.querySelectorAll('[data-tab]')) t.setAttribute('aria-pressed', String(t === b));
          body.hidden = showModel;
          modelBox.hidden = !showModel;
          if (showModel && !model) {
            // Built on first open, so a screen that never opens it never arms anything.
            model = mountVoiceModel(modelBox, {
              personId: ctx.personId || null,
              values: () => { try { return ctx.personRow?.() || {}; } catch { return {}; } },
              save: typeof ctx.saveVoiceModel === 'function' ? (patch) => ctx.saveVoiceModel(patch) : null,
              recorder: ctx.voiceRecorder || null,
              store,
              fs: { available: () => fsAvailable(), pickFolder: () => pickFolder() },
            });
          } else if (showModel) model.refresh();
          if (!showModel) panel?.refresh?.();      // phrases just read show up in "All"
        });
        panel = mountVoiceReview(body, {
          store,
          personId: ctx.personId || null,
          keepDays: () => {
            try { return voiceRecordingOptionsFrom(ctx.personRow?.() || {}).keepDays; } catch { return null; }
          },
          fs: { available: () => fsAvailable(), pickFolder: () => pickFolder() },
        });
      },
      onResize() {},
      onHide() {},
      destroy() {
        try { panel?.destroy(); } catch { /* gone */ }
        panel = null;
        try { model?.destroy(); } catch { /* gone */ }
        model = null;
        if (!ctx.voiceStore) { try { store?.close?.(); } catch { /* gone */ } }
        store = null;
        root?.remove(); root = null;
      },
    };
  },
);
