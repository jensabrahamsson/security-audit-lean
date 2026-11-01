# security-audit-lean

A token-lean, source-only security audit skill for Claude Code.

## Purpose

[cloudflare/security-audit-skill](https://github.com/cloudflare/security-audit-skill)
is a thorough, rigorous audit workflow, but a full run is expensive: many agent
invocations, large instruction files that every agent has to load, and repeated
critic waves. This repository is a **lean variant whose goal is to use far fewer
tokens** while keeping the same evidence bar and the same output format.

It is a derivative work of **cloudflare/security-audit-skill @ c1c8a8c** (MIT,
Copyright (c) 2025-2026 Cloudflare, Inc.). See [License](#license).

## Comparison with upstream

| | Upstream (`security-audit`) | This repo (`security-audit-lean`) |
|---|---|---|
| Workflow instructions | `SKILL.md`, `RECONNAISSANCE.md`, `HUNTING.md`, `VALIDATION-AND-REPORTING.md`: about 78 KB the parent and agents read | `SKILL.md` (11 KB) plus short agent definitions (about 19 KB total) and two reference files (about 20 KB) |
| Agent count | Unbounded; scales with coverage units, critic waves and verifiers. Even `quick` reserves 4 reconnaissance calls, a critic and verifiers | **Hard cap of 10**: 1 recon, up to 5 hunters, 1 critic, the rest verifiers. Enforced by a PreToolUse hook |
| Reconnaissance | Four baseline reconnaissance calls | One combined recon agent, cached per commit; later runs only do a delta recon |
| Critic | Reads coverage and source in waves, repeated until a clean pass | One critic that reads only the ledger, surface map and scope log (no source) |
| Verification | Separate candidate validation and final record verification (`standard`, `deep`) | Merged into one step, as in upstream `quick`. High/critical candidates get one verifier each; the rest go to one cheap batch verifier |
| Bookkeeping | The parent writes large JSON ledgers by hand | `scripts/ledger-tool.cjs` handles coverage IDs, status changes and building `findings.json` |
| File reading | Whole-file reads allowed | Search first, then read targeted line ranges only. Whole large files are never read |
| Nested agents / background work | Allowed | Disabled. No nested agents, no ScheduleWakeup, cron or background tasks |
| Output format | `coverage-ledger.json`, `findings.json`, `REPORT.md` | Same format, same validators, same `report-schema.json` |
| Evidence bar | `confirmed` needs proof | Unchanged. Because target code is never executed, almost everything is `needs_validation` |

The sizes above are file sizes of the instruction files in each repo, not measured
token counts. Real consumption depends on the target.

### Trade-offs

Lean means less coverage depth. Expect:

- Partial coverage on large targets, with unreached work marked `deferred` and
  disclosed in the report rather than hidden.
- No dynamic validation. Findings are source-based; most need follow-up validation.
- Fewer independent passes than upstream `standard` or `deep`. If you need
  maximum assurance on a high-stakes target, use the upstream skill.

## Output comparison with upstream

Based on reading the instruction files of both skills, not on comparing real runs.

| Aspect | Upstream (`security-audit` @ c1c8a8c) | Lean (`security-audit-lean`) |
|---|---|---|
| Deliverables | `run-metadata.json`, `architecture.md`, `coverage-ledger.json`, `findings.json`, `REPORT.md`, `FINDINGS-DETAIL.md`, `NEEDS-VALIDATION.md`, plus promoted `agents/<id>/artifacts/` | Same seven files, plus `inventory.md`, `scope-log.md`, `surface-map.json`, `ledger-spec.json` and `agents/<id>/result.json`. No `artifacts/` |
| Reconnaissance | 4 parallel agents (1a-1d), plus more for distinct subsystems | 1 combined agent ("broad and shallow", about 30 tool calls), cached per commit |
| Ledger unit | surface x boundary x subsystem x class; `quick` merges subsystems; `deep` adds lifecycle modes | surface x boundary x real subsystem (5 at most) x class. Recon emits no lifecycle units |
| Profiles | `quick` / `standard` / `deep` | One flow, close to `quick`; `subsystem=<ref>` mode |
| Critic | Reads source; repeats waves until a clean final critic (`standard`/`deep`) | One critic that reads only the ledger, surface map and scope log. Gaps become `deferred` |
| Unreached work | Reported as `deferred`, `out_of_scope` or `incomplete`; failed hunter units go back to `planned` | Same states; failed or missing hunter units become `deferred`. Hard cap of 10 agents |
| `confirmed` | Needs a bounded observed result, from a sandboxed local run when the sandbox is available | Only for deterministic read-only repository facts (for example `git ls-files`) |
| Verification | A fresh verifier per candidate (Phase 3), then a fresh verifier per record (Phase 5); material changes get another fresh verifier | One merged pass. High/critical or proposed-`confirmed` candidates get their own verifier (up to 3 per verifier when slots run short); all others share one batch verifier (2-4 tool calls each) |
| Prior runs | All compatible runs | Newest run only |

**What you keep**
- `report-schema.json`, `validate-findings.cjs`, `validate-coverage-ledger.cjs`, `ATTACK-CLASSES.md` and the ten companion class files are byte-identical to upstream (checked with `cmp`).
- The same verdicts, candidate gate, report sections (`reference/RECORDS.md`) and adapted hunter method. Every candidate gets a verifier that did not hunt it, and unvalidated candidates stay out of `findings.json`.

**What you give up**
- Severity on most real findings. Code-level bugs (injection, authz bypass, memory safety, races) cannot reach `confirmed` without execution. They land in `needs_validation` with no severity, so `FINDINGS-DETAIL.md` (confirmed medium+ only) will often be empty. This follows from the rules; it was not measured.
- A second, independent record check, and the re-check of material changes.
- Discovery of entry points that recon missed. The critic cannot see source.
- Depth: each hunter has about 30 tool calls per subsystem, so expect more `blocked`/`deferred` units (inferred). The batch verifier can leave medium/low candidates `unchecked`.
- Lifecycle-mode coverage and guidance mode. The validators check format only, so they cannot show which run went deeper.

**When to use which**
- **Lean:** a cheap first pass, recurring per-subsystem passes, or triage into `NEEDS-VALIDATION.md`. Also fine with no OS sandbox: upstream then cannot run target code either, so its leads also become `needs_validation` (upstream `SKILL.md`).
- **Upstream `standard`/`deep`:** high-stakes or large targets that need severity-rated `confirmed` findings with local reproduction, two verification passes, and a clean coverage claim from a critic that reads source.

## What changed vs. upstream

- **Same evidence bar and format.** `coverage-ledger.json`, `findings.json`,
  `REPORT.md`, `FINDINGS-DETAIL.md` and `NEEDS-VALIDATION.md` match upstream. The
  validators and `report-schema.json` are unchanged.
- **Fixed agent budget.** At most 10 agents. A PreToolUse hook
  (`scripts/agent-cap.sh`) enforces the cap. It also blocks background agents and
  any agent type other than `sec-lean-*`. Work that does not fit is marked
  `deferred`.
- **No nested agents.** The agent definitions do not have the Agent tool.
  Explore, Plan, general-purpose and fork are denied in settings.
- **Everything runs in the foreground.**
- **Search first, read targeted.** Agents use Grep/Glob or `rg`, then read only
  selected lines with offset/limit. `rg-lean.conf` excludes `secrets*.yaml`,
  `.env*` and key files.
- **The parent does the inventory.** `scripts/inventory.cjs` reads only file names
  from git, then ONE combined recon agent starts.
- **Recon is cached per commit** under `<root>/recon-cache/<repo>/<commit>/`. When
  the source changes, only a delta recon runs.
- **Scripted bookkeeping** via `scripts/ledger-tool.cjs`.
- **Verification by priority.** High/critical or proposed-`confirmed` candidates
  each get an independent verifier; the rest go to a cheap batch verifier.
  Upstream Phase 5 is merged into Phase 3, as in upstream `quick`.
- **Source only.** The target code is never run, so nearly everything is
  `needs_validation`. `confirmed` is used only for deterministic read-only
  observations, such as a tracked key file.
- **Single-subsystem mode.** With `Mode: subsystem=<ref>` one subsystem is audited
  at a time.

## Files

- `SKILL.md`: the orchestration.
- `agents/sec-lean-*.md`: the five agent definitions.
- `classes/`: upstream's attack classes, unchanged.
- `reference/`: ledger and report rules.
- `scripts/`: validators, ledger tool, inventory and the hook.
- `templates/`: settings template and an example scope file.
- `NOTICE`: which files are copied unchanged, excerpted, or new.

## Installation

```sh
git clone https://github.com/jensabrahamsson/security-audit-lean ~/kod/security-audit-lean
ln -s ~/kod/security-audit-lean ~/.claude/skills/security-audit-lean
mkdir -p ~/.claude/agents
for a in recon hunter critic verifier batch-verifier; do
  ln -s ~/kod/security-audit-lean/agents/sec-lean-$a.md ~/.claude/agents/sec-lean-$a.md
done
```

Restart Claude Code after `~/.claude/agents/` has been created, then check with
`/agents` that `sec-lean-*` shows up.

## Running

```sh
SRC="$HOME/kod/security-audit-lean"
TARGET="$HOME/kod/<repo>"            # the repo to audit
ROOT="$HOME/sec-audits"              # all runs + recon cache
RUN="$ROOT/<repo>/$(date +%Y%m%d-%H%M)"
mkdir -p "$RUN"
sed -e "s|__TARGET__|$TARGET|g" -e "s|__ROOT__|$ROOT|g" -e "s|__SKILL__|$SRC|g" \
  -e "s|__LINK__|$HOME/.claude/skills/security-audit-lean|g" \
  "$SRC/templates/settings.template.json" > "$RUN/settings.json"

cd "$TARGET" && claude -p --model opus --settings "$RUN/settings.json" \
  --add-dir "$ROOT" --add-dir "$SRC" \
  --output-format stream-json --verbose \
  "Use the security-audit-lean skill. Target: $TARGET. Output: $RUN. Scope: none. Mode: full" \
  > "$RUN/run.jsonl"
```

- **One subsystem:** replace `Mode: full` with `Mode: subsystem=services/api`.
- **Scope file:** copy `templates/scope.example.md`, edit it, and pass its path
  after `Scope:`.
- **Interactive:** run `claude --model opus --settings "$RUN/settings.json" --add-dir "$ROOT" --add-dir "$SRC"`
  and type the same instruction.
- **Custom guards:** add your own `Read(...)` deny rules for sensitive paths in
  your copy of the settings.

## Model choice

- **Default:** all agents run `model: opus` with `effort: high`. The main session
  runs `--model opus` with `modelSettings` high.
- **Cheaper hunters:** change one line, `model: opus` to `model: sonnet` (or
  `claude-sonnet-5-5`), in `agents/sec-lean-hunter.md`. Recon, critic and
  verifiers stay on Opus.
- **Do not set** `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` or `CLAUDE_CODE_EFFORT_LEVEL`.
  They override the frontmatter.

## Expected cost (ESTIMATE)

The estimate is based on Opus 5.5 pricing ($4/$20 per M in/out, cache read
$0.20/M) and on the outcome of an aborted upstream run. It is not measured.

- **Full run, all Opus:** roughly **$12–25**. Upstream `quick` was estimated at
  $45–90.
- **One subsystem per run:** roughly **$3–6**, less with a cached recon.
- **Sonnet hunters, otherwise Opus:** roughly **$8–16** for a full run.

Actual cost is in `run.jsonl` (`total_cost_usd` on the last line).

## Uncertainties

- Mid-string wildcards in Bash rules (e.g. `Bash(rg *--pre*)`) and the `Agent`
  matcher for the hook follow the documentation but were not test-run on 2.1.308.
- Whether symlinked skills and agents load correctly is untested. Check with
  `/agents` and `/skills`.
- `rg` globs apply during traversal. A file named explicitly is still searched,
  which is why Read-deny rules and agent rules exist as well.
- `maxTurns` counts agent turns, not exact tool calls.
- `--settings` is merged with `~/.claude/settings.json`, so broad allow rules
  there apply too.

## License

MIT. This is a derivative work of
[cloudflare/security-audit-skill](https://github.com/cloudflare/security-audit-skill)
@ c1c8a8c, Copyright (c) 2025-2026 Cloudflare, Inc., used under the MIT License.
The upstream copyright and permission notice are retained in [`LICENSE`](LICENSE),
and [`NOTICE`](NOTICE) lists which files are unchanged, excerpted or new.
Modifications: Copyright (c) 2026 Jens Abrahamsson, also MIT.
