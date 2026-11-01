import type { SlackApi } from './slack-api.js';
import type { SlackAppService } from './slack-app.service.js';
import { SocketModeClient, type SocketFactory } from './socket-mode.js';

/**
 * Keeps one Socket Mode connection per worker while the app is enabled in Socket Mode, and
 * follows settings changes (token swapped, app disabled) within a minute.
 */
export function startSlackSocket(
  app: SlackAppService,
  api: SlackApi,
  options: { socket?: SocketFactory; intervalMs?: number; log?: (message: string) => void } = {},
): { stop(): void; check(): Promise<void> } {
  let client: SocketModeClient | undefined;
  let token: string | undefined;

  const check = async () => {
    const config = await app.socketConfig();
    if (client && config?.appToken === token) return;
    client?.stop();
    client = undefined;
    token = config?.appToken;
    if (!config) return;
    client = new SocketModeClient({
      open: async () => {
        const result = await api.call('apps.connections.open', config.appToken);
        if (!result.ok || typeof result.url !== 'string') {
          throw new Error(result.error ?? 'apps.connections.open failed');
        }
        return result.url;
      },
      dispatch: async (type, payload) => {
        if (type === 'events_api') {
          void app.handleEvent(payload as Record<string, unknown>).catch(() => undefined);
          return undefined;
        }
        if (type === 'interactive')
          return app.handleInteraction(payload as Record<string, unknown>);
        return undefined;
      },
      onState: (state, error) => {
        app.connection = state;
        if (state === 'connected') void app.recordError(null);
        if (error) void app.recordError(error);
      },
      ...(options.socket ? { socket: options.socket } : {}),
      ...(options.log ? { log: options.log } : {}),
    });
    client.start();
  };

  const loop = () =>
    void check().catch((error: unknown) =>
      options.log?.(`Slack socket check failed: ${String(error)}`),
    );
  loop();
  const timer = setInterval(loop, options.intervalMs ?? 60_000);
  timer.unref();
  return {
    stop() {
      clearInterval(timer);
      client?.stop();
    },
    check,
  };
}
