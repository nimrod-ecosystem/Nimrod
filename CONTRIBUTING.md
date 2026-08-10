# Contributing to Nimrod

Help is genuinely welcome — this has been built by one person with the help of AI tools
and open-source work, and more hands make it better for the next family.

## Ways to help
- **Build or improve a module.** Every module is self-contained. See `docs/modules/` for
  the documentation convention and `_TEMPLATE.md` to document what you add.
- **Improve accessibility.** The audience includes people with severe cognitive and motor
  impairments. Clearer, simpler, more forgiving is almost always better.
- **Write docs.** Plain-language walkthroughs (for people *and* their AI tools) are as
  valuable as code here.
- **Test on real hardware.** Phones, tablets, low-end PCs, Raspberry Pi.

## Ground rules
1. **Never commit patient data or personal media.** No photos, recordings, names, health
   information, or real network addresses. The `.gitignore` is a safety net, not a
   guarantee — check your commits.
2. **Respect the privacy boundary.** Anything touching a patient's private data must run
   locally on open-source models. Only generic, non-sensitive features may use cloud
   services. See `DECISIONS.md`.
3. **Keep it device-independent.** No machine-specific assumptions; per-user state lives
   with the account. See `docs/architecture.md`.
4. **License.** By contributing you agree your contribution is released under the project's
   [MIT license](LICENSE).

## Getting started
The web app lives in `web/` (being rebuilt fresh). Start there, read `docs/architecture.md`,
and open an issue before large changes so we can talk through the approach.
