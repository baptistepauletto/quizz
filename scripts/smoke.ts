// End-to-end smoke test: boots the server on a throwaway database, then plays a tiny
// game with fake clients (TV, host, 3 players) over real WebSockets.
//   npm run smoke
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import type { ClientMessage, ServerMessage } from '../src/shared/protocol';
import type { DraftFile, GameEvent, GameView } from '../src/shared/types';

const PORT = 3999;
const PIN = '4242';
const BASE = `http://localhost:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quizz-smoke-'));

let failures = 0;
function check(cond: unknown, label: string) {
  if (cond) console.log(`  ok    ${label}`);
  else {
    failures++;
    console.log(`  FAIL  ${label}`);
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class Client {
  ws!: WebSocket;
  state: GameView | null = null;
  events: GameEvent[] = [];
  errors: string[] = [];
  playerId: string | undefined;
  closed = false;

  constructor(readonly name: string) {}

  async connect(hello: ClientMessage) {
    this.ws = new WebSocket(`ws://localhost:${PORT}/ws`);
    this.ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString()) as ServerMessage;
      if (msg.t === 'state') this.state = msg.state;
      else if (msg.t === 'event') this.events.push(msg.event);
      else if (msg.t === 'error') this.errors.push(msg.message);
      else if (msg.t === 'hello.ok') this.playerId = msg.playerId;
    });
    this.ws.on('close', () => (this.closed = true));
    await new Promise<void>((res, rej) => {
      this.ws.once('open', () => res());
      this.ws.once('error', rej);
    });
    this.send(hello);
    await sleep(150);
  }

  send(msg: ClientMessage) {
    this.ws.send(JSON.stringify(msg));
  }

  /** Sends and waits long enough for the broadcast to arrive. */
  async cmd(msg: ClientMessage) {
    this.errors.length = 0;
    this.send(msg);
    await sleep(120);
  }
}

async function api(method: string, url: string, body?: unknown, token?: string) {
  const res = await fetch(BASE + url, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}

const draft: DraftFile = {
  title: 'Smoke test night',
  sprint: [
    {
      theme: 'General knowledge',
      questions: [
        { prompt: 'Capital of France?', answer: 'Paris', difficulty: 'medium' },
        { prompt: 'Chemical symbol for gold?', answer: 'Au', difficulty: 'hard' },
      ],
    },
  ],
  memory: [
    { theme: 'Space', contributor: 'Ann', questions: [{ prompt: 'Biggest planet?', answer: 'Jupiter', difficulty: 'easy' }, { prompt: 'First on the Moon?', answer: 'Armstrong', difficulty: 'medium' }] },
    { theme: 'Cinema', contributor: 'Bob', questions: [{ prompt: 'Director of Jaws?', answer: 'Spielberg', difficulty: 'medium' }, { prompt: 'Best Picture 1994?', answer: 'Forrest Gump', difficulty: 'hard' }] },
    { theme: 'Food', contributor: 'Cy', questions: [{ prompt: 'Main ingredient of guacamole?', answer: 'Avocado', difficulty: 'easy' }, { prompt: 'Country of origin of sushi?', answer: 'Japan', difficulty: 'easy' }] },
  ],
  climax: [
    { theme: 'Space', questions: [{ prompt: 'How many moons does Mars have?', answer: 'Two', difficulty: 'hard' }] },
    { theme: 'Cinema', questions: [{ prompt: 'Who directed Psycho?', answer: 'Hitchcock', difficulty: 'medium' }] },
  ],
};

const server = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'src/server/index.ts'], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, HOST_PIN: PIN },
  stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise<void>((resolve, reject) => {
  server.stdout!.on('data', (d) => String(d).includes('Quizz In is running') && resolve());
  server.once('exit', (code) => reject(new Error(`server exited early (${code})`)));
  setTimeout(() => reject(new Error('server did not start in time')), 20_000);
});

