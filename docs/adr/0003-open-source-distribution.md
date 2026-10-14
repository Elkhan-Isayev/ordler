# ADR 0003 — Open source license and distribution

- Status: Accepted
- Date: 2026-10-14

## Context

Ordler is self-hosted only. The owner wants the Wiki.js model: fully open source, source on
GitHub, ready-made images on public registries, a Helm chart for Kubernetes.

## Decision

- License the whole project under **AGPL-3.0**, as Wiki.js does. No license keys, paid tiers
  or feature flags tied to licensing.
- Publish images to **GHCR and Docker Hub**, multi-arch, with `X.Y.Z`, `X.Y`, `X` tags;
  sign with cosign and attach a CycloneDX SBOM.
- Publish the Helm chart as an OCI artifact on GHCR and as a Helm repository on GitHub Pages.
- Release from GitHub Actions on `vX.Y.Z` tags.
- Accept contributions under DCO sign-off (pending owner confirmation).

## Consequences

- AGPL §13 obliges anyone offering a modified Ordler over a network to publish their changes,
  which protects the project from closed forks.
- Every dependency must be AGPL-compatible; CI runs a license check.
- The repository is public: no secrets, customer data or internal URLs in code, fixtures,
  tests or docs.
