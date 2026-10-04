// Fake players for testing the TV and host screens on your own.
//   npm run bots -- ABCD 9        (room code, number of bots; the default server is localhost:3000)
// Bots join, buzz at a random moment when a sprint question opens, and bet a random share of their points.
import WebSocket from 'ws';
import type { ClientMessage, ServerMessage } from '../src/shared/protocol';
import type { GameView } from '../src/shared/types';

const [code = '', countArg = '9'] = process.argv.slice(2);
if (!code) {
  console.error('Usage: npm run bots -- <ROOM CODE> [count]');
  process.exit(1);
}
const url = process.env.QUIZZ_WS ?? 'ws://localhost:3000/ws';
const NAMES = ['Ava', 'Ben', 'Chloe', 'Dan', 'Eli', 'Fay', 'Gus', 'Hana', 'Ivan', 'Jade', 'Kai', 'Lea', 'Max', 'Nina', 'Omar', 'Pia'];

function startBot(name: string) {
  const ws = new WebSocket(url);
  let me = '';
  let lastKey = '';
  const send = (m: ClientMessage) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(m));

  ws.on('open', () => send({ t: 'hello', role: 'play', code: code.toUpperCase(), name }));
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString()) as ServerMessage;
    if (msg.t === 'hello.ok') me = msg.playerId ?? '';
    if (msg.t === 'error') console.log(`${name}: ${msg.message}`);
    if (msg.t !== 'state' || !msg.state) return;
    act(msg.state);
  });

  function act(s: GameView) {
    const self = s.players.find((p) => p.id === me);
    if (!self) return;
    if (s.phase === 'sprint' && s.sprint.status === 'asking' && !s.sprint.lockedOut.includes(me)) {
      const key = `buzz-${s.sprint.index}-${s.sprint.lockedOut.length}`;
      if (key !== lastKey && Math.random() < 0.6) {
        lastKey = key;
        setTimeout(() => send({ t: 'buzz' }), 300 + Math.random() * 2500);
      }
    }
    if (s.phase === 'climax' && s.climax.status === 'betting' && !self.sitOut && self.score > 0) {
      const key = `bet-${s.climax.theme ?? ''}-${s.climax.difficulty ?? ''}-${s.climax.results.length}`;
      if (key !== lastKey) {
        lastKey = key;
        setTimeout(() => send({ t: 'bet', amount: Math.floor(self.score * Math.random()) }), 500 + Math.random() * 3000);
      }
    }
  }
  ws.on('close', () => console.log(`${name} disconnected`));
}

const count = Math.min(Number(countArg) || 9, NAMES.length);
NAMES.slice(0, count).forEach((n, i) => setTimeout(() => startBot(n), i * 150));
console.log(`${count} bots joining room ${code.toUpperCase()}. Ctrl+C to stop.`);
