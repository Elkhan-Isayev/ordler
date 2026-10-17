# Docker image, Compose and Helm chart

- Date: 2026-10-17
- Area: infra, api, docs
- Spec: §16.1, §16.4; ADR 0006

## Summary

Ordler ships as one container image with the API and the built web app on port 3000. With an
empty PostgreSQL 18 database it starts the install page, so Compose and Helm installs need no
database variables; Helm can also take the database from values for several replicas.

## Changes

- `Dockerfile`, `.dockerignore` — multi-stage build (pnpm deploy), non-root user, `/data`
  volume, health check, version build argument.
- `deploy/docker-compose.yml` — Ordler plus an optional bundled PostgreSQL 18 profile.
- `deploy/helm/ordler` — Deployment, Service, Ingress, Secret (generated, kept encryption
  key), PVC, CA ConfigMap; install-page mode forces one replica with persistence.
- `.github/workflows/ci.yml` — image build with installer smoke test, Helm lint and render.
- `.github/workflows/release.yml` — multi-arch image and OCI chart to GHCR on version tags.
- `apps/api/src/config/env.ts` — empty variables count as unset (Compose `VAR=`).
- `apps/api/src/install/installer.ts` — `/readyz` is ready while installing, so Kubernetes
  routes traffic to the install page.
- `docs/install.md`, `README.md`, `docs/SPEC.md` — install, backup and upgrade guide.

## Tests

- `apps/api/src/config/env.test.ts` — empty variables.
- `apps/api/src/install/installer.test.ts` — installer readiness.
- Verified locally: image build, Compose with bundled PostgreSQL 18 through the install page
  and setup wizard, restart reuses saved settings, health check, read-only root filesystem.

## Notes

Helm templates were not rendered locally (no helm binary); the CI `helm` job lints and renders
both modes. The GHCR package must be made public once after the first release.
