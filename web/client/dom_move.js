// dom_move.js -- A MOVE THAT KEEPS WHAT IS PLAYING (2026-10-02; Mike's list 09-30, ~row 1325: "Changing a Room
// row reloads a video sitting in the room").
//
// `append` on an element that is already in the page takes it OUT and puts it back, and that restarts what is
// inside it: an iframe (a YouTube embed) loads again from the start, a <video> is paused. `Element.moveBefore()`
// is the browser's own move that never takes it out, so a module moved into a redrawn room, onto another wall,
// out of a grid slot and back, or lifted off a room's display and put back, carries on. It needs both ends in
// the page and one document; anything else (or a browser without it) gets the ordinary move -- what every one
// of these moves did before, so never worse. Chromium has had it since 133 (2025); the bench Pi's is 147
// (checked 2026-10-02).
//
// Its own file, with nothing imported, because both arrangement.js and room_scene.js move modules: the room
// renderer must not import the arrangement (a page with a room and no dashboard would load all of it), and the
// arrangement loads the renderer only when a screen has a room. arrangement.js re-exports it.
//
// moveKeeping(parent, node, before = null) -> true when the move kept the node (moveBefore), false when it was
// the ordinary move (or there was nothing to move).

export function moveKeeping(parent, node, before = null) {
  if (!parent || !node) return false;
  const ref = before && before.parentNode === parent ? before : null;
  if (typeof parent.moveBefore === 'function' && node.isConnected && parent.isConnected
      && node.ownerDocument === parent.ownerDocument) {
    try { parent.moveBefore(node, ref); return true; } catch { /* the ordinary move, below */ }
  }
  parent.insertBefore(node, ref);
  return false;
}
