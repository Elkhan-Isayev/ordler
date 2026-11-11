import type { WhiteboardPresence } from '@ordler/shared';
import { describe, expect, it, vi } from 'vitest';
import { colorFor, missingFiles, PresenceRoster, SceneSaver, SceneTracker } from './sync.js';

const el = (id: string, version: number, extra: object = {}) => ({
  id,
  version,
  versionNonce: 1,
  isDeleted: false,
  ...extra,
});

/** Runs scheduled callbacks only when the test says so. */
function manualClock() {
  const queue: Array<() => void> = [];
  return {
    schedule: (fn: () => void) => void queue.push(fn),
    async tick() {
      const fn = queue.shift();
      fn?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
    get size() {
      return queue.length;
    },
  };
}

describe('SceneTracker', () => {
  it('reports only elements newer than what the server has', () => {
    const tracker = new SceneTracker();
    tracker.received(4, [el('a', 2), el('b', 1)]);
    expect(tracker.seq).toBe(4);
    expect(tracker.changed([el('a', 2), el('b', 3), el('c', 1)]).map((e) => e.id)).toEqual([
      'b',
      'c',
    ]);
    tracker.received(2, []);
    expect(tracker.seq).toBe(4);
    tracker.forget([el('a', 2)]);
    expect(tracker.changed([el('a', 2)])).toHaveLength(1);
  });
});

describe('SceneSaver', () => {
  it('batches changes, keeps the latest version and sends nothing twice', async () => {
    const clock = manualClock();
    const save = vi.fn(async () => undefined);
    const saver = new SceneSaver(new SceneTracker(), {
      save,
      onFatal: vi.fn(),
      schedule: clock.schedule,
    });
    saver.push([el('a', 1), el('b', 1)]);
    saver.push([el('a', 2), el('b', 1)]);
    expect(clock.size).toBe(1);
    await clock.tick();
    expect(save).toHaveBeenCalledWith([el('a', 2), el('b', 1)]);
    saver.push([el('a', 2), el('b', 1)]);
    expect(clock.size).toBe(0);
  });

  it('retries after a network failure without losing newer edits', async () => {
    const clock = manualClock();
    const save = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('network'), { status: 0 }))
      .mockResolvedValue(undefined);
    const saver = new SceneSaver(new SceneTracker(), {
      save,
      onFatal: vi.fn(),
      schedule: clock.schedule,
    });
    saver.push([el('a', 1)]);
    await clock.tick();
    saver.push([el('a', 2)]);
    await clock.tick();
    expect(save).toHaveBeenLastCalledWith([el('a', 2)]);
    expect(saver.pending).toBe(0);
  });

  it('stops on refusals such as a lost permission', async () => {
    const clock = manualClock();
    const onFatal = vi.fn();
    const saver = new SceneSaver(new SceneTracker(), {
      save: async () => Promise.reject(Object.assign(new Error('forbidden'), { status: 403 })),
      onFatal,
      schedule: clock.schedule,
    });
    saver.push([el('a', 1)]);
    await clock.tick();
    expect(onFatal).toHaveBeenCalledOnce();
    saver.push([el('b', 1)]);
    expect(clock.size).toBe(0);
  });
});

describe('PresenceRoster', () => {
  const presence = (
    clientId: string,
    member: string,
    extra: Partial<WhiteboardPresence> = {},
  ): WhiteboardPresence => ({
    clientId,
    member: { id: member, name: member.toUpperCase() },
    pointer: { x: 1, y: 2, tool: 'pointer' },
    button: 'up',
    selectedElementIds: ['e1'],
    ...extra,
  });

  it('turns pointers into editor collaborators and forgets tabs that left or went silent', () => {
    const roster = new PresenceRoster(1000);
    roster.apply(presence('c1', 'ann'), 0);
    roster.apply(presence('c2', 'ann'), 0);
    roster.apply(presence('c3', 'bob'), 500);
    expect(roster.members().map((m) => m.name)).toEqual(['ANN', 'BOB']);
    expect(roster.collaborators().get('c3')).toMatchObject({
      username: 'BOB',
      pointer: { x: 1, y: 2 },
      selectedElementIds: { e1: true },
      color: colorFor('bob'),
    });
    roster.apply(presence('c1', 'ann', { left: true }), 600);
    expect(roster.prune(1200)).toBe(true);
    expect([...roster.collaborators().keys()]).toEqual(['c3']);
    expect(roster.prune(1300)).toBe(false);
  });
});

describe('missingFiles', () => {
  it('lists images whose file this tab lacks', () => {
    const elements = [
      el('i1', 1, { type: 'image', fileId: 'f1' }),
      el('i2', 1, { type: 'image', fileId: 'f2' }),
      el('i3', 1, { type: 'image', fileId: 'f3', isDeleted: true }),
      el('r', 1, { type: 'rectangle' }),
    ];
    expect(missingFiles(elements, (id) => id === 'f2')).toEqual(['f1']);
  });
});
