// release.js — WHICH RELEASE OF NIMROD THIS IS, in one place (row 2.154, Mike 2026-10-31).
//
// Mike: "26.10.1beta sounds good." then (same day) "Shouldn't we just always go with 26.10.1-beta? I didn't know that was
// the standard." So ONE form, Semantic Versioning's, everywhere (the site, tags, releases): year.month.release with no
// leading zeros (January is 27.1.x), and "-beta" while every module is beta
// until he signs it off (row 2.140). This is the NAME people see: the footers that show it say it as written in
// their HTML (so a page with no script still shows it), and `dev/release_test.html` fails if any of them, or the
// README, disagrees with this file. Change it here and there together.
//
// A GitHub release tag is `v` + the name: `v26.10.1-beta`. (`semver` is kept as the same string for anything that asks.)
//
// Not the same thing as the CODE VERSION (/api/version, version_watch.js): that is a hash of the client files, so a
// screen notices any deploy at all; this changes only when a release is named.

export const RELEASE = Object.freeze({ name: '26.10.1-beta', semver: '26.10.1-beta' });

/** The words a footer shows. */
export const releaseLine = (r = RELEASE) => `Version ${r.name}`;
