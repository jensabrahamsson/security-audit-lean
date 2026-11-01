---
name: security-audit-lean
description: Token-lean, source-only security audit of a repository with a fixed agent budget (1 recon, up to 5 hunters, 1 ledger-only critic, independent verifiers; max 10 agents). Produces coverage-ledger.json, findings.json and REPORT.md in the Cloudflare security-audit format. Use when asked to run a lean security audit/review, optionally of one subsystem at a time.
---

# Security audit (lean)

Derived from cloudflare/security-audit-skill @ c1c8a8c (MIT, see LICENSE and NOTICE).
Same evidence bar and output formats; leaner orchestration. `<skill-dir>` below is the
base directory of this skill as reported when it was loaded.

## Inputs (from the user's prompt)

- `Target`: repository root (normally the working directory).
- `Output`: run directory `<out>` = `<root>/<repo-name>/<run-id>` (outside the target).
  `<root>` holds all runs and the recon cache.
- `Scope`: optional scope file (see `templates/scope.example.md`). Without one, scope is
  the attack surface found in Phase 0/1.
- `Mode`: `full` (default) or `subsystem=<subsystem ref>` (one subsystem per run).
- `Hunter model` is NOT chosen here; it lives only in `sec-lean-hunter.md` frontmatter.

## Non-negotiable run rules

1. Source-only. Never build, test, install or execute target code; never use the network.
   Allowed shell: `rg`, `git ls-files|rev-parse|log|status|diff --name-only`, `ls`, `wc`,
   `mkdir`, and `node <skill-dir>/scripts/*.cjs`. No pipes into other tools. Never read, search or quote
   `secrets*.yaml`, `.env*`, `*.env`, keys or certificates, and never copy a secret value
   into any output; describe it as `<redacted>`.
2. Foreground only. Every Agent call runs in the foreground (never `run_in_background`).
   Never use ScheduleWakeup, cron, Monitor or "check back later". Do not end your turn
   until REPORT.md is written or you stop with an explicit incomplete report.
3. Only these subagent types: `sec-lean-recon`, `sec-lean-hunter`, `sec-lean-critic`,
   `sec-lean-verifier`, `sec-lean-batch-verifier`. Never Explore, Plan, general-purpose
   or fork. Never pass a `model` parameter to Agent (frontmatter decides the model).
4. Hard cap: 10 agents per run including recon, critic and verifiers (a hook enforces
   it). About 30 tool calls per agent (frontmatter `maxTurns`). Work that does not fit
   is marked `deferred` in the ledger with the reason; never silently dropped.
5. Search before reading. Use Grep/Glob if available, otherwise `rg`
   (`rg -n`, `rg -l`, `rg -c`, `rg --files`). Read only targeted ranges with
   `offset`/`limit` (normally <= 120 lines). Never read a whole file over ~300 lines,
   never re-read a range you already have, never read lockfiles, minified, vendored or
   generated files.
6. Do not read the validator scripts or `report-schema.json` into context; run them.
   Use `reference/RECORDS.md` for field rules.

## Budget plan (default, full mode)

| Slot | Agents | Notes |
|---|---|---|
| Recon | 1 | 0 when the recon cache for this commit exists |
| Hunters | <= 5 | one per subsystem, parallel, foreground |
| Critic | 1 | reads only the ledger and surface map |
| Verifiers | the rest (>= 2) | high/critical: own verifier each; others: one batch verifier |

Subsystem mode: recon (or cache) + 1 hunter (2 if the subsystem is large) + critic +
verifiers; normally 4-6 agents.

Before every Agent launch, count launched agents. Reserve at least 1 critic slot and
2 verifier slots before launching hunters.

## Phase 0 - parent inventory (no agents, ~10 tool calls)

1. `node <skill-dir>/scripts/inventory.cjs <target>` (one call: commit, dirty count,
   dir/extension counts, manifests, default exclusions; file names only).
