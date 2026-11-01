# Records and reports (lean reference)

Do not read `scripts/report-schema.json`; this file states what it enforces.
Read only the section you need (`rg -n '^## ' RECORDS.md`, then offset/limit).

## Field rules (from report-schema.json; additionalProperties is false everywhere)

Common to all verdicts:
- `fingerprint`: matches `^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$`; source-derived root-cause
  identity; no line, wave, agent, severity or verdict in it. Same root cause -> same
  fingerprint in every state.
- `title`, `description`: nonempty visible text.
- `trace`: nonempty array of unique `{kind, file, line, scope, description}`;
  `kind` in `entrypoint|propagation|sink`; multi-entry traces start with `entrypoint`,
  end with `sink`, `propagation` only between; `file` repo-relative; `line` integer >= 1.
- `evidence`: nonempty array of unique `{file, line, description}`.

`confirmed` requires exactly: `verdict, fingerprint, title, description, root_cause,
intended_behavior, trace, evidence, conditions, execution, remediation, severity,
confidence`.
- `conditions`: array of `{kind, description}`, kind in `authentication_level,
  authorization_role, user_interaction, system_configuration, network_routing,
  environmental_dependency, data_state, timing_dependency, third_party_dependency`.
- `execution`: `{attacker_perspective, payloads:[>=1 string], instructions:[>=1],
  observed_result}` (observed_result is the actual observed output).
- `remediation`: `{strategy, code_changes?:[{file_name, fixed_code}]}`.
- `severity`: `{likelihood:{score,reason}, impact:{score,reason}, overall_severity}`,
  scores in `informational|low|medium|high|critical`.
- `confidence`: `{score: low|medium|high, reason}`.

`needs_validation` requires exactly: `verdict, fingerprint, title, description,
claimed_root_cause, trace, evidence, blockers:[>=1 string], validation_plan:{local?,
deployment?}` (at least one plan field). No severity/execution/remediation/reason.

`rejected` requires exactly: `verdict, fingerprint, title, description,
claimed_root_cause, trace, evidence, reason`.

Lean wrapper fields (`proposed_verdict`, `priority_hint`, `coverage_ids`) never appear
in findings.json; `ledger-tool.cjs findings` strips them.

## Upstream text (verbatim excerpts, cloudflare/security-audit-skill @ c1c8a8c, VALIDATION-AND-REPORTING.md)

Lean differences: Phase 5 is merged into Phase 3 (as upstream does for `quick`);
validators live in `<skill-dir>/scripts/`; lean runs are source-only.

### Phase 4: Write and validate `findings.json`

The parent writes all independently decided records to `<output-dir>/findings.json`, sorted by fingerprint. Include:

- `confirmed`: source-grounded vulnerabilities with complete local execution evidence, conditions, specific remediation, likelihood/impact/overall severity, and confidence.
- `needs_validation`: source-grounded candidates with an exact unresolved blocker and at least one applicable local or owner-observed deployment plan.
- `rejected`: source-grounded candidates disproved during validation, retained so future runs do not repeat the unsupported claim without changed evidence.

Read `report-schema.json` immediately before writing. It uses `additionalProperties: false`; do not carry hunter wrapper fields into a record. Keep these verdict contracts distinct:

- A `confirmed` record uses `root_cause`, `intended_behavior`, `conditions`, `execution`, `remediation`, `severity`, and `confidence`. It must not use `claimed_root_cause`, `blockers`, `validation_plan`, or `reason`. `execution` is target-neutral and uses the target's native interface: API/HTTP input, CLI call, library call, message, file fixture, browser action, rendered policy, or local harness as applicable. `observed_result` is nonempty and factual.
- A `needs_validation` record uses `claimed_root_cause`, `trace`, `evidence`, `blockers`, and at least one nonempty `validation_plan.local` or `validation_plan.deployment` field. Include both only when both contexts can resolve distinct facts. It must not use severity, execution, remediation, reason, or confirmed root cause.
- A `rejected` record uses `claimed_root_cause`, `trace`, `evidence`, and `reason`. It must not use severity, execution, remediation, blockers, validation plan, or confirmed root cause.

Every record has a stable fingerprint, title, description, and repository-relative source paths. A multi-step trace begins with `entrypoint`, ends with `sink`, and uses `propagation` only between them. One-entry traces use `entrypoint` or `sink`. Overall severity cannot exceed demonstrated impact.

Run:

```sh
node <skill-dir>/validate-findings.cjs <output-dir>/findings.json
node <skill-dir>/validate-coverage-ledger.cjs <output-dir>/coverage-ledger.json
```

Fix every structural and semantic error before continuing. The findings validator rejects input beyond 5 MiB, 1,000 top-level findings, or 64 nesting levels, and caps reported error output at 100 messages. Validator success proves format and ledger consistency only.


## Reports

### Phase 6: Produce target-neutral reports from final records

Only after Phase 5 passes for every record retained in `findings.json`, derive prose from the final records, the ledger, and the hunter `hardening` notes retained in ledger bookkeeping. An incomplete run may report independently verified records, but it must identify each unresolved ledger candidate and must not present it as a finding. The prose files never change a verdict, severity, blocker, or demonstrated impact.

#### `REPORT.md`

Write:

1. Run profile, scope, budget (if set) with agents spent versus planned, source ref, sandboxed source-and-local-only execution statement, prior-run use, and explicit deferred and out-of-scope coverage. Name carried same-source confirmations and changed-source revalidations. A `quick`, scoped, budget-limited, or incomplete run states plainly that it is a partial pass. If candidate validation exhausted a strict budget, state that the run is incomplete and list every unvalidated fingerprint and linked unit; do not describe those candidates as findings. If the budget prevented a mandatory critic, state which critic did not run and make no clean-coverage claim.
2. One short security posture summary.
3. A confirmed-findings table: severity, title, affected boundary, and one-line observed result.
4. Each confirmed finding: repository source location, lower-trust principal, target-native bounded reproduction, conditions, actual result, impact, priority rationale, and smallest source fix.
5. A separate `NEEDS VALIDATION` table. Give each lead's title, repository trace, exact blocker, bounded local next step, and safe owner-observed deployment check. Do not assign severity or call it a confirmed vulnerability.
6. Separate hardening notes and positive source patterns.
7. Coverage summary from the ledger: covered, candidate, blocked, and deferred counts, plus important exclusions and the final critic result.

Do not describe rejected records as findings. Mention their fingerprints only when they explain a prior disagreement or coverage decision.

#### `FINDINGS-DETAIL.md`

For each confirmed `medium`, `high`, or `critical` record, copy the complete source path and target-neutral local reproduction:

- ordered repository-relative trace and evidence;
- dummy attacker/principal and affected dummy resource;
- native input, invocation, or fixture and exact bounded instructions;
- observed output and the security invariant it proves;
- conditions and containment;
- source-level remediation and regression case.

#### `NEEDS-VALIDATION.md`

For every unresolved record, copy the source trace, verified evidence, exact blocker, affected boundary, and each applicable bounded local or owner-observed resolution plan. Keep these as prioritized leads without severity. Do not turn them into live test guidance or assume the missing deployment fact.

HTTP is one possible native interface, not the default. A library finding may use a function call, a parser a fixture, a CLI a command, a desktop app an IPC or file action, and infrastructure a locally rendered policy. Do not require an endpoint, external account, or live environment that the target does not have.

Keep the report proportional to the evidence. A clean run may have zero confirmed records. State that result and the remaining coverage/validation limits without inventing LOW findings.
