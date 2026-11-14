#!/usr/bin/env bash
# DRY RUN ONLY. Prints the Galion Research release layout and rollback.
# Matches galion-one-voice scripts/deploy/release-dryrun.sh: a kept directory,
# ln -sfn onto current, restart, and rollback by pointing current at the previous directory.
# This app uses release/<sha> under /opt/galion/research so it does not replace /opt/galion/current.
# Never connects. --execute is refused.
set -euo pipefail

for arg in "$@"; do
  if [[ "$arg" == "--execute" ]]; then
    echo "refusing: dry-run only" >&2
    exit 2
  fi
done

if [[ $# -gt 1 ]]; then
  echo "refusing: sha" >&2
  exit 2
fi

SHA="${1:-<sha>}"
if [[ "$SHA" != "<sha>" && ! "$SHA" =~ ^[0-9a-fA-F]{7,40}$ ]]; then
  echo "refusing: sha" >&2
  exit 2
fi

ROOT="/opt/galion/research"

cat <<STEPS
[dry-run] Galion Research release @ ${SHA}  (no connection will be made)
layout:
  ${ROOT}/release/${SHA}/
  ${ROOT}/current -> ${ROOT}/release/${SHA}
gate: [ ] pushed  [ ] CI green on ${SHA}  [ ] human approval
1. unpack the tree into ${ROOT}/release/${SHA}/ (no build on the host; keep older release directories)
2. ln -sfn ${ROOT}/release/${SHA} ${ROOT}/current
3. systemctl restart galion-research
4. node scripts/check-health.js 8787
5. rollback: ln -sfn ${ROOT}/release/<previous-sha> ${ROOT}/current && systemctl restart galion-research
6. record who, ${SHA}, and the time outside this repo
STEPS
