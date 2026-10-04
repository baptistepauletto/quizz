import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClientMessage, HelloMessage, ServerMessage } from '../../shared/protocol';
import type { GameEvent, GameView } from '../../shared/types';

export type Connection = 'connecting' | 'open' | 'closed';
export interface GameError {
  code: 'auth' | 'join' | 'command' | 'bad' | 'replaced';
  message: string;
}

interface Options {
  /** Pass null to stay disconnected (e.g. before a player has typed their name). */
  hello: HelloMessage | null;
  onEvent?: (event: GameEvent) => void;
}

export interface UseGame {
  state: GameView | null;
  /** True once the server has answered with a state (which may be "no game"). */
  synced: boolean;
  connection: Connection;
  playerId: string | null;
  error: GameError | null;
  clearError: () => void;
  send: (msg: ClientMessage) => void;
}

const CLOSE_REPLACED = 4000;
const CLOSE_AUTH = 4001;

/**
 * One WebSocket to the room. It reconnects by itself (phones sleep, Wi-Fi blips,
 * the page gets refreshed) and replays the same hello, which is what lets a player
 * pick their seat back up.
 */
export function useGame({ hello, onEvent }: Options): UseGame {
  const [state, setState] = useState<GameView | null>(null);
  const [synced, setSynced] = useState(false);
  const [connection, setConnection] = useState<Connection>('closed');
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [error, setError] = useState<GameError | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const helloKey = hello ? JSON.stringify(hello) : null;

  useEffect(() => {
    if (!helloKey) {
      setConnection('closed');
      setState(null);
      setSynced(false);
      setPlayerId(null);
      return;
    }

    let stopped = false;
    let retries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      clearTimeout(timer);
      setConnection('connecting');
      setSynced(false);
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        retries = 0;
        ws.send(helloKey);
      };
      ws.onmessage = (ev) => {
        const msg = JSON.parse(String(ev.data)) as ServerMessage;
        if (msg.t === 'hello.ok') {
          setConnection('open');
          setError(null);
          setPlayerId(msg.playerId ?? null);
        } else if (msg.t === 'state') {
          setState(msg.state);
          setSynced(true);
        } else if (msg.t === 'event') {
          onEventRef.current?.(msg.event);
        } else if (msg.t === 'error') {
          setError({ code: msg.code, message: msg.message });
        }
      };
      ws.onclose = (ev) => {
        if (stopped || wsRef.current !== ws) return;
        setConnection('closed');
        if (ev.code === CLOSE_REPLACED) {
          setError({ code: 'replaced', message: 'This player was opened on another device.' });
          return;
        }
        if (ev.code === CLOSE_AUTH) return;
        timer = setTimeout(connect, Math.min(3000, 400 * 2 ** retries++));
      };
    };

    // When a phone wakes up, do not wait for the backoff timer.
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || stopped) return;
      const ws = wsRef.current;
      if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) connect();
    };
    document.addEventListener('visibilitychange', onVisible);

    connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      const ws = wsRef.current;
      wsRef.current = null;
      ws?.close();
    };
  }, [helloKey]);

  const send = useCallback((msg: ClientMessage) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return { state, synced, connection, playerId, error, clearError, send };
}
