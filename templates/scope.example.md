# Scope file example (security-audit-lean)

Generic example. Copy it next to your run, edit it, and pass its path as `Scope:`.
All paths are repository-relative. Anything not listed falls back to the skill's
default rules (attack surface first; tests, docs, generated and vendored code excluded).

## Product context (2-5 lines)
A multi-tenant web service with a public HTTP API, a background worker that consumes
a queue, and an admin CLI. Tenants must never read or change each other's data.

## In scope (priority order)
- `services/api/**` - public HTTP API, session and API-key auth
- `services/worker/**` - queue consumer, outbound webhooks
- `packages/auth/**` - shared authn/authz library
- `deploy/**` - container, IaC and CI definitions (config review only)

## Out of scope (logged, not reviewed)
- `web/**` - separate review planned
- `tools/dev/**` - developer-only scripts, not shipped
- `**/migrations/**` - schema history only

## Always excluded (never searched or read)
- `**/secrets*.yaml`, `**/.env`, `**/.env.*`, `**/*.env`, keys and certificates

## Subsystem names (optional; used by `Mode: subsystem=<ref>`)
- `services/api` | `services/worker` | `packages/auth` | `deploy`

## Known accepted risks (do not report again unless the source changed)
- Admin CLI trusts the local operator by design.
