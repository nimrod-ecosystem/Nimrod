// The module bus — sources -> bindings -> sinks.
//
// This is the seam that makes inputs interchangeable (architecture.md, "The bus"):
//
//   source.emit(signal, payload)          a raw input event (button, key, switch, gaze...)
//        -> binding {source, signal, topic, transform}   routes + reshapes it
//        -> bus.publish(topic, payload)    a semantic message
//        -> sink  bus.subscribe(topic, fn) a consumer (usually a module)
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

  function publish(topic, payload) {
    const set = topics.get(topic);
    if (!set) return;
    for (const handler of [...set]) {
      try { handler(payload, topic); }
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
  function route(source, signal, payload) {
    for (const b of bindings) {
      if (b.source !== source) continue;
      if (b.signal !== signal && b.signal !== '*') continue;
      const out = b.transform ? b.transform(payload, signal) : payload;
      if (out !== undefined && out !== null) publish(b.topic, out);
    }
  }

  function createSource(name) {
    return { name, emit: (signal, payload) => route(name, signal, payload) };
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
      publish,
      dispose: () => { while (offs.length) offs.pop()(); },
    };
  }

  return { subscribe, publish, addBinding, createSource, scope };
}
