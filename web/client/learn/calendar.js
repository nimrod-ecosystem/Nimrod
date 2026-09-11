// Renders learn/calendar.json into any element carrying [data-calendar]. A content pack, not
// a page: "update program listings" is editing calendar.json, the same shape a teacher edits
// a Trivia or Word Forge pack. Two render modes so index.html can show a short list and a
// course page can show just its own sessions:
//   <div data-calendar></div>                 — every session
//   <div data-calendar data-course="aac-board"></div>  — only that course's sessions
const esc = (t) => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;');

function row(s, libcalBase) {
  const soon = s.status === 'coming';
  // THIS SAMPLE SITE DOES NOT REPLACE LIBCAL. Every entry links to the library's real public
  // calendar rather than pretending this listing is where someone registers — these are
  // proposed sessions with no scheduled date yet, so the honest link is the general calendar,
  // not a fabricated per-event page.
  const libcal = libcalBase
    ? '<a class="cal-libcal" href="' + esc(libcalBase) + '" target="_blank" rel="noopener">' +
      'Once scheduled, register on LibCal ↗</a>'
    : '';
  return (
    '<div class="cal-row' + (soon ? ' soon' : '') + '">' +
    '<div class="when">' + esc(s.format) +
    '<span class="date">' + esc(s.cadence) + '</span></div>' +
    '<div><h4>' + esc(s.title) +
    (soon ? ' <span class="tag soon">Coming</span>' : '') + '</h4>' +
    '<p>' + esc(s.summary) + '</p>' + libcal + '</div>' +
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
    el.innerHTML = '<div class="cal-list">' +
      rows.map((s) => row(s, data.libcal_base)).join('') + '</div>';
  });
}
