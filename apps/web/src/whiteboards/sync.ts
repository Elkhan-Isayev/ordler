import type { MemberRef, WhiteboardElement, WhiteboardPresence } from '@ordler/shared';

/** The parts of an editor element the sync logic reads; real elements carry much more. */
export interface Versioned {
  id: string;
  version: number;
  versionNonce: number;
  isDeleted: boolean;
  type?: string;
  fileId?: string | null;
}

/**
 * Remembers which version of each element the server already has, so only what the local
 * editor changed is sent (ADR 0015). Versions count as known once sent or received.
 */
export class SceneTracker {
  private readonly versions = new Map<string, number>();
  /** Highest change number received; the next catch-up asks for what came after it. */
  seq = 0;

  /** Elements edited locally since the server last saw them. */
  changed<T extends Versioned>(elements: readonly T[]): T[] {
    return elements.filter((element) => element.version > (this.versions.get(element.id) ?? 0));
  }

  remember(elements: readonly Versioned[]): void {
    for (const element of elements) {
      if (element.version > (this.versions.get(element.id) ?? 0)) {
        this.versions.set(element.id, element.version);
      }
    }
  }

  /** A failed save: the elements are sent again with the next change. */
  forget(elements: readonly Versioned[]): void {
    for (const element of elements) {
      if (this.versions.get(element.id) === element.version) this.versions.delete(element.id);
    }
  }

  received(seq: number, elements: readonly Versioned[]): void {
    this.seq = Math.max(this.seq, seq);
    this.remember(elements);
  }
}

export interface SaverOptions<T extends Versioned> {
  save(elements: T[]): Promise<unknown>;
  /** Called with the error when saving is pointless to retry (no permission, board gone). */
  onFatal(error: unknown): void;
  delayMs?: number;
  schedule?: (fn: () => void, ms: number) => unknown;
}

/**
 * Batches local changes into few requests: one save in flight at a time, the latest version
 * of each element wins, and failures retry with backoff without losing edits.
 */
export class SceneSaver<T extends Versioned> {
  private readonly queue = new Map<string, T>();
  private timer = false;
  private inFlight = false;
  private failures = 0;
  private stopped = false;

  constructor(
    private readonly tracker: SceneTracker,
    private readonly options: SaverOptions<T>,
  ) {}

  /** Queues the elements that changed; they are marked known right away to avoid resending. */
  push(elements: readonly T[]): void {
    const changed = this.tracker.changed(elements);
    if (changed.length === 0 || this.stopped) return;
    for (const element of changed) this.queue.set(element.id, element);
    this.tracker.remember(changed);
    this.arm(this.options.delayMs ?? 80);
  }

  get pending(): number {
    return this.queue.size + (this.inFlight ? 1 : 0);
  }

  stop(): void {
    this.stopped = true;
  }

  private arm(ms: number): void {
    if (this.timer || this.stopped) return;
    this.timer = true;
    (this.options.schedule ?? setTimeout)(() => {
      this.timer = false;
      void this.flush();
    }, ms);
  }

  private async flush(): Promise<void> {
    if (this.inFlight || this.queue.size === 0 || this.stopped) return;
    const batch = [...this.queue.values()];
    this.queue.clear();
    this.inFlight = true;
    try {
      await this.options.save(batch);
      this.failures = 0;
    } catch (error) {
      const status = (error as { status?: number }).status ?? 0;
      if (status === 403 || status === 404 || status === 409) {
        this.stopped = true;
        this.options.onFatal(error);
        return;
      }
      // Newer queued copies of the same element win over the failed ones.
      for (const element of batch)
        if (!this.queue.has(element.id)) this.queue.set(element.id, element);
      this.failures += 1;
    } finally {
      this.inFlight = false;
    }
    if (this.queue.size > 0)
      this.arm(this.failures ? Math.min(10_000, 500 * 2 ** this.failures) : 0);
  }
}

/** Colours for other people's cursors, picked stably per member. */
const COLORS = ['#e03131', '#1971c2', '#2f9e44', '#f08c00', '#6741d9', '#0c8599', '#c2255c'];

export function colorFor(id: string): { background: string; stroke: string } {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const color = COLORS[hash % COLORS.length]!;
  return { background: color, stroke: color };
}

export interface Collaborator {
  id: string;
  socketId: string;
  username: string;
  color: { background: string; stroke: string };
  pointer?: { x: number; y: number; tool: 'pointer' | 'laser' };
  button: 'up' | 'down';
  selectedElementIds: Record<string, true>;
}

/** Other tabs on the board; a tab silent for `ttlMs` is gone (its socket may have died). */
export class PresenceRoster {
  private readonly tabs = new Map<string, { presence: WhiteboardPresence; seenAt: number }>();

  constructor(private readonly ttlMs = 30_000) {}

  apply(presence: WhiteboardPresence, now: number): void {
    if (presence.left) this.tabs.delete(presence.clientId);
    else this.tabs.set(presence.clientId, { presence, seenAt: now });
  }

  /** Removes silent tabs; true when something changed. */
  prune(now: number): boolean {
    let changed = false;
    for (const [id, entry] of this.tabs) {
      if (now - entry.seenAt > this.ttlMs) {
        this.tabs.delete(id);
        changed = true;
      }
    }
    return changed;
  }

  /** Distinct people, for the avatars in the header. */
  members(): MemberRef[] {
    const seen = new Map<string, MemberRef>();
    for (const { presence } of this.tabs.values()) seen.set(presence.member.id, presence.member);
    return [...seen.values()];
  }

  collaborators(): Map<string, Collaborator> {
    const result = new Map<string, Collaborator>();
    for (const [clientId, { presence }] of this.tabs) {
      result.set(clientId, {
        id: presence.member.id,
        socketId: clientId,
        username: presence.member.name,
        color: colorFor(presence.member.id),
        ...(presence.pointer ? { pointer: presence.pointer } : {}),
        button: presence.button,
        selectedElementIds: Object.fromEntries(presence.selectedElementIds.map((id) => [id, true])),
      });
    }
    return result;
  }
}

/** Image elements whose file this tab does not have yet. */
export function missingFiles(
  elements: readonly Versioned[],
  have: (fileId: string) => boolean,
): string[] {
  const ids = new Set<string>();
  for (const element of elements) {
    if (element.type === 'image' && element.fileId && !element.isDeleted && !have(element.fileId)) {
      ids.add(element.fileId);
    }
  }
  return [...ids];
}

export type RemoteElement = WhiteboardElement;