2. Recon cache: `<root>/recon-cache/<repo-name>/<commit>/` (`ls` it; create with mkdir).
   - Exists -> reuse `architecture.md` and `surface-map.json`; skip Phase 1.
   - An older commit exists -> reuse it, run `git -C <target> diff --name-only <old>..HEAD`
     and pass only changed paths to recon as a delta task.
3. Read the scope file if given (it overrides default exclusions only where explicit).
4. Entry-point and sink hints with `rg -l`/`rg -c` (routes, handlers, CLI parsers,
   message consumers, deserialization, SQL/ORM raw queries, shell/exec, file paths,
   templates, crypto, authz decorators/middleware, webhooks, IaC/CI). Keep it to ~6 rg
   calls.
5. Exclusions, logged to `<out>/scope-log.md` with path globs and counts: tests,
   fixtures, docs, examples, generated, vendored, build output, lockfiles, migrations
   data dumps, secrets and env files. A test/doc path stays excluded unless it is
   shipped or reachable at runtime.
6. Write `<out>/inventory.md` (<= 400 words) and `<out>/run-metadata.json`
   (`{"skill":"security-audit-lean","derived_from":"cloudflare/security-audit-skill@c1c8a8c","commit":...,"mode":...,"scope_file":...,"started":...}`).

## Phase 1 - one combined recon agent

Launch exactly one `sec-lean-recon` (id `recon-1`) with: target path, `<skill-dir>`,
`<out>`, the path to `inventory.md`, the scope file path, mode, and (delta runs) the
changed path list. It reads `classes/ATTACK-CLASSES.md` headings itself and writes:

- `<out>/architecture.md` (<= 1000 words, Cloudflare sections 1-8),
- `<out>/surface-map.json` (subsystems, surfaces, boundaries, controls, starting paths,
  proposed units with class/companion selections and exclusions).

Copy both into the recon cache dir for `<commit>` (Write; they are small). Do not
re-verify recon by reading source yourself; spot-check at most 3 claims with `rg`.

## Phase 1b - scope and ledger (parent, no agents)

1. Subsystems follow attack surface and data flow, not directory size: group surfaces by
   shared trust boundary and sink. Max 5 subsystems (merge the smallest). In
   subsystem mode, plan only the chosen one; all others become `deferred` with reason
   `lean subsystem mode: <name> only`.
2. Build `<out>/ledger-spec.json` from `surface-map.json` (format in the header of
   `scripts/ledger-tool.cjs` and `reference/LEDGER.md`): one unit per material
   surface x boundary x subsystem x attack class. Canonical refs are stable source refs;
   class refs are `FILE.md#Exact Heading Or Bold Name`. Out-of-scope surfaces get
   `status: "out_of_scope"` with reason.
3. `node <skill-dir>/scripts/ledger-tool.cjs seed <out>/ledger-spec.json <out>/coverage-ledger.json`
   then `node <skill-dir>/scripts/validate-coverage-ledger.cjs <out>/coverage-ledger.json`.
   Fix errors before continuing. Prior ledgers/findings in `<root>/<repo-name>/*/` (newest
   one only): follow `reference/LEDGER.md` "Prior-run input (lean)".

## Phase 2 - hunters (<= 5, parallel, foreground)

For each subsystem: `ledger-tool.cjs assign <ledger> hunter-<sub> @<subsystem_ref>`
(ids lowercase `[a-z0-9_-]`). Then launch all hunters in ONE message (parallel
foreground calls). Each prompt contains only:

```
Agent id: hunter-<sub>
Target: <target>   Skill dir: <skill-dir>   Output: <out>
Architecture: <out>/architecture.md (read it first)
Assigned coverage IDs (exact): <list, one per line> with for each: surface, boundary,
  starting_paths, ordinary block, selected companion blocks
Exclusions: <same-source confirmed fingerprints from prior runs, if any>
Write your result JSON to: <out>/agents/hunter-<sub>/result.json
```

