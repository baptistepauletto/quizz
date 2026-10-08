import type { WebSocket } from 'ws';
import { isValidToken } from './auth';
import {
  GameError,
  applyCommand,
  createGame,
  joinPlayer,
  playerAction,
  setConnected,
  tick,
  viewFor,
} from './game';
import type { Emit, Game } from './game';
import { drawNight } from './draw';
import { lastAsked, recordAsk } from './history';
import { approvedQuestions } from './packs';
import { deleteSnapshot, loadLatestSnapshot, saveSnapshot } from './snapshot';
import type { ClientMessage, HelloMessage, HostCommand, PlayerMessage, ServerMessage } from '../shared/protocol';
import type { GameEvent, GameEventType, Role } from '../shared/types';

interface Conn {
  ws: WebSocket;
  role: Role | null;
  playerId: string | null;
  alive: boolean;
}

const HEARTBEAT_MS = 5_000;
const SNAPSHOT_DEBOUNCE_MS = 300;

/**
 * The single live room. It owns the authoritative Game, all WebSocket
 * connections, broadcasting, heartbeats and snapshots.
 */
export class Room {
  game: Game | null = null;
  private conns = new Set<Conn>();
  private snapshotTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.game = loadLatestSnapshot();
    setInterval(() => this.heartbeat(), HEARTBEAT_MS).unref();
    setInterval(() => this.tick(), 1000).unref();
  }

  // --- connections -----------------------------------------------------------

  attach(ws: WebSocket): void {
    const conn: Conn = { ws, role: null, playerId: null, alive: true };
    this.conns.add(conn);
    ws.on('pong', () => (conn.alive = true));
    ws.on('message', (raw) => {
      conn.alive = true;
      this.onMessage(conn, raw.toString());
    });
    ws.on('close', () => this.onClose(conn));
    ws.on('error', () => ws.terminate());
  }

  private onMessage(conn: Conn, raw: string): void {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw) as ClientMessage;
    } catch {
      return this.error(conn, 'bad', 'Message invalide.');
    }
    try {
      if (msg.t === 'hello') return this.hello(conn, msg);
      if (!conn.role) return this.error(conn, 'bad', 'Dis bonjour d’abord.');

      if (conn.role === 'play') {
        if (msg.t !== 'buzz' && msg.t !== 'bet') return this.error(conn, 'command', 'Les joueurs ne peuvent pas faire ça.');
        return this.playerMessage(conn, msg);
      }
      if (conn.role === 'host') return this.hostCommand(conn, msg as HostCommand);
      this.error(conn, 'command', 'La TV est en affichage seul.');
    } catch (err) {
      if (err instanceof GameError) return this.error(conn, 'command', err.message);
      console.error('Unhandled error while handling message:', err);
      this.error(conn, 'bad', 'Un problème est survenu.');
    }
  }

  private hello(conn: Conn, msg: HelloMessage): void {
    if (msg.role === 'tv') {
      conn.role = 'tv';
      this.send(conn, { t: 'hello.ok', role: 'tv' });
      return this.sendState(conn);
    }

    if (msg.role === 'host') {
      if (!isValidToken(msg.token)) {
        this.error(conn, 'auth', 'PIN incorrect ou manquant.');
        return conn.ws.close(4001, 'auth');
      }
      conn.role = 'host';
      this.send(conn, { t: 'hello.ok', role: 'host' });
      return this.sendState(conn);
    }

    if (msg.role === 'play') {
      const g = this.game;
      if (!g || g.joinCode !== String(msg.code ?? '').trim().toUpperCase()) {
        return this.error(conn, 'join', 'Aucune partie avec ce code.');
      }
      let joined: { id: string } | null = null;
      try {
        this.mutate((game, emit) => {
          const res = joinPlayer(
            game,
            String(msg.name ?? ''),
            msg.playerId,
            (id) => this.hasLiveConnection(id, conn),
            emit,
          );
          joined = res.player;
        });
      } catch (err) {
        if (err instanceof GameError) return this.error(conn, 'join', err.message);
        throw err;
      }
      const player = joined as { id: string } | null;
      if (!player) return;
      // The same player opening a second tab/device replaces the old connection.
      for (const other of this.conns) {
        if (other !== conn && other.playerId === player.id) {
          other.playerId = null;
          other.role = null;
          other.ws.close(4000, 'replaced');
        }
      }
      conn.role = 'play';
      conn.playerId = player.id;
      this.send(conn, { t: 'hello.ok', role: 'play', playerId: player.id });
      this.sendState(conn);
    }
  }

  private onClose(conn: Conn): void {
    this.conns.delete(conn);
    if (conn.role === 'play' && conn.playerId && this.game) {
      const id = conn.playerId;
      if (!this.hasLiveConnection(id, conn)) {
        this.mutate((g, emit) => (setConnected(g, id, false, emit) ? undefined : false));
      }
    }
  }

  private hasLiveConnection(playerId: string, except?: Conn): boolean {
    for (const c of this.conns) {
      if (c !== except && c.playerId === playerId && c.ws.readyState === c.ws.OPEN) return true;
    }
    return false;
  }

  private heartbeat(): void {
    for (const conn of this.conns) {
      if (!conn.alive) {
        conn.ws.terminate(); // triggers 'close' -> player marked disconnected
        continue;
      }
      conn.alive = false;
      try {
        conn.ws.ping();
      } catch {
        conn.ws.terminate();
      }
    }
  }

  private tick(): void {
    if (!this.game) return;
    this.mutate((g, emit) => tick(g, emit) || false);
  }

  // --- messages ---------------------------------------------------------------

  private playerMessage(conn: Conn, msg: PlayerMessage): void {
    const playerId = conn.playerId;
    if (!playerId) return;
    this.mutate((g, emit) => playerAction(g, playerId, msg, emit));
  }

  private hostCommand(_conn: Conn, cmd: HostCommand): void {
    if (cmd.t === 'game.create') return this.createGame();
    if (cmd.t === 'game.end') return this.endGame();
    this.mutate((g, emit) => {
      applyCommand(g, cmd, emit);
    });
  }

  private createGame(): void {
    if (this.game) throw new GameError('Une partie est déjà en cours. Termine-la d’abord.');
    const hand = drawNight(approvedQuestions(), lastAsked());
    const missing = (['sprint', 'memory', 'climax'] as const).filter((bank) => !hand.some((q) => q.bank === bank));
    if (missing.length > 0) {
      throw new GameError(`Valide au moins une question dans : ${missing.join(', ')}.`);
    }
    this.game = createGame(0, 'Ce soir', hand);
    saveSnapshot(this.game);
    this.broadcastState();
  }

  private endGame(): void {
    if (this.game) deleteSnapshot(this.game.joinCode);
    this.game = null;
    for (const c of this.conns) {
      if (c.role === 'play') c.playerId = null;
    }
    this.broadcastState();
  }

  // --- state + events -----------------------------------------------------------

  /**
   * Runs one mutation on the authoritative game. If it changed something
   * (callback did not return false) the new view is broadcast to everyone,
   * followed by the events it emitted, and a snapshot is scheduled.
   */
  private mutate(fn: (g: Game, emit: Emit) => boolean | void): void {
    const g = this.game;
    if (!g) throw new GameError('Aucune partie en cours.');
    const pending: Array<{ type: GameEventType; payload: Record<string, unknown> }> = [];
    const emit: Emit = (type, payload = {}) => pending.push({ type, payload });
    if (fn(g, emit) === false) return;
    g.seq += 1;
    this.broadcastState();
    const at = Date.now();
    for (const e of pending) {
      if (e.type === 'sprint.question') recordAsk(g.sprint.order[g.sprint.index], g.joinCode);
      if (e.type === 'memory.asking') {
        const tile = g.memory.tiles.find((t) => t.coord === g.memory.askingCoord);
        if (tile) recordAsk(tile.questionId, g.joinCode);
      }
      if (e.type === 'climax.announce' && g.climax.questionId !== null) recordAsk(g.climax.questionId, g.joinCode);
      const event: GameEvent = { seq: g.seq, type: e.type, at, payload: e.payload };
      this.broadcast({ t: 'event', event });
    }
    this.scheduleSnapshot();
  }

  private broadcastState(): void {
    for (const conn of this.conns) this.sendState(conn);
  }

  private sendState(conn: Conn): void {
    if (!conn.role) return;
    const state = this.game ? viewFor(this.game, conn.role, conn.playerId) : null;
    this.send(conn, { t: 'state', state });
  }

  private broadcast(msg: ServerMessage): void {
    for (const conn of this.conns) if (conn.role) this.send(conn, msg);
  }

  private send(conn: Conn, msg: ServerMessage): void {
    if (conn.ws.readyState === conn.ws.OPEN) conn.ws.send(JSON.stringify(msg));
  }

  private error(conn: Conn, code: 'auth' | 'join' | 'command' | 'bad', message: string): void {
    this.send(conn, { t: 'error', code, message });
  }

  private scheduleSnapshot(): void {
    if (this.snapshotTimer) return;
    this.snapshotTimer = setTimeout(() => {
      this.snapshotTimer = null;
      try {
        if (this.game) saveSnapshot(this.game);
      } catch (err) {
        console.error('Could not save game snapshot:', err);
      }
    }, SNAPSHOT_DEBOUNCE_MS);
  }
}
