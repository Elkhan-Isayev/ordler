import { z } from 'zod';

/** Colour theme of the web app (SPEC §5.4); `system` follows the operating system. */
export const THEMES = ['system', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

export function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value);
}

/** PATCH /api/me/preferences: personal settings that follow the member across devices. */
export const mePreferencesSchema = z.object({ theme: z.enum(THEMES) }).strict();
export type MePreferencesInput = z.infer<typeof mePreferencesSchema>;
