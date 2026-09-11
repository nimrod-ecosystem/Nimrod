// Renders learn/calendar.json into any element carrying [data-calendar]. A content pack, not
// a page: "update program listings" is editing calendar.json, the same shape a teacher edits
// a Trivia or Word Forge pack. Two render modes so index.html can show a short list and a
// course page can show just its own sessions:
//   <div data-calendar></div>                 — every session
//   <div data-calendar data-course="aac-board"></div>  — only that course's sessions
const esc = (t) => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;');

function row(s) {
  const soon = s.status === 'coming';
  return (
    '<div class="cal-row' + (soon ? ' soon' : '') + '">' +
    '<div class="when">' + esc(s.format) +
    '<span class="date">' + esc(s.cadence) + '</span></div>' +
    '<div><h4>' + esc(s.title) +
    (soon ? ' <span class="tag soon">Coming</span>' : '') + '</h4>' +
    '<p>' + esc(s.summary) + '</p></div>' +
    '<div class="fmt">' + esc(s.duration_min) + ' min' +
    '<br>' + esc(s.audience) + '</div>' +
    '</div>'
  );
}

export async function renderCalendars(root = document) {
  const targets = root.querySelectorAll('[data-calendar]');
  if (!targets.length) return;
  let data;
  try {
    const res = await fetch('/learn/calendar.json');
    if (!res.ok) throw new Error(String(res.status));
    data = await res.json();
  } catch (e) {
    targets.forEach((el) => {
      el.innerHTML = '<p class="muted">Could not load the program listing just now.</p>';
    });
    console.warn('calendar', e);
    return;
  }
  targets.forEach((el) => {
    const course = el.getAttribute('data-course');
    const limit = Number(el.getAttribute('data-limit')) || Infinity;
    const rows = data.sessions
      .filter((s) => !course || s.course === course)
      .slice(0, limit);
    if (!rows.length) {
      el.innerHTML = '<p class="muted">Nothing listed here yet.</p>';
      return;
    }
    el.innerHTML = '<div class="cal-list">' + rows.map(row).join('') + '</div>';
  });
}
