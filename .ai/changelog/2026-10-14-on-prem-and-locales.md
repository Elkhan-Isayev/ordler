# On-prem deployment and launch locales

- Date: 2026-10-14
- Area: docs
- Spec: §1, §11.1, §12, §14, §15, §16

## Summary

Owner decisions: on-premises only (Docker, Kubernetes via Helm, external PostgreSQL such as
AWS RDS), stack from ADR 0001 accepted, launch languages en/ru/de/az. Follows
[2026-10-14-project-bootstrap](2026-10-14-project-bootstrap.md).

## Changes

- `docs/SPEC.md` v0.2 — single-tenant model (no `organization_id`), new §16 Deployment
  (image, Compose, Helm, env config, RDS/TLS, advisory-lock migrations, setup wizard, CLI),
  new §11.1 Localization, MVP acceptance criteria 9–11, updated open questions.
- `docs/adr/0001-tech-stack.md` — Accepted; Redis/BullMQ replaced by pg-boss and
  `LISTEN/NOTIFY`, i18next + ICU added.
- `docs/adr/0002-on-prem-single-tenant.md` — new.
- `CLAUDE.md` — on-prem guidance, four-locale rule, migration invariant.

## Tests

None — documentation only.

## Notes

None.
