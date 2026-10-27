#!/bin/sh
# Shared by the three hooks beside this file: run web/server/test_no_family_names.py with whatever Python this computer
# has. No Python at all REFUSES rather than lets it through - a privacy check that quietly does nothing when it cannot
# run is the failure this exists to stop (chat's note CZ, 2026-10-26).
top=$(git rev-parse --show-toplevel) || exit 1
check="$top/web/server/test_no_family_names.py"
for py in "py -3" python3 python; do
  if $py -c "import sys" >/dev/null 2>&1; then
    out=$($py "$check" "$@" 2>&1); status=$?
    if [ $status -ne 0 ]; then
      echo "$out" | grep -v '^PASS' >&2
      echo "" >&2
      echo "Stopped by the name check (web/tools/hooks). Nothing has left this computer." >&2
    fi
    exit $status
  fi
done
echo "The name check could not run: no Python found (tried py -3, python3, python). Stopped, so nothing personal" >&2
echo "can slip through unchecked. Install Python, or see web/tools/hooks/README.md." >&2
exit 1
