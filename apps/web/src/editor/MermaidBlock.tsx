import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { renderDiagram, type DiagramResult } from './mermaid.js';

/**
 * Code blocks: plain code, or for ```mermaid a live diagram under the source. In read-only
 * mode the diagram replaces the source.
 */
export function CodeBlockView({ node, editor }: NodeViewProps) {
  const { t } = useTranslation();
  const language = (node.attrs.language as string | null) ?? '';
  const source = node.textContent;
  const isDiagram = language === 'mermaid';
  const [diagram, setDiagram] = useState<DiagramResult>();

  useEffect(() => {
    if (!isDiagram || !source.trim()) return setDiagram(undefined);
    let current = true;
    // Debounced so typing does not re-render the diagram on every keystroke.
    const timer = setTimeout(() => {
      void renderDiagram(source).then((result) => {
        if (current) setDiagram(result);
      });
    }, 300);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [isDiagram, source]);

  const showSource = !isDiagram || editor.isEditable || (diagram && 'error' in diagram);
  return (
    <NodeViewWrapper className="ordler-code-block" data-language={language || undefined}>
      {/* Hidden rather than removed: ProseMirror needs the content element to exist. */}
      <pre hidden={!showSource}>
        <NodeViewContent<'code'> as="code" />
      </pre>
      {isDiagram && diagram && 'svg' in diagram && (
        <figure
          role="img"
          aria-label={t('editor.diagram')}
          contentEditable={false}
          className="ordler-diagram"
          // Mermaid output in strict security mode: sanitised labels, no scripts.
          dangerouslySetInnerHTML={{ __html: diagram.svg }}
        />
      )}
      {isDiagram && diagram && 'error' in diagram && editor.isEditable && (
        <p contentEditable={false} className="text-xs text-red-600">
          {t('editor.diagramError')}
        </p>
      )}
    </NodeViewWrapper>
  );
}
