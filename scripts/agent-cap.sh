#!/bin/sh
# agent-cap.sh - PreToolUse hook (matcher "Agent") for security-audit-lean.
# Part of security-audit-lean (derived from cloudflare/security-audit-skill @ c1c8a8c, MIT).
# Enforces, per Claude Code session:
#   * only sec-lean-* subagent types (no Explore/Plan/general-purpose/fork)
#   * foreground only (run_in_background:true is refused)
#   * a hard total cap of SEC_LEAN_AGENT_CAP launches (default 10)
# Exit 2 blocks the tool call; stderr is shown to the model.
# POSIX sh only: no jq, python or network.
input=$(cat)
cap=${SEC_LEAN_AGENT_CAP:-10}
case "$cap" in ''|*[!0-9]*) cap=10 ;; esac

sid=$(printf '%s' "$input" | tr -d '\n' | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([A-Za-z0-9._-]*\)".*/\1/p')
[ -n "$sid" ] || sid=unknown
stype=$(printf '%s' "$input" | tr -d '\n' | sed -n 's/.*"subagent_type"[[:space:]]*:[[:space:]]*"\([A-Za-z0-9:._-]*\)".*/\1/p')

case "$stype" in
  sec-lean-*) ;;
  *) echo "security-audit-lean: subagent_type '${stype:-<none>}' refused. Use only sec-lean-recon, sec-lean-hunter, sec-lean-critic, sec-lean-verifier or sec-lean-batch-verifier." >&2; exit 2 ;;
esac

if printf '%s' "$input" | tr -d '\n' | grep -q '"run_in_background"[[:space:]]*:[[:space:]]*true'; then
  echo "security-audit-lean: background agents are refused. Relaunch the same agent in the foreground (omit run_in_background)." >&2
  exit 2
fi

dir=${TMPDIR:-/tmp}
dir=${dir%/}
f="$dir/sec-lean-agents-$sid.count"
lock="$dir/sec-lean-agents-$sid.lock"
i=0
while ! mkdir "$lock" 2>/dev/null; do
  i=$((i + 1)); [ "$i" -gt 50 ] && { echo "security-audit-lean: agent counter lock busy; retry this launch." >&2; exit 2; }
  sleep 0.1 2>/dev/null || sleep 1
done
n=0
[ -f "$f" ] && n=$(cat "$f" 2>/dev/null)
case "$n" in ''|*[!0-9]*) n=0 ;; esac
if [ "$n" -ge "$cap" ]; then
  rmdir "$lock"
  echo "security-audit-lean: agent cap reached ($n/$cap). Do not launch more agents: mark the remaining work deferred with ledger-tool.cjs defer and finish the report." >&2
  exit 2
fi
n=$((n + 1))
printf '%s\n' "$n" > "$f"
rmdir "$lock"
exit 0
