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

  function addBinding({ source, signal, topic, transform }) {
    const binding = { source, signal, topic, transform };
    bindings.add(binding);
    return () => bindings.delete(binding);
  }

  // A raw signal fans out to every matching binding. `transform` returning
  // undefined/null means "ignore this signal" (e.g. a key we don't map).
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
    }
  }

  function createSource(name) {
    return { name, emit: (signal, payload, meta) => route(name, signal, payload, meta) };
  }

  // A scoped view for a module: everything it opens is tracked and released on
  // dispose(), so a destroyed module cannot leak sinks or bindings.
  function scope() {
    const offs = [];
    const track = (off) => { offs.push(off); return off; };
    return {
      subscribe: (topic, handler) => track(subscribe(topic, handler)),
      addBinding: (binding) => track(addBinding(binding)),
      createSource,
      publish,          // (topic, payload, meta) - a scope does not rewrite who sent a thing
      dispose: () => { while (offs.length) offs.pop()(); },
    };
  }

  return { subscribe, publish, addBinding, createSource, scope };
}
