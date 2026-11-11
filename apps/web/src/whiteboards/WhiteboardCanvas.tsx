import '@excalidraw/excalidraw/index.css';
import {
  CaptureUpdateAction,
  Excalidraw,
  convertToExcalidrawElements,
  reconcileElements,
  restoreElements,
} from '@excalidraw/excalidraw';
import type { OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import type {
  AppState,
  BinaryFileData,
  BinaryFiles,
  ExcalidrawImperativeAPI,
} from '@excalidraw/excalidraw/types';
import {
  whiteboardTopic,
  type MemberRef,
  type RealtimeServerMessage,
  type WhiteboardElement,
  type WhiteboardView,
  type WhiteboardPresenceMessage,
} from '@ordler/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client.js';
import { realtime, useRealtime } from '../realtime/client.js';
import { missingFiles, PresenceRoster, SceneSaver, SceneTracker } from './sync.js';
import { templateSkeleton, type TemplateKey } from './templates.js';

// Fonts are served by Ordler itself, never from a public CDN (ADR 0015).
(window as { EXCALIDRAW_ASSET_PATH?: string }).EXCALIDRAW_ASSET_PATH = '/excalidraw-assets/';

const LANGUAGES: Record<string, string> = { en: 'en', ru: 'ru-RU', de: 'de-DE', az: 'az-AZ' };
const POINTER_INTERVAL_MS = 50;

type Element = OrderedExcalidrawElement;

/** What the page around the canvas can ask of it. */
export interface CanvasHandle {
  insertTemplate(key: TemplateKey, labels: Record<string, string>): void;
}

function prefersDark(): boolean {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

/**
 * The live canvas of one whiteboard (SPEC §5.5, ADR 0015). Joins the board's realtime topic,
 * loads and catches up the scene, saves local edits in small batches and shows everybody
 * else's pointer and selection. `embedded` is the read-mostly preview on an issue page.
 */
export default function WhiteboardCanvas({
  board,
  embedded = false,
  onReady,
  onPeople,
  onError,
}: {
  board: WhiteboardView;
  embedded?: boolean;
  onReady?: (handle: CanvasHandle) => void;
  onPeople?: (people: MemberRef[]) => void;
  onError?: (error: unknown) => void;
}) {
  const { i18n } = useTranslation();
  const [excalidraw, setExcalidraw] = useState<ExcalidrawImperativeAPI>();
  const [dark, setDark] = useState(prefersDark);
  const tracker = useMemo(() => new SceneTracker(), []);
  const roster = useMemo(() => new PresenceRoster(), []);
  const uploaded = useRef(new Set<string>());
  const loaded = useRef(false);
  const lastPointer = useRef(0);
  const topic = whiteboardTopic(board.id);
  const readOnly = embedded || !board.canEdit;
  const handlers = useRef({ onPeople, onError });
  handlers.current = { onPeople, onError };

  const saver = useRef<SceneSaver<Element> | undefined>(undefined);
  // Created in the effect, not in render: a stopped saver must never be reused after remount.
  useEffect(() => {
    const created = new SceneSaver<Element>(tracker, {
      save: (elements) =>
        api.saveWhiteboardScene(board.id, elements as unknown as WhiteboardElement[]),
      onFatal: (error) => handlers.current.onError?.(error),
    });
    saver.current = created;
    return () => created.stop();
  }, [board.id, tracker]);

  useEffect(() => {
    const query = window.matchMedia?.('(prefers-color-scheme: dark)');
    const update = () => setDark(query.matches);
    query?.addEventListener('change', update);
    return () => query?.removeEventListener('change', update);
  }, []);

  /** Brings in images other people placed that this tab has not seen yet. */
  const fetchFiles = useCallback(
    async (elements: readonly Element[]) => {
      if (!excalidraw) return;
      const files = excalidraw.getFiles();
      const ids = missingFiles(elements as never, (id) => id in files);
      if (ids.length === 0) return;
      const fetched = await api.whiteboardFiles(board.id, ids).catch(() => []);
      for (const file of fetched) uploaded.current.add(file.id);
      if (fetched.length > 0) excalidraw.addFiles(fetched as unknown as BinaryFileData[]);
    },
    [board.id, excalidraw],
  );

  /** Merges server elements into the scene with the editor's own conflict rule. */
  const applyRemote = useCallback(
    (seq: number, remote: WhiteboardElement[]) => {
      if (!excalidraw) return;
      tracker.received(seq, remote as never);
      if (remote.length === 0) return;
      const restored = restoreElements(remote as never, null, { repairBindings: true });
      const merged = reconcileElements(
        excalidraw.getSceneElementsIncludingDeleted(),
        restored as never,
        excalidraw.getAppState(),
      );
      excalidraw.updateScene({ elements: merged, captureUpdate: CaptureUpdateAction.NEVER });
      void fetchFiles(restored);
    },
    [excalidraw, fetchFiles, tracker],
  );

  const catchUp = useCallback(async () => {
    try {
      const scene = await api.whiteboardScene(board.id, tracker.seq);
      applyRemote(scene.seq, scene.elements);
      if (!loaded.current) {
        loaded.current = true;
        excalidraw?.scrollToContent(undefined, { fitToContent: embedded, animate: false });
      }
    } catch (error) {
      handlers.current.onError?.(error);
    }
  }, [applyRemote, board.id, embedded, excalidraw, tracker]);

  useEffect(() => {
    if (excalidraw) void catchUp();
    // Only once the editor exists; later catch-ups come from realtime.
  }, [excalidraw]);

  const showPeople = useCallback(() => {
    excalidraw?.updateScene({ collaborators: roster.collaborators() as never });
    handlers.current.onPeople?.(roster.members());
  }, [excalidraw, roster]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (roster.prune(Date.now())) showPeople();
    }, 5000);
    return () => clearInterval(timer);
  }, [roster, showPeople]);

  useRealtime(
    excalidraw ? topic : undefined,
    (message: RealtimeServerMessage) => {
      if (message.type === 'subscribed' && message.topic === topic) {
        // Changes saved between the first load and the subscription are fetched here.
        if (loaded.current) void catchUp();
      } else if (message.type === 'whiteboard.elements' && message.whiteboardId === board.id) {
        applyRemote(message.seq, message.elements);
      } else if (message.type === 'whiteboard.presence' && message.whiteboardId === board.id) {
        roster.apply(message.presence, Date.now());
        showPeople();
      }
    },
    () => void catchUp(),
  );

  const sendPresence = useCallback(
    (state: Omit<WhiteboardPresenceMessage, 'type' | 'topic'>) => {
      realtime().publish({ type: 'presence', topic, ...state });
    },
    [topic],
  );

  const uploadFiles = useCallback(
    async (elements: readonly Element[], files: BinaryFiles) => {
      const pending = elements.filter(
        (e) => e.type === 'image' && e.fileId && !e.isDeleted && !uploaded.current.has(e.fileId),
      );
      for (const element of pending) {
        const fileId = (element as { fileId: string }).fileId;
        const file = files[fileId];
        if (!file) continue;
        uploaded.current.add(fileId);
        try {
          await api.saveWhiteboardFile(board.id, {
            id: fileId,
            mimeType: file.mimeType as never,
            dataURL: file.dataURL,
          });
        } catch (error) {
          uploaded.current.delete(fileId);
          handlers.current.onError?.(error);
        }
      }
    },
    [board.id],
  );

  const lastSelection = useRef('');
  const onChange = useCallback(
    (elements: readonly Element[], appState: AppState, files: BinaryFiles) => {
      if (!loaded.current || readOnly) return;
      // Images go out only after their file is stored, so other tabs can always load them.
      const ready = elements.filter(
        (e) => e.type !== 'image' || !e.fileId || uploaded.current.has(e.fileId),
      );
      saver.current?.push(ready);
      if (ready.length !== elements.length) {
        void uploadFiles(elements, files).then(() =>
          saver.current?.push(excalidraw?.getSceneElementsIncludingDeleted() ?? []),
        );
      }
      const selection = Object.keys(appState.selectedElementIds).slice(0, 50).join(',');
      if (selection !== lastSelection.current) {
        lastSelection.current = selection;
        sendPresence({
          pointer: null,
          button: 'up',
          selectedElementIds: selection ? selection.split(',') : [],
        });
      }
    },
    [excalidraw, readOnly, sendPresence, uploadFiles],
  );

  useEffect(() => {
    if (!excalidraw || !onReady) return;
    onReady({
      insertTemplate(key, labels) {
        const state = excalidraw.getAppState();
        const center = {
          x: -state.scrollX + state.width / 2 / state.zoom.value,
          y: -state.scrollY + state.height / 2 / state.zoom.value,
        };
        const created = convertToExcalidrawElements(templateSkeleton(key, labels, center) as never);
        excalidraw.updateScene({
          elements: [...excalidraw.getSceneElementsIncludingDeleted(), ...created],
          captureUpdate: CaptureUpdateAction.IMMEDIATELY,
        });
      },
    });
  }, [excalidraw, onReady]);

  return (
    <div className="h-full w-full" data-testid="whiteboard-canvas">
      <Excalidraw
        excalidrawAPI={setExcalidraw}
        isCollaborating
        viewModeEnabled={readOnly}
        zenModeEnabled={embedded}
        theme={dark ? 'dark' : 'light'}
        langCode={LANGUAGES[i18n.language.split('-')[0] ?? 'en'] ?? 'en'}
        name={board.title}
        onChange={onChange}
        onPointerUpdate={({ pointer, button }) => {
          const now = Date.now();
          if (now - lastPointer.current < POINTER_INTERVAL_MS) return;
          lastPointer.current = now;
          sendPresence({
            pointer: { x: pointer.x, y: pointer.y, tool: pointer.tool },
            button,
            selectedElementIds: lastSelection.current ? lastSelection.current.split(',') : [],
          });
        }}
        UIOptions={{
          canvasActions: {
            loadScene: false,
            saveToActiveFile: false,
            clearCanvas: !readOnly,
            toggleTheme: null,
            export: { saveFileToDisk: true },
          },
        }}
      />
    </div>
  );
}
