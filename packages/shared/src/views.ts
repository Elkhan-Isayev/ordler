import { z } from 'zod';
import type { MemberRef } from './issues.js';
import { PRIORITIES } from './status.js';

/** Layouts a team's issues can be shown in (SPEC §5.4). */
export const VIEW_LAYOUTS = ['list', 'board', 'timeline'] as const;
export type ViewLayout = (typeof VIEW_LAYOUTS)[number];

const ref = z.string().trim().min(1).max(64);

/** The issue filters a view stores; the same keys the list puts in the URL. */
export const viewFiltersSchema = z
  .object({
    status: ref,
    /** Member id, or `none` for unassigned. */
    assignee: ref,
    priority: z.enum(PRIORITIES),
    label: ref,
    /** Cycle id, or `none` for issues outside any cycle. */
    cycle: ref,
    project: ref,
  })
  .partial()
  .strict();
export type ViewFilters = z.infer<typeof viewFiltersSchema>;

export const viewInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  layout: z.enum(VIEW_LAYOUTS).default('list'),
  filters: viewFiltersSchema.default({}),
  /** Shared views are visible to everyone who can read the team (`view.create_shared`). */
  shared: z.boolean().default(false),
});
export type ViewInput = z.input<typeof viewInputSchema>;

// Without defaults: a field left out of a change must keep its stored value.
export const viewUpdateSchema = z.object({
  name: viewInputSchema.shape.name.optional(),
  layout: z.enum(VIEW_LAYOUTS).optional(),
  filters: viewFiltersSchema.optional(),
  shared: z.boolean().optional(),
});
export type ViewUpdate = z.input<typeof viewUpdateSchema>;

/** A saved view (SPEC glossary "View"): filters and layout over one team's issues. */
export interface SavedView {
  id: string;
  name: string;
  layout: ViewLayout;
  filters: ViewFilters;
  shared: boolean;
  team: { id: string; key: string; name: string };
  owner: MemberRef | null;
  /** Personal views by their owner; shared views by members with `view.create_shared`. */
  canEdit: boolean;
  createdAt: string;
  updatedAt: string;
}
