# Ordler

Task management inside and between departments: Linear-style team work plus
service-portal requests with cross-department approval chains.

- [Technical specification](docs/SPEC.md)
- [Architecture decisions](docs/adr/)
- [Changelog](.ai/changelog/)
- [Product and architecture map (Miro)](https://miro.com/app/board/uXjVEaKDHrU=/)

Status: Phase 1 in progress — foundation, setup wizard and sign-in (password, email OTP, Google).

## Development

Requirements: Node.js 24 (see `.nvmrc`), pnpm via Corepack (`corepack enable`), PostgreSQL 18+.

```bash
pnpm install
pnpm test        # unit tests in every package
pnpm typecheck
pnpm lint
pnpm build
```

| Package           | Purpose                                                                 |
| ----------------- | ----------------------------------------------------------------------- |
| `packages/shared` | Permission catalog, system roles, RBAC resolution, locales, Zod schemas |
| `apps/api`        | NestJS + Fastify API, Drizzle schema and migrations, health checks      |
| `apps/web`        | React SPA shell with i18n (en, ru, de, az)                              |

Run locally (API on :3000, web on :5173 with `/api` proxied to the API):

```bash
export DATABASE_URL=postgres://ordler:ordler@localhost:5432/ordler
export ENCRYPTION_KEY=$(openssl rand -base64 32)
export BASE_URL=http://localhost:5173
pnpm build && pnpm --filter @ordler/api start
```

```bash
pnpm --filter @ordler/web dev
```

Open http://localhost:5173 — a fresh database shows the setup wizard, which creates the first
Owner. Email OTP needs `SMTP_HOST` and `SMTP_FROM`; Google sign-in is configured through
`/api/admin/auth/strategies/google` (admin UI comes later).

## License

[AGPL-3.0](LICENSE)
