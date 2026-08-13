// Profiles client — a thin wrapper over the profile/module API.
//
// A profile is a named container of module instances belonging to a user. It's
// what makes a setup device-independent: open a profile on any device and the
// same modules + state come back. This module also vends the per-instance URLs
// the state/events handles need.

import { authHeaders } from './auth.js';

export function createProfilesClient({ user, baseURL = '' }) {

  async function json(res) {
    if (!res.ok) throw new Error(`${res.url} -> ${res.status}`);
    return res.json();
  }
  const jsonHeaders = () => ({ ...authHeaders(user), 'Content-Type': 'application/json' });

  return {
    list: () =>
      fetch(`${baseURL}/api/profiles`, { headers: authHeaders(user) }).then(json).then((b) => b.profiles),

    create: (name) =>
      fetch(`${baseURL}/api/profiles`, {
        method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ name }),
      }).then(json),

    get: (pid) =>
      fetch(`${baseURL}/api/profiles/${pid}`, { headers: authHeaders(user) }).then(json),

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
  };
}