Do not paste architecture, method, schema or class text into prompts; the agent
definition carries the method and the agent reads blocks itself. When a hunter
returns, run `ledger-tool.cjs apply <ledger> <out>/agents/<id>/result.json` and validate.
A missing or invalid result file: units stay deferred (the tool does that); do not
relaunch unless budget allows. Add `uncovered` entries as new units with
`ledger-tool.cjs add` (status `deferred`, reason `found by <id>; no budget`) unless a slot
is genuinely free.

## Phase 2b - ledger-only critic (1 agent)

Launch `sec-lean-critic` (id `critic-1`) with the ledger, `surface-map.json`,
`scope-log.md` paths and the output path `<out>/agents/critic-1/result.json`. It reads
no source. Its gaps become `deferred` units via `ledger-tool.cjs add` (lean = quick
profile: no second hunting wave unless >= 3 slots remain after verifier reservation; then
at most one gap hunter). Record the critic verdict in `run-metadata.json`.

## Phase 3 - verification (merged with Cloudflare Phase 5, as in `quick`)

Collect candidates from `agents/hunter-*/result.json`, dedupe by fingerprint (same root
cause -> one candidate; keep all linked coverage IDs). Route:

- `proposed_verdict: "confirmed"` or `priority_hint` `high`/`critical`: a fresh
  `sec-lean-verifier` per candidate (id `verifier-<n>`), never the hunter that found it.
  If slots run short, give one verifier at most 3 such candidates from one subsystem,
  still independent of the hunter.
- All other candidates: ONE `sec-lean-batch-verifier` (id `batch-verifier-1`) for all of
  them (split in two only if > 15).
- No slot left: candidate stays only in the ledger, run is `incomplete`, list it in the
  report as unvalidated. It never enters findings.json.

Verifier prompt: agent id, target, skill dir, output path
`<out>/agents/<id>/result.json`, and the path to each hunter result plus the exact
fingerprints to verify. Nothing else (no other verifier's conclusion).

Then: `ledger-tool.cjs verdicts <ledger> <out>/agents/*verifier*/result.json`, validate.

## Phase 4 - findings.json (scripted)

`node <skill-dir>/scripts/ledger-tool.cjs findings <out>/findings.json <out>/agents/*verifier*/result.json`
then run both validators:

```
node <skill-dir>/scripts/validate-findings.cjs <out>/findings.json
node <skill-dir>/scripts/validate-coverage-ledger.cjs <out>/coverage-ledger.json
```

On a validator error, fix the specific record with Edit (read only the failing range).
Do not re-verify records yourself.

## Phase 5 - reports

Write `<out>/REPORT.md`, `<out>/FINDINGS-DETAIL.md` (confirmed medium+ only) and
`<out>/NEEDS-VALIDATION.md` exactly as described in `reference/RECORDS.md` "Reports".
Derive them from findings.json, the ledger summary (`ledger-tool.cjs summary`) and
hunter `hardening` notes. Section 1 must state: lean profile, source-only (no target
execution), scope, mode, commit, agents used vs cap, deferred/out-of-scope coverage,
critic result, and "partial pass" when mode is subsystem, the critic did not run, or
anything is deferred/unvalidated. Update `run-metadata.json` with `finished`, agents
used, and status `complete|incomplete`.

## Evidence bar (unchanged from Cloudflare)

- `confirmed` needs a bounded local observed result. Lean runs never execute target
  code, so `confirmed` is limited to claims whose decisive fact is a deterministic,
  read-only observation of repository state (for example `git ls-files` shows a tracked
  credential file, or a committed config grants the access). Everything else that
  survives review is `needs_validation` with exact blockers and no severity.
- `priority_hint` is lean bookkeeping for routing and ordering only; it is stripped from
  findings.json and never presented as severity.
- A flag is not a finding; a missing best practice with no affected principal is
  hardening. `needs_validation` is never a parking place for speculation.
