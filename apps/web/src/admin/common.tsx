import type { AdminDepartment, AdminRole, ScopeInput } from '@ordler/shared';
import type { TFunction } from 'i18next';
import type { ReactNode } from 'react';

export function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="flex flex-col gap-1">
      <h2 className="text-lg font-semibold text-ink">{title}</h2>
      {subtitle && <p className="text-sm text-ink-muted">{subtitle}</p>}
    </header>
  );
}

export function Panel({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line bg-card p-4 shadow-card">
      {children}
    </div>
  );
}

export const inputClass =
  'rounded-md border border-line bg-card px-3 py-1.5 text-sm text-ink outline-none focus:border-accent';
export const buttonClass =
  'rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60';
export const ghostButtonClass =
  'rounded-md px-2 py-1 text-xs text-ink-muted hover:bg-hover hover:text-ink disabled:opacity-60';

/** System roles are shown in the UI language; custom roles keep their own name. */
export function roleLabel(t: TFunction, role: Pick<AdminRole, 'key' | 'name'>): string {
  return role.key ? t(`admin.roles.${role.key}`, { defaultValue: role.name }) : role.name;
}

/** Every place a role can apply: the organization, each department and each team. */
export function scopeOptions(
  t: TFunction,
  departments: AdminDepartment[],
): Array<{ value: string; label: string; scope: ScopeInput }> {
  const options: Array<{ value: string; label: string; scope: ScopeInput }> = [
    {
      value: 'organization',
      label: t('admin.members.organization'),
      scope: { type: 'organization' },
    },
  ];
  for (const department of departments.filter((d) => !d.archivedAt)) {
    options.push({
      value: `department:${department.id}`,
      label: department.name,
      scope: { type: 'department', id: department.id },
    });
    for (const team of department.teams.filter((tm) => !tm.archivedAt)) {
      options.push({
        value: `team:${team.id}`,
        label: `${department.name} / ${team.name}`,
        scope: { type: 'team', id: team.id },
      });
    }
  }
  return options;
}

export function scopeLabel(
  t: TFunction,
  scope: ScopeInput,
  departments: AdminDepartment[],
): string {
  if (scope.type === 'organization') return t('admin.members.organization');
  for (const department of departments) {
    if (scope.type === 'department' && department.id === scope.id) return department.name;
    const team = department.teams.find((tm) => tm.id === scope.id);
    if (scope.type === 'team' && team) return `${department.name} / ${team.name}`;
  }
  return '—';
}

/** Empties a write-only secret field once saved, so the typed value does not linger. */
export function clearSecretField(form: HTMLFormElement, name: string): void {
  const field = form.elements.namedItem(name);
  if (field instanceof HTMLInputElement) field.value = '';
}
