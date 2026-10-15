# Admin panel

- Date: 2026-10-15
- Area: shared, api, web, docs
- Spec: §3, §4, §8, §8.1, §16.5

## Summary

First version of the administration area: departments and teams, members with one-time
invite links, roles per scope and team membership, sign-in methods and updates. Invitees
accept through `/invite/<token>`. Follows
[2026-10-15-local-dev-and-schema-fix](2026-10-15-local-dev-and-schema-fix.md).

## Changes

- `packages/shared/src/admin.ts` — admin schemas, error codes and response types.
- `apps/api`
  - Migration `0003_member_invites` (SHA-256 token hashes, 7-day expiry, single use).
  - `OrgService` + `AdminOrgController`: list, create, rename and archive departments; create,
    update and archive teams; audit entries; unique team keys and department names.
  - `AdminMembersService` + `AdminMembersController`: list, invite (localized email when SMTP
    is set, link always returned), re-invite, accept, (de)activate with session revocation,
    assign/remove roles at organization/department/team scope, team membership. Guards:
    only Owners grant or remove the Owner role, at least one active Owner remains, no
    self-deactivation.
  - `InvitesController` (public, rate-limited): peek and accept.
  - `db:generate` forwards arguments to drizzle-kit (`--name` works again).
- `apps/web`
  - `router.tsx` — History API navigation (`navigate`, `usePathname`, `Link`).
  - `admin/*` — admin page with permission-filtered sections; departments, members, sign-in
    methods, updates.
  - `auth/AcceptInvitePage.tsx`; AuthGate routes `/invite/<token>`.
  - Sidebar "Administration" link for administrators; translations in en/ru/de/az.
  - `vite.config.ts` — `ORDLER_API_URL` to point the dev proxy at another API port.
- README (admin feature and screenshots), SPEC data model.

## Tests

- API: `members/admin.http.test.ts` (15) — CRUD, duplicates, archived departments, invite
  lifecycle, re-invite, initial role and teams, scoped roles, owner-only, last owner,
  deactivation ends sessions, team membership in `/api/me`, 403s for members, department
  admins limited to their department, audit. Invite email template test.
- Web: router (3), AdminPage (4), DepartmentsSection (5), MembersSection (6), AuthSection (5),
  UpdatesSection (3), AcceptInvitePage (3), AuthGate invite route, sidebar admin link.

## Notes

- Found during browser verification and fixed: hints inside `<label>` polluted field names
  for screen readers (now `aria-describedby`); inviting with a team-scoped role did not add
  the person to that team.
- Department admins can manage their own teams through the API, but the admin UI is shown
  only for organization-level permissions for now.
