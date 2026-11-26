import { headingSlugs } from '@ordler/shared';
import { Extension } from '@tiptap/core';
import type { Node as PmNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

const key = new PluginKey<DecorationSet>('headingIds');

function decorate(doc: PmNode): DecorationSet {
  const headings: { pos: number; node: PmNode }[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === 'heading') headings.push({ pos, node });
    // Headings sit at the top level or in quotes and lists; nothing inside them can be one.
    return node.type.name !== 'heading';
  });
  const slugs = headingSlugs(headings.map((h) => h.node.textContent));
  return DecorationSet.create(
    doc,
    headings.map(({ pos, node }, i) =>
      Decoration.node(pos, pos + node.nodeSize, { id: slugs[i]! }),
    ),
  );
}

/**
 * Gives every heading a GitHub-style `id`, so Markdown tables of contents (`[x](#slug)`) and
 * deep links reach it. A decoration, not a node attribute: ids never enter the stored Markdown.
 */
export const HeadingIds = Extension.create({
  name: 'headingIds',
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key,
        state: {
          init: (_config, state) => decorate(state.doc),
          apply: (tr, previous) => (tr.docChanged ? decorate(tr.doc) : previous),
        },
        props: { decorations: (state) => key.getState(state) },
      }),
    ];
  },
});
