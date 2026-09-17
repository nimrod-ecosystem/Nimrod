// The module bus — sources -> bindings -> sinks.
//
// This is the seam that makes inputs interchangeable (architecture.md, "The bus"):
//
//   source.emit(signal, payload)          a raw input event (button, key, switch, gaze...)
//        -> binding {source, signal, topic, transform}   routes + reshapes it
//        -> bus.publish(topic, payload, meta)   a semantic message
//        -> sink  bus.subscribe(topic, fn) a consumer (usually a module)
//
// META IS A THIRD ARGUMENT RATHER THAN A KEY IN THE PAYLOAD, and that is the whole reason
// senders could be added without touching a single module. A payload belongs to whoever
// declared the topic - `photos/next` carries whatever photos says it carries - so putting
// `from` inside it would be reaching into somebody else's data and would break any module
// that treats its payload as a value rather than a bag. A third parameter is invisible to
// every handler that does not ask for it, which is all of them until one wants to know who
// pressed. See sender.js.
//
// Modules NEVER name their inputs. They open a sink on a topic. Any number of
// sources can feed that topic by adding a binding — with zero changes downstream.
// That is what lets a new input method (switch, scan, voice, a home-automation
// device) drive an existing module.

export function createBus() {
  const topics = new Map();   // topic -> Set<handler>
  const bindings = new Set(); // {source, signal, topic, transform}

  function subscribe(topic, handler) {
    let set = topics.get(topic);
    if (!set) { set = new Set(); topics.set(topic, set); }
    set.add(handler);
    return () => { set.delete(handler); if (!set.size) topics.delete(topic); };
  }

  function publish(topic, payload, meta) {
    const set = topics.get(topic);
    if (!set) return;
    for (const handler of [...set]) {
      try { handler(payload, topic, meta); }
      catch (err) { console.error(`sink error on "${topic}"`, err); }
    }
  }

  function addBinding({ source, signal, topic, transform, consume }) {
    const binding = { source, signal, topic, transform, consume };
    bindings.add(binding);
    return () => bindings.delete(binding);
  }

  // A raw signal fans out to every matching binding. `transform` returning
  // undefined/null means "ignore this signal" (e.g. a key we don't map).
  //
  // *** `consume`, ADDED 2026-09-17 — THE ONE NAMED SEAM CHANGE THE ASSUMPTION CHECK FOUND. ***
  // `ASSUMPTION_CHECK.md`: 17 of 18 substrate files KEEP, only this one needs a seam change —
  // `route()` had no way for one binding to say "stop, I've got this" to the ones after it.
  //
  // *** OFF BY DEFAULT, ON PURPOSE — THIS IS A DESIGN ABSOLUTE'S EDGE CASE HUNTED, NOT GUESSED
  // AT. *** A binding with no `consume` behaves EXACTLY as before: every matching binding still
  // fires, in the same order, with the same payload. Nothing existing changes meaning. Only a
  // binding that explicitly opts in can stop a later one from firing, which is the same
  // "off by default, available to anybody who turns it on" shape CLAUDE.md's own design-absolutes
  // section asks for.
  //
  // *** SCOPED NARROWLY: A MECHANICAL CONSUME FLAG, NOT A RULING ON THE BIGGER OPEN QUESTION.
  // *** `NEW_CORE_SPEC.md` §4 names THREE candidate shapes for inhibition (per-binding, per-scope,
  // or a consume flag) and leaves open how any of them composes with the already-settled
  // "type is hint not veto, a declared conversion is the answer" ruling. This builds only the
  // cheapest of the three — a consume flag, "first matching binding wins" — because it is a
  // mechanical capability with no type-system question attached at all: it says nothing about
  // whether a TYPE may veto a link, only whether ONE BINDING, having actually handled a signal,
  // may stop a LATER one from also handling the exact same raw signal. The bigger question
  // (inhibition as a first-class link/connection type in the composition model, per
  // `RESEARCH_NOTES.md`'s biology argument) is NOT resolved here and stays open — this is
  // deliberately the narrow, load-bearing piece underneath it, not a stand-in for it.
  //
  // *** CONSUME ONLY FIRES WHEN THE BINDING ACTUALLY HANDLED THE SIGNAL. *** A binding whose
  // transform returns null/undefined never published — it said "not mine," and a binding that
  // declined to act has no business stopping one that would have. Consuming is something a
  // binding EARNS by actually publishing, never something it claims by merely matching.
  //
  // Iteration order is insertion order (a `Set` already guarantees this in JS) — "the binding
  // that consumed" and "the ones after it" is well-defined and stable, the same way it already
  // was for plain fan-out.
  function route(source, signal, payload, meta) {
    for (const b of bindings) {
      if (b.source !== source) continue;
      if (b.signal !== signal && b.signal !== '*') continue;
      const out = b.transform ? b.transform(payload, signal) : payload;
      // THE "IGNORE THIS SIGNAL" RULE BELONGS TO THE TRANSFORM, AND ONLY TO IT. Applying it
      // to an untransformed signal silently swallowed every BARE emit - `emit('next')` with
      // no payload - because `undefined` in meant `undefined` out. MEASURED: that killed NINE
      // on-screen buttons across FIVE modules - photos, youtube, personal and educational
      // next+prev, and interstitials' skip. `director`'s skip and the landing page's switch
      // survived, because both bindings carry a transform that returns a real value. It hid
      // for so long because the same modules ALSO answer their bus topic directly, so every
      // test that drove `photos/next` passed while the arrow under the photo did nothing.
      // Without a transform there is nobody to have made that decision, so the signal fires.
      if (b.transform && (out === undefined || out === null)) continue;
      // Meta rides through untransformed. A `transform` reshapes the VALUE; who sent it is
      // not the transform's to rewrite, and letting it be would make a sender forgeable by
      // any binding rather than only by a publisher.
      publish(b.topic, out, meta);
      if (b.consume) break;
    }
  }

  function createSource(name) {
    return { name, emit: (signal, payload, meta) => route(name, signal, payload, meta) };
  }

  // INSTANCE ADDRESSING (the third-bus work, 2026-09-10 — glossary "data link", "port").
  //
  // Verbs have always resolved to the focused module BY TYPE: `input_router.js` looks up
  // `photos/next` in a type-keyed table and publishes that bare string, so on a screen with
  // two photos panels BOTH hear every "next" — there is no way to say which one. A data link
  // needs the opposite: it addresses one instance's port specifically. Those two could not
  // coexist as bare topic strings, so this gives any topic a second, INSTANCE-SCOPED address
  // that means "this one instance, and only this one" without touching what the bare topic
  // already means to everyone else.
  //
  // `#` is the delimiter because nothing in this codebase uses one in a topic string (checked)
  // and `input_gamepad.js` already reaches for the same character for the same idea — a second
  // controller of one kind gets a "#2" suffix. Same convention, same reason: distinguish one of
  // several without renaming what they all are.
  function instanceTopic(instanceId, topic) {
    return instanceId ? `${topic}#${instanceId}` : topic;
  }

  // A scoped view for a module: everything it opens is tracked and released on
  // dispose(), so a destroyed module cannot leak sinks or bindings.
  //
  // `instanceId`, new: when given, every subscription ALSO answers on this instance's own
  // scoped alias — in ADDITION to the bare topic, never instead of it, so anything that
  // already publishes to the bare topic (a module's own on-screen button, an existing test)
  // keeps reaching every instance exactly as it always has. What changes is that something
  // which KNOWS an instance id — the verb router, a future data link — can now address this
  // one instance without that broadcast, which is the collision item 2 exists to fix.
  function scope(instanceId = null) {
    const offs = [];
    const track = (off) => { offs.push(off); return off; };
    return {
      subscribe: (topic, handler) => {
        const un = [track(subscribe(topic, handler))];
        if (instanceId) un.push(track(subscribe(instanceTopic(instanceId, topic), handler)));
        return () => un.forEach((off) => off());
      },
      addBinding: (binding) => track(addBinding(binding)),
      createSource,
      publish,          // (topic, payload, meta) - a scope does not rewrite who sent a thing
      instanceId,
      dispose: () => { while (offs.length) offs.pop()(); },
    };
  }

  return { subscribe, publish, addBinding, createSource, scope, instanceTopic };
}
