#!/usr/bin/env bash
# Best-effort: make the web port (5173) public on start, since GitHub Codespaces
# can't default a port to public via devcontainer.json (it resets to private on
# every restart). Waits for the GitHub CLI + the forwarded port, then retries.
#
# Requires: the GitHub CLI (installed via the devcontainer feature) AND a token
# with the `codespace` scope. The default codespace token often lacks it; if so,
# set a PAT (classic, scopes: codespace, repo) as a Codespaces secret named
# GH_TOKEN, then rebuild. Without permission this script just logs and exits 0 —
# you can still toggle Public manually in the PORTS tab.
set -u
PORT="${1:-5173}"
for _ in $(seq 1 45); do
  if command -v gh >/dev/null 2>&1 && [ -n "${CODESPACE_NAME:-}" ]; then
    if gh codespace ports visibility "${PORT}:public" -c "$CODESPACE_NAME" >/dev/null 2>&1; then
      echo "[hhc] port ${PORT} set to PUBLIC"
      exit 0
    fi
  fi
  sleep 4
done
echo "[hhc] could not auto-publish port ${PORT}. Set it to Public manually in the PORTS tab,"
echo "      or add a PAT (codespace scope) as the GH_TOKEN Codespaces secret and rebuild."
exit 0
