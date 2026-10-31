// release.js — WHICH RELEASE OF NIMROD THIS IS, in one place (row 2.154, Mike 2026-10-31).
//
// Mike: "26.10.1beta sounds good." Year, month, the release within the month, and "beta" while every module is beta
// until he signs it off (row 2.140). This is the NAME people see: the footers that show it say it as written in
// their HTML (so a page with no script still shows it), and `dev/release_test.html` fails if any of them, or the
// README, disagrees with this file. Change it here and there together.
//
// `semver` is the same release for anything that insists on Semantic Versioning (a pre-release takes a hyphen):
// a GitHub release tag is `v26.10.1-beta`. Nothing in the site reads it today.
//
// Not the same thing as the CODE VERSION (/api/version, version_watch.js): that is a hash of the client files, so a
// screen notices any deploy at all; this changes only when a release is named.

export const RELEASE = Object.freeze({ name: '26.10.1beta', semver: '26.10.1-beta' });

/** The words a footer shows. */
export const releaseLine = (r = RELEASE) => `Version ${r.name}`;
