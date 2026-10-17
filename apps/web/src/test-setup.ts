import '@testing-library/jest-dom/vitest';

// jsdom has no layout; ProseMirror (rich text editor) asks for rectangles while typing.
const emptyRect = () => ({
  x: 0,
  y: 0,
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  width: 0,
  height: 0,
  toJSON: () => ({}),
});
const emptyRects = () => Object.assign([], { item: () => null }) as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = emptyRect as () => DOMRect;
Range.prototype.getClientRects = emptyRects;
Element.prototype.getClientRects ??= emptyRects;
document.elementFromPoint ??= () => null;
