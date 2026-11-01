# Coverage ledger (lean reference)

Read only the section you need (use `rg -n '^## ' LEDGER.md`, then offset/limit).

## Lean notes

- `scripts/ledger-tool.cjs` computes `coverage_id` (NFC check, RFC 3986 percent
  encoding, `::` join), sorts, rejects duplicates, and performs the state transitions
  `planned -> in_progress -> covered|candidate|blocked` and `-> deferred`. Prefer it to
  hand edits. Run `validate-coverage-ledger.cjs` after every change.
- Lean uses real subsystem refs (one per hunter), not the quick profile's coarse
  `profile/quick/all-in-scope-subsystems` value. Keep the same refs across runs so
  later runs can compare.
- Lean runs never execute target code, so every check is `method: "source"` with
  `artifact: null`. `local` checks only appear if a future run adds a sandbox and the
  upstream promotion procedure.
- Bookkeeping fields added by lean (allowed upstream): `verification` (fingerprint ->
  decision, verifier) on units. `priority_hint` lives only in hunter results.
- No reassignment waves in lean by default: critic gaps become `deferred` units.

## Prior-run input (lean)

Use only the newest prior run for the same repo. For each prior unit or record:
- same source (no change in `git diff --name-only <prior-commit>..HEAD` for its paths):
  `covered` stays visible as `prior_status: "prior_covered_same_source"` and is planned
  last; a prior `confirmed` record is carried as `prior_confirmed_same_source`, its root
  cause goes on the hunters' exclusion list, and a verifier re-checks it;
- changed source: plan it first (`prior_*_changed_source`);
- prior `needs_validation`, `deferred`, `blocked`, `out_of_scope` units: plan as current
  work when now in scope; they are priority input, never suppression keys;
- prior `rejected`: suppresses only that exact claim, not the unit.
Record a missing or incompatible prior ledger instead of treating it as empty coverage.

## Upstream text (verbatim excerpt, cloudflare/security-audit-skill @ c1c8a8c, RECONNAISSANCE.md)

Upstream links such as `ATTACK-CLASSES.md` resolve to `../classes/`, and `<skill-dir>/validate-*.cjs` to `<skill-dir>/scripts/validate-*.cjs` in this skill.

### Architecture summary and companion selection

The parent synthesizes `<output-dir>/architecture.md`, with a hard cap of about 1,000 words. Include:

1. Product, principals, normal authority, and protected resources.
2. The comparable-software baseline from Agent 1a, when one is source-grounded: what security trade-offs the comparable accepts. Use it to calibrate effort and severity, never to dismiss a demonstrated finding; if the comparable shares a defect pattern that has mattered in practice, that strengthens the finding. Omit this line when no meaningful comparable exists.
3. Tech stack, source-visible deployment paths, and offline build/test limits.
4. Entry surfaces and the important source-to-sink or lifecycle paths.
5. Trust boundaries and the strongest source-visible control on each.
6. Repository-relative starting paths.
7. Prior coverage gaps, changed-source and blocked revalidation targets, and same-source confirmed exclusions.
8. A short companion-selection summary derived from [ATTACK-CLASSES.md](ATTACK-CLASSES.md): selected files and the source-visible boundaries that require them.

Keep the assignment-level ordinary block, selected companion blocks, and excluded blocks with reasons in each ledger unit, not in `architecture.md`. This keeps the architecture cap valid for large runs and makes the exact hunter prompt map machine-checkable.

Do not select a companion file merely because the language or dependency name appears. Select it because reconnaissance found the trust-sensitive boundary described by its `When to use this file` section. Do not exclude a visible boundary just because another agent will review a related class.

### Deterministic coverage ledger

The parent writes `<output-dir>/coverage-ledger.json` as a top-level JSON array. Derive one unit for every material combination of entry surface, trust boundary, subsystem, and applicable ordinary or companion attack class at the granularity the run profile sets (`quick` uses one all-in-scope subsystem identity; `deep` adds lifecycle modes). For a scoped run, seed in-scope surfaces for assignment and retain discovered excluded surfaces as `out_of_scope` units so later full runs can turn them into current work.

Each dimension has a human label and a stable source-derived value in `canonical_refs`. Use the same canonical reference for the same source object across runs even if its display label changes. Suitable references include a repository-relative entry path plus exported scope, a route or message identity defined in source, the source control that defines a boundary, a repository package path, and the exact attack-class block reference. A block reference is `FILE.md#` plus the exact class name as written in bold or as a heading in that file — a stable identifier matched against the file text, not a rendered HTML anchor. For companion section blocks, use the heading text before any parenthetical qualifier (for example `Core discipline`). Do not derive references by lowercasing or slugging display labels.

Derive `coverage_id` without lossy slugs:

1. Require every reference to be Unicode NFC with valid scalar values, visible content, no control, format, line/paragraph separator, or default-ignorable code point, and no surrounding whitespace.
2. Encode its UTF-8 bytes with RFC 3986 percent encoding: leave only `A-Z a-z 0-9 - . _ ~` unescaped and use uppercase `%HH` for every other byte.
3. Join encoded `surface`, `boundary`, `subsystem`, and `attack_class` references with `::`; append encoded `lifecycle` when present.

