import { describe, expect, it } from 'vitest';
import { realtimeClientMessageSchema } from './issues.js';
import { whiteboardElementSchema, whiteboardFileSchema, whiteboardTopic } from './whiteboards.js';

describe('whiteboard schemas', () => {
  it('keeps unknown element fields and defaults isDeleted', () => {
    const parsed = whiteboardElementSchema.parse({
      id: 'Ab_1-x',
      type: 'rectangle',
      version: 3,
      versionNonce: -5,
      x: 10,
      customData: { a: 1 },
    });
    expect(parsed).toMatchObject({ isDeleted: false, x: 10, customData: { a: 1 } });
  });

  it('refuses ids and versions the server cannot store safely', () => {
    const base = { type: 'rectangle', version: 1, versionNonce: 1 };
    expect(whiteboardElementSchema.safeParse({ ...base, id: '../x' }).success).toBe(false);
    expect(whiteboardElementSchema.safeParse({ ...base, id: 'a', version: 0 }).success).toBe(false);
    expect(
      whiteboardElementSchema.safeParse({ ...base, id: 'a', versionNonce: 2 ** 31 }).success,
    ).toBe(false);
  });

  it('accepts images only', () => {
    expect(
      whiteboardFileSchema.safeParse({ id: 'f', mimeType: 'image/png', dataURL: 'data:x' }).success,
    ).toBe(true);
    expect(
      whiteboardFileSchema.safeParse({ id: 'f', mimeType: 'text/html', dataURL: 'data:x' }).success,
    ).toBe(false);
  });

  it('parses pointer messages with defaults and caps selections', () => {
    const topic = whiteboardTopic('b');
    expect(realtimeClientMessageSchema.parse({ type: 'presence', topic, pointer: null })).toEqual({
      type: 'presence',
      topic,
      pointer: null,
      button: 'up',
      selectedElementIds: [],
    });
    const many = Array.from({ length: 51 }, (_, i) => `e${i}`);
    expect(
      realtimeClientMessageSchema.safeParse({
        type: 'presence',
        topic,
        pointer: null,
        selectedElementIds: many,
      }).success,
    ).toBe(false);
  });
});
