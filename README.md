# Ordler

Task management inside and between departments: Linear-style team work plus
service-portal requests with cross-department approval chains.

- [Technical specification](docs/SPEC.md)
- [Architecture decisions](docs/adr/)
- [Changelog](.ai/changelog/)
- [Product and architecture map (Miro)](https://miro.com/app/board/uXjVEaKDHrU=/)

Status: Phase 1 in progress — monorepo foundation (shared RBAC core, API skeleton, web shell).

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

Run the API against a database:

```bash
pnpm build
DATABASE_URL=postgres://ordler:ordler@localhost:5432/ordler pnpm --filter @ordler/api start
```

## License

[AGPL-3.0](LICENSE)
