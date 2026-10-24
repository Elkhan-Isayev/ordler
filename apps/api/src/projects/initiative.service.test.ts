import type { ProjectSummary } from '@ordler/shared';
import { describe, expect, it } from 'vitest';
import { rollUpHealth } from './initiative.service.js';

const project = (
  health: ProjectSummary['health'],
  status: ProjectSummary['status'] = 'in_progress',
) => ({ health, status }) as ProjectSummary;

describe('rollUpHealth', () => {
  it('takes the worst health of running projects', () => {
    expect(rollUpHealth([project('on_track'), project('at_risk')])).toBe('at_risk');
    expect(rollUpHealth([project('off_track', 'completed'), project('on_track')])).toBe('on_track');
    expect(rollUpHealth([project(null)])).toBeNull();
  });
});