Use the fixed canonical value `profile/quick/all-in-scope-subsystems` for the quick profile's coarsened subsystem dimension. Do not include wave number, agent, verdict, severity, or line number in a reference or ID. Sort units lexicographically by `coverage_id` before each assignment. Fail on every duplicate ID. If duplicate IDs have different semantic fields, treat that as a canonical identity collision; never merge or silently overwrite them. The validator also rejects one semantic tuple represented by different canonical references.

Each unit records:

```json
{
  "coverage_id": "...",
  "canonical_refs": {
    "surface": "src/router.ts#POST /users/:id",
    "boundary": "src/authz.ts#requireOwner",
    "subsystem": "packages/api",
    "attack_class": "ATTACK-CLASSES.md#Access control"
  },
  "surface": "...",
  "boundary": "...",
  "subsystem": "...",
  "attack_class": "...",
  "starting_paths": ["repo/relative/path"],
  "ordinary_attack_class_block": "ATTACK-CLASSES.md#Access control",
  "selected_companion_blocks": ["FILE.md#section"],
  "excluded_blocks": [{"block": "FILE.md#section", "reason": "..."}],
  "prior_status": "new|prior_confirmed_same_source|prior_confirmed_changed_source|prior_needs_validation|prior_deferred|prior_blocked|prior_out_of_scope|prior_covered_same_source|prior_covered_changed_source|prior_rejected_claim_changed|none",
  "attempts": [],
  "wave": 1,
  "status": "planned",
  "agent_id": null,
  "reviewed_paths": [],
  "local_checks": [],
  "result_fingerprints": [],
  "unresolved": []
}
```

When `lifecycle` is material, add both `canonical_refs.lifecycle` and a human `lifecycle` field. `ordinary_attack_class_block` is null only when no ordinary block applies. The selected companion list includes each applicable class plus its companion `Core discipline`, `Universal moves`, and `Validation rules`; `excluded_blocks` records every considered but unselected block and the source fact that excludes it.

The parent may add bookkeeping fields but keeps the semantic fields above stable. In `prior_status`, `new` marks a surface first seen in this run when compatible prior ledgers exist; `none` marks a unit seeded when no compatible prior ledger is available. Prior `deferred`, `blocked`, `out_of_scope`, and changed-source units initialize as current `planned` work when now in scope. A prior same-source covered unit remains visible in the current ledger; assign changed source, important lifecycle paths, and exact conflicts first, then use the coverage critic to decide whether it needs another pass.

`attempts` is an append-only archive for evidence-bearing assignments that a coverage critic reopens. Before reassignment, append the prior unit's exact `wave`, `status`, `agent_id`, `reviewed_paths`, `local_checks`, `result_fingerprints`, and `unresolved`, plus the critic's source-backed `reassignment_reason`. Only `blocked`, `covered`, and `candidate` states can be archived. Archived attempts retain the same state and evidence invariants as live units, use strictly increasing waves below the current wave, and retain their producing owners and artifacts. The next assignment increments `wave`, uses a fresh owner, and starts with empty live evidence. If the profile or budget prevents another assignment, increment `wave` and use live `deferred` state with null owner, empty evidence, and the stop reason. Never copy an archived owner's checks or artifacts into the live state. A later live terminal state contains only the new attempt's evidence; the archive remains unchanged.

Enforce this state table exactly:

| Status | Unit `agent_id` | `reviewed_paths` / `local_checks` | `result_fingerprints` | `unresolved` |
|---|---|---|---|---|
| `planned` | null | empty | empty | empty |
| `not_applicable`, `out_of_scope`, `deferred` | null | empty | empty | nonempty reason |
| `in_progress` | canonical owner | empty | empty | empty |
| `blocked` | canonical owner | both nonempty owned partial evidence | empty | nonempty blocker |
| `covered` | canonical owner | both nonempty | empty | empty |
| `candidate` | canonical owner | both nonempty | nonempty | optional |

Canonical agent IDs match `^[a-z0-9][a-z0-9_-]{0,63}$` and are not Windows device names. Lowercase is mandatory, so one ledger cannot contain case-fold aliases. The unit `agent_id` records the assignment owner. Every check records its own `agent_id` and nonempty `reviewed_paths`; the unit-level `reviewed_paths` is exactly their union. A source-only check uses `artifact: null`. A local check requires a regular file promoted only by trusted parent-side code under exactly `agents/<check.agent_id>/artifacts/`. This lets hunter and verifier checks coexist in one unit. Scratch paths, output-root files, symlinks, special files, and another check owner's artifacts are not evidence.

The ledger is the coverage claim. An architecture summary, agent count, or generic "auth reviewed" sentence is not coverage evidence. Phase 2 closes units only from the paths and checks in a hunter's structured result.

Run `node <skill-dir>/validate-coverage-ledger.cjs <output-dir>/coverage-ledger.json` after seeding, after every parent update, and before Phase 6. The validator rejects input beyond 5 MiB, 64 nesting levels, 10,000 units, 1,000 entries in a nested collection, or 500,000 traversed values, and caps reported validation errors at 100. In practice the 5 MiB byte limit holds roughly 2,000-5,000 realistic units, so it binds before the 10,000-unit cap. Fix every error before assigning work or making a coverage claim.

