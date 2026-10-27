# web/tools/hooks — nothing personal leaves this computer

Three git hooks that run `web/server/test_no_family_names.py` before anything is committed or pushed:

| Hook | Checks |
|---|---|
| `pre-commit` | the files about to be committed |
| `commit-msg` | the commit message |
| `pre-push` | every commit about to be pushed: its message and its files |

They refuse, with the line that broke the rule, when a family member's name or medical-records detail is in any of
those. The `names` workflow (`.github/workflows/names.yml`) runs the same check on GitHub, but that is after the push,
when it is already public; these run before.

**Turn them on** (once per clone; GitHub Desktop uses them too):

    git config core.hooksPath web/tools/hooks

**Turn them off:** `git config --unset core.hooksPath`.

If a commit is refused: take the name out (a stand-in name in a test, or the design fact it stood for in a comment)
and commit again.

**The list is not in this repo** (Mike, 2026-10-27). The hooks read it from `.git/info/nimrod-blocked-names` in the
clone, untracked; GitHub's run compares words by hash (`test_no_family_names.py`). A suite's own guard against naming
somebody leaves the name to this central check rather than spelling it.

The hooks need Python (`py -3`, `python3` or `python`). Without it they refuse rather than let anything through
unchecked.