const clients: Client[] = [];
try {
  console.log('\nPrep API');
  check((await api('GET', '/api/packs')).status === 401, 'prep API requires auth');
  check((await api('POST', '/api/auth', { pin: 'nope' })).status === 401, 'wrong PIN rejected');
  const { token } = (await api('POST', '/api/auth', { pin: PIN })).json;
  check(typeof token === 'string', 'right PIN returns a token');
  check((await api('POST', '/api/import', { draft: { title: 'x', sprint: [{ theme: '', questions: [] }] } }, token)).status === 400, 'invalid draft rejected');
  const imported = await api('POST', '/api/import', { draft }, token);
  const packId: number = imported.json.id;
  const questions: { id: number; bank: string }[] = imported.json.pack.questions;
  check(questions.length === 10 && questions.every((q: any) => q.status === 'draft'), 'draft imported as 10 draft questions');
  check((await api('POST', `/api/packs/${packId}/status`, { status: 'ready' }, token)).status === 400, 'pack cannot be ready before approving');
  for (const q of questions) await api('PATCH', `/api/questions/${q.id}`, { status: 'approved' }, token);
  check((await api('POST', `/api/packs/${packId}/status`, { status: 'ready' }, token)).status === 200, 'pack ready after approving');

  console.log('\nRoom');
  const tv = new Client('tv');
  const host = new Client('host');
  await tv.connect({ t: 'hello', role: 'tv' });
  const badHost = new Client('badhost');
  await badHost.connect({ t: 'hello', role: 'host', token: 'wrong' });
  check(badHost.errors.length > 0, 'host with a wrong token is refused');
  await host.connect({ t: 'hello', role: 'host', token });
  clients.push(tv, host);
  check(tv.state === null, 'TV sees no game yet');
  await host.cmd({ t: 'game.create', packId });
  const code = host.state?.joinCode ?? '';
  check(/^[A-Z]{4}$/.test(code) && tv.state?.joinCode === code, `game created with code ${code}, visible on TV`);

  const ann = new Client('Ann');
  const bob = new Client('Bob');
  const cy = new Client('Cy');
  await ann.connect({ t: 'hello', role: 'play', code, name: 'Ann' });
  await bob.connect({ t: 'hello', role: 'play', code, name: 'Bob' });
  await cy.connect({ t: 'hello', role: 'play', code, name: 'Cy' });
  clients.push(ann, bob, cy);
  check(host.state?.players.length === 3, 'three players joined');

  const wrongCode = new Client('x');
  await wrongCode.connect({ t: 'hello', role: 'play', code: 'ZZZZ', name: 'Eve' });
  check(wrongCode.errors.length > 0, 'wrong join code refused');
  const dupe = new Client('dupe');
  await dupe.connect({ t: 'hello', role: 'play', code, name: ' ann ' });
  check(dupe.errors.length > 0, 'duplicate name refused while the original is connected');
  dupe.ws.close();

  // Refresh: same device presents its player id and takes over its own seat.
  const annId = ann.playerId!;
  ann.ws.close();
  await sleep(200);
  check(host.state?.players.find((p) => p.id === annId)?.connected === false, 'closing the socket marks the player disconnected');
  const ann2 = new Client('Ann2');
  await ann2.connect({ t: 'hello', role: 'play', code, name: 'ANN' });
  clients.push(ann2);
  check(ann2.playerId === annId && host.state?.players.find((p) => p.id === annId)?.connected === true, 'retyping the name reclaims the same player');
  const players = { ann: ann2, bob, cy };

  console.log('\nPhase 1: Sprint');
  await host.cmd({ t: 'phase.set', phase: 'sprint' });
  await players.bob.cmd({ t: 'buzz' });
  check(host.state?.sprint.status === 'idle', 'buzzing before a question does nothing');
  await host.cmd({ t: 'sprint.next' });
  check(tv.state?.sprint.question?.prompt === 'Capital of France?', 'TV shows the question');
  check(tv.state?.sprint.question?.answer === undefined && host.state?.sprint.question?.answer === 'Paris', 'answer only goes to the host');
  check(players.bob.state?.sprint.question === null, 'phones never get the prompt');
  players.ann.send({ t: 'buzz' });
  players.bob.send({ t: 'buzz' });
  players.cy.send({ t: 'buzz' });
  await sleep(200);
  const winner = host.state!.sprint.buzzPlayerId!;
  check(host.state!.sprint.status === 'locked' && !!winner, 'exactly one buzz wins and locks the others out');
  check(host.events.filter((e) => e.type === 'sprint.buzz_won').length === 1, 'only one buzz_won event');
  await host.cmd({ t: 'sprint.pass' });
  check(host.state!.sprint.status === 'asking' && host.state!.sprint.lockedOut.includes(winner), 'pass reopens the buzzer, winner locked out');
  const loserClient = [players.ann, players.bob, players.cy].find((c) => c.playerId === winner)!;
  await loserClient.cmd({ t: 'buzz' });
  check(host.state!.sprint.status === 'asking', 'locked-out player cannot buzz again');
  const second = [players.ann, players.bob, players.cy].find((c) => c.playerId !== winner)!;
  await second.cmd({ t: 'buzz' });
  await host.cmd({ t: 'sprint.award' });
  const secondScore = host.state!.players.find((p) => p.id === second.playerId)!.score;
  check(secondScore === 3, 'medium question awards 3 points');
  await host.cmd({ t: 'sprint.next' });
  check(host.state!.sprint.status === 'asking' && host.state!.sprint.index === 1, 'next question starts');
  await host.cmd({ t: 'sprint.skip' });
  await host.cmd({ t: 'sprint.next' });
  check(host.errors.length > 0, 'no more sprint questions after the last one');

  // Put known scores on the board for the climax.
  const scoreOf = (name: string) => host.state!.players.find((p) => p.name.toLowerCase() === name)!.score;

  console.log('\nPhase 2: Memory Grid');
  await host.cmd({ t: 'phase.set', phase: 'memory' });
  check(host.state!.memory.status === 'preview' && host.state!.memory.tiles.length === 6, '6 tiles shuffled onto the grid, face-up preview');
  check(host.state!.memory.tiles.every((t) => !!t.theme), 'themes visible during the preview');
  await host.cmd({ t: 'memory.hide' });
  check(host.state!.memory.status === 'playing' && host.state!.memory.tiles.every((t) => t.face === 'hidden' && !t.theme), 'tiles flipped face-down, no theme leaked');
  check(!JSON.stringify(tv.state).includes('Jupiter'), 'TV has no answers in its state');
  const turn1 = host.state!.memory.turnPlayerId!;
  const coord = host.state!.memory.tiles[2].coord;
  await host.cmd({ t: 'memory.flip', coord });
  check(tv.state!.memory.askingCoord === coord && !!tv.state!.memory.asking?.prompt, 'TV shows the asked question in a modal');
  check(tv.state!.memory.asking?.answer === undefined && !!host.state!.memory.asking?.answer, 'answer stays on /host');
  await host.cmd({ t: 'memory.flip', coord: host.state!.memory.tiles[0].coord });
  check(host.errors.length > 0, 'cannot flip a second tile while one is being asked');
  const pts = host.state!.memory.asking!.points;
  const before = host.state!.players.find((p) => p.id === turn1)!.score;
  await host.cmd({ t: 'memory.resolve', correct: true });
  check(host.state!.players.find((p) => p.id === turn1)!.score === before + pts, `correct answer awards ${pts} points to the player on turn`);
  check(host.state!.memory.tiles.find((t) => t.coord === coord)!.face === 'consumed', 'tile consumed after a hit');
  check(host.state!.memory.turnPlayerId !== turn1, 'turn moved to the next player (round-robin)');
  await host.cmd({ t: 'memory.flip', coord });
  check(host.errors.length > 0, 'a consumed tile cannot be asked again');
  const coord2 = host.state!.memory.tiles[0].coord;
  const turn2 = host.state!.memory.turnPlayerId!;
  const before2 = host.state!.players.find((p) => p.id === turn2)!.score;
  await host.cmd({ t: 'memory.flip', coord: coord2 });
  await host.cmd({ t: 'memory.resolve', correct: false });
  check(host.state!.players.find((p) => p.id === turn2)!.score === before2, 'a miss scores nothing');
  const t2 = host.state!.memory.tiles.find((t) => t.coord === coord2)!;
  check(t2.face === 'consumed' && t2.result === 'miss', 'a missed tile is consumed too and never returns');
  check(host.state!.memory.remaining === 4, '4 tiles remain');

  console.log('\nPhase 3: Double or Nothing');
  // Ann 10, Bob 4, Cy 0 -> Cy sits out.
  for (const p of host.state!.players) {
    const target = { ann: 10, bob: 4, cy: 0 }[p.name.toLowerCase() as 'ann' | 'bob' | 'cy'];
    if (target !== p.score) await host.cmd({ t: 'score.adjust', playerId: p.id, delta: target - p.score });
  }
  check(scoreOf('ann') === 10 && scoreOf('bob') === 4 && scoreOf('cy') === 0, 'scores set up (10 / 4 / 0)');
  await host.cmd({ t: 'phase.set', phase: 'climax' });
  const candidate = host.state!.climax.candidates.find((c) => c.difficulty === 'hard')!;
  await host.cmd({ t: 'climax.pick', questionId: candidate.id });
  check(tv.state!.climax.status === 'announce' && tv.state!.climax.theme === candidate.theme, 'theme + difficulty announced on TV');
  check(tv.state!.climax.question === null && players.ann.state!.climax.question === null, 'question hidden from TV and phones before it is revealed');
  await host.cmd({ t: 'climax.openBetting' });
  await players.ann.cmd({ t: 'bet', amount: 6 });
  await players.bob.cmd({ t: 'bet', amount: 999 });
  await players.cy.cmd({ t: 'bet', amount: 1 });
  check(players.cy.errors.length > 0, 'a player with 0 points sits the round out');
  check(host.state!.climax.bets[players.bob.playerId!] === 4, 'a bet is capped at the player score');
  check(tv.state!.climax.bets && Object.keys(tv.state!.climax.bets).length === 0, 'bet amounts are never sent to the TV');
  check(players.ann.state!.climax.myBet === 6 && players.bob.state!.climax.myBet === 4, 'each phone only knows its own bet');
  await host.cmd({ t: 'climax.lockBets' });
  await players.ann.cmd({ t: 'bet', amount: 10 });
  check(players.ann.errors.length > 0 && host.state!.climax.bets[players.ann.playerId!] === 6, 'bets cannot change after the lock');
  check(!!tv.state!.climax.question?.prompt && tv.state!.climax.question?.answer === undefined, 'question revealed on TV, answer still hidden');
  await host.cmd({ t: 'climax.judge', playerId: players.ann.playerId!, correct: true });
  check(scoreOf('ann') === 10 + 2 * 6, 'correct answer triples the wager (10 -> 22)');
  check(host.state!.climax.status === 'asking', 'round stays open until everybody is judged');
  await host.cmd({ t: 'climax.judge', playerId: players.bob.playerId!, correct: false });
  check(scoreOf('bob') === 0, 'wrong answer wipes the wagered points (4 -> 0)');
  check(tv.state!.climax.status === 'resolved' && tv.state!.climax.question?.answer !== undefined, 'round resolved, answer revealed on TV');

  console.log('\nSnapshot / restart');
  await host.cmd({ t: 'phase.set', phase: 'results' });
  await sleep(500); // snapshot is debounced
  const joinCode = code;
  const seq = host.state!.seq;
  server.kill();
  await new Promise((r) => server.once('exit', r));
  const server2 = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'src/server/index.ts'], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, HOST_PIN: PIN },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise<void>((resolve) => server2.stdout!.on('data', (d) => String(d).includes('Quizz In is running') && resolve()));
  const tv2 = new Client('tv2');
  await tv2.connect({ t: 'hello', role: 'tv' });
  clients.push(tv2);
  check(tv2.state?.joinCode === joinCode && tv2.state.seq === seq && tv2.state.phase === 'results', 'game resumed from the snapshot after a restart');
  check(tv2.state?.players.find((p) => p.name === 'Ann')?.score === 22, 'scores survived the restart');
  const ann3 = new Client('Ann3');
  await ann3.connect({ t: 'hello', role: 'play', code: joinCode, name: 'ann' });
  clients.push(ann3);
  check(ann3.playerId === annId, 'player rejoins by retyping their name after a restart');
  server2.kill();
} catch (err) {
  failures++;
  console.error('\nSmoke test crashed:', err);
} finally {
  for (const c of clients) c.ws?.close();
  server.kill();
  await sleep(300);
  try {
    fs.rmSync(dataDir, { recursive: true, force: true });
  } catch {
    // Windows may still hold the SQLite file for a moment; the OS temp folder gets cleaned up eventually.
  }
}

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
