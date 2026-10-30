import { z } from 'zod';
import type { IssueSummary, MemberRef } from './issues.js';

/** Projects (SPEC §5.2). */
export const PROJECT_STATUSES = [
  'planned',
  'in_progress',
  'paused',
  'completed',
  'canceled',
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_HEALTH = ['on_track', 'at_risk', 'off_track'] as const;
export type ProjectHealth = (typeof PROJECT_HEALTH)[number];

const dateSchema = z.iso.date().nullable();

const unique = (ids: string[]) => [...new Set(ids)];

// Field rules without defaults, so a partial update never resets what it leaves out.
const projectFields = {
  name: z.string().trim().min(1).max(120),
  description: z.string().max(100_000),
  status: z.enum(PROJECT_STATUSES),
  leadId: z.uuid().nullable(),
  startDate: dateSchema,
  targetDate: dateSchema,
  teamIds: z.array(z.uuid()).min(1).max(20).transform(unique),
  memberIds: z.array(z.uuid()).max(200).transform(unique),
};

export const projectInputSchema = z.object({
  ...projectFields,
  description: projectFields.description.default(''),
  status: projectFields.status.default('planned'),
  leadId: projectFields.leadId.default(null),
  startDate: dateSchema.default(null),
  targetDate: dateSchema.default(null),
  memberIds: z.array(z.uuid()).max(200).default([]).transform(unique),
});
export type ProjectInput = z.input<typeof projectInputSchema>;
export const updateProjectSchema = z
  .object(projectFields)
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'empty_update');

export const milestoneInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  targetDate: dateSchema.default(null),
});

export const projectUpdateInputSchema = z.object({
  health: z.enum(PROJECT_HEALTH),
  body: z.string().trim().min(1).max(20_000),
});

export interface ProjectRef {
  id: string;
  name: string;
  status: ProjectStatus;
}

export interface ProjectProgress {
  /** Issues in the project, canceled ones left out of the scope. */
  total: number;
  started: number;
  completed: number;
}

export interface ProjectSummary extends ProjectRef {
  lead: MemberRef | null;
  teams: Array<{ id: string; key: string; name: string }>;
  startDate: string | null;
  targetDate: string | null;
  progress: ProjectProgress;
  /** Health of the latest status update, if any. */
  health: ProjectHealth | null;
  updatedAt: string;
}

export interface MilestoneView {
  id: string;
  name: string;
  targetDate: string | null;
  progress: ProjectProgress;
}

export interface ProjectUpdateView {
  id: string;
  author: MemberRef | null;
  health: ProjectHealth;
  body: string;
  createdAt: string;
}

export interface ProjectDetail extends ProjectSummary {
  description: string;
  members: MemberRef[];
  milestones: MilestoneView[];
  updates: ProjectUpdateView[];
  /** Only issues of teams the viewer can read. */
  issues: IssueSummary[];
  can: { edit: boolean; post: boolean };
}

// ---------------------------------------------------------------------------------------------
// Initiatives (SPEC §5.2)
// ---------------------------------------------------------------------------------------------

export const INITIATIVE_STATUSES = ['planned', 'active', 'completed'] as const;
export type InitiativeStatus = (typeof INITIATIVE_STATUSES)[number];

const initiativeFields = {
  name: z.string().trim().min(1).max(120),
  description: z.string().max(100_000),
  status: z.enum(INITIATIVE_STATUSES),
  ownerId: z.uuid().nullable(),
  targetDate: dateSchema,
};

export const initiativeInputSchema = z.object({
  ...initiativeFields,
  description: initiativeFields.description.default(''),
  status: initiativeFields.status.default('planned'),
  ownerId: initiativeFields.ownerId.default(null),
  targetDate: dateSchema.default(null),
});
export type InitiativeInput = z.input<typeof initiativeInputSchema>;
export const updateInitiativeSchema = z
  .object(initiativeFields)
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'empty_update');
export const initiativeProjectsSchema = z.object({
  projectIds: z
    .array(z.uuid())
    .max(100)
    .transform((ids) => [...new Set(ids)]),
});

export interface InitiativeSummary {
  id: string;
  name: string;
  status: InitiativeStatus;
  owner: MemberRef | null;
  targetDate: string | null;
  /** Worst health among its live projects' latest updates (SPEC: on track / at risk / off track). */
  health: ProjectHealth | null;
  progress: ProjectProgress;
  projectCount: number;
  updatedAt: string;
}

export interface InitiativeDetail extends InitiativeSummary {
  description: string;
  /** Only projects the viewer can see. */
  projects: ProjectSummary[];
  can: { edit: boolean };
}
