// Profiles client — a thin wrapper over the profile/module API.
//
// A profile is a named container of module instances belonging to a PERSON. It's
// what makes a setup device-independent: open a profile on any device and the
// same modules + state come back. This module also vends the per-instance URLs
// the state/events handles need.
//
// THE PERSON LAYER lives here too, because everything below it is addressed through
// one:  Account -> Person -> { Screens, Bindings, Output routing }.
//
//   ACCOUNT   who signs in — a Google account, or a paired device key.
//   PERSON    who a screen is FOR. The person at the bedside is a PERSON; the ACCOUNT may be a relative's.
//   DEVICE    cross-cutting. Merely where a person is right now, so nothing is keyed
//             by one.
//
// A SCREEN IMPLIES ITS PERSON, which is what keeps the kiosk dumb: it is opened as
// kiosk.html?profile=<id>, and the screen names its person, so the kiosk needs no
// person-picking step and a shared device needs no device-side UI at all. The picker
// exists only on the home side, where a moderator chooses who they are configuring.
//
// NAMING: the server's `user_id` column is the ACCOUNT (it predates this layer and
// renaming it against live data is its own day's work), so `user` below still means the
// account. The new concept is `person` everywhere — which is also the word the AT field
// uses, and the word a care setting says out loud in front of the person it describes.

import { authHeaders } from './auth.js';

export function createProfilesClient({ user, baseURL = '' }) {

  async function json(res) {
    if (!res.ok) throw new Error(`${res.url} -> ${res.status}`);
    return res.json();
  }
  const jsonHeaders = () => ({ ...authHeaders(user), 'Content-Type': 'application/json' });

  return {
    // ---- people ------------------------------------------------------------
    // Every account has at least one; the server makes one on first ask rather than
    // making anybody meet the concept before they need it.
    people: () =>
      fetch(`${baseURL}/api/people`, { headers: authHeaders(user) }).then(json).then((b) => b.people),

    addPerson: (name) =>
      fetch(`${baseURL}/api/people`, {
        method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ name }),
      }).then(json),

    renamePerson: (personId, name) =>
      fetch(`${baseURL}/api/people/${personId}`, {
        method: 'PATCH', headers: jsonHeaders(), body: JSON.stringify({ name }),
      }).then(json),

    // 409 when they still have screens, or when they are the last person on the
    // account. Both are refusals with a reason the caller should show, not errors to
    // swallow — see app.py.
    removePerson: (personId) =>
      fetch(`${baseURL}/api/people/${personId}`, {
        method: 'DELETE', headers: authHeaders(user),
      }).then(async (res) => {
        if (res.status === 409) throw new Error((await res.json()).detail || 'cannot remove');
        return json(res);
      }),

    // ---- pairing -----------------------------------------------------------
    // Consumes a code and hands back {label, base_urls, agent_id}. Deliberately does NOT
    // create the media source: which address works is something only this browser can
    // find out, so the caller probes and then creates the source itself.
    //
    // The refusals are three different problems for the person standing there — a code
    // that was already used, one that expired, one that was mistyped — and each sends them
    // somewhere different, so the server's sentence is carried through rather than
    // flattened into "that didn't work".
    claimPairing: (code) =>
      fetch(`${baseURL}/api/pair/claim`, {
        method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ code }),
      }).then(async (res) => {
        if (res.ok) return res.json();
        let detail = '';
        try { detail = (await res.json()).detail; } catch { /* not json */ }
        throw new Error(detail || `pairing failed (${res.status})`);
      }),

    // ---- screens -----------------------------------------------------------
    // `personId` narrows to one person's screens. Omit it and you get the whole
    // account's, which is what the kiosk's any-screen-will-do fallback wants.
    list: (personId = '') =>
      fetch(`${baseURL}/api/profiles${personId ? `?person=${encodeURIComponent(personId)}` : ''}`,
        { headers: authHeaders(user) }).then(json).then((b) => b.profiles),

    create: (name, personId = '') =>
      fetch(`${baseURL}/api/profiles`, {
        method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ name, person_id: personId }),
      }).then(json),

    // Hand a screen to a different person. It keeps its modules and its own settings;
    // what changes is whose bindings and whose output routing drive it.
    moveToPerson: (pid, personId) =>
      fetch(`${baseURL}/api/profiles/${pid}/person`, {
        method: 'PUT', headers: jsonHeaders(), body: JSON.stringify({ person_id: personId }),
      }).then(json),

    get: (pid) =>
      fetch(`${baseURL}/api/profiles/${pid}`, { headers: authHeaders(user) }).then(json),

    rename: (pid, name) =>
      fetch(`${baseURL}/api/profiles/${pid}`, {
        method: 'PATCH', headers: jsonHeaders(), body: JSON.stringify({ name }),
      }).then(json),

    // Deletes the profile + its modules and settings. Its append-only events remain —
    // the server refuses to delete those, so a score can't be erased by deleting a screen.
    remove: (pid) =>
      fetch(`${baseURL}/api/profiles/${pid}`, {
        method: 'DELETE', headers: authHeaders(user),
      }).then(json),

    addModule: (pid, type) =>
      fetch(`${baseURL}/api/profiles/${pid}/modules`, {
        method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ type }),
      }).then(json),

    removeModule: (pid, mid) =>
      fetch(`${baseURL}/api/profiles/${pid}/modules/${mid}`, {
        method: 'DELETE', headers: authHeaders(user),
      }).then(json),

    // Per-instance handle URLs. `key`/`stream` are the module instance id.
    stateURL:  (pid, key) => `${baseURL}/api/profiles/${pid}/state/${key}`,
    eventsURL: (pid, stream) => `${baseURL}/api/profiles/${pid}/events/${stream}`,

    // Per-PERSON, not per screen. For things that describe a body rather than one of
    // their screens — input bindings above all: which switch someone uses and how long
    // they can hold it is true everywhere, and re-entering it per screen is exactly the
    // per-device toil this project exists to avoid.
    personStateURL: (personId, key) => `${baseURL}/api/people/${personId}/state/${key}`,

    // ---- who may drive whose screens -------------------------------------
    // The OWNER's view of one person's grants.
    driveGrants: (personId) =>
      fetch(`${baseURL}/api/people/${personId}/drive-grants`, { headers: jsonHeaders() })
        .then(json).then((r) => r.grants),
    grantDrive: (personId, subjectId, { kind = 'account', label = '', days = null } = {}) =>
      fetch(`${baseURL}/api/people/${personId}/drive-grants`, {
        method: 'POST', headers: jsonHeaders(),
        body: JSON.stringify({ subject_id: subjectId, subject_kind: kind, label, days }),
      }).then(json),
    revokeDrive: (personId, grantId) =>
      fetch(`${baseURL}/api/people/${personId}/drive-grants/${grantId}`, {
        method: 'DELETE', headers: jsonHeaders(),
      }).then(json),

    // The GRANTEE's view. Without this the whole feature is unusable by the person it was
    // built for: they would have to be told a person id out of band.
    sharedWithMe: () =>
      fetch(`${baseURL}/api/drive/shared`, { headers: jsonHeaders() })
        .then(json).then((r) => r.people),
    // The per-person mailbox the `remote` output channel posts into, and every other
    // device of theirs polls. Per person, not per screen, for the same reason.
    personEventsURL: (personId, stream) => `${baseURL}/api/people/${personId}/events/${stream}`,
  };
}
