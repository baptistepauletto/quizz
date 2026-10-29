// End-to-end smoke test: boots the server on a throwaway database, then plays a tiny
// game with fake clients (TV, host, 3 players) over real WebSockets.
//   npm run smoke
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import WebSocket from 'ws';
import { NIGHT_SIZE, drawNight } from '../src/server/draw';
import type { QuestionRec } from '../src/server/game';
import type { ClientMessage, ServerMessage } from '../src/shared/protocol';
import { BANKS } from '../src/shared/types';
import type { GameEvent, GameView } from '../src/shared/types';

const PORT = 3999;
const PIN = '4242';
const BASE = `http://localhost:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quizz-smoke-'));
const picturesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quizz-pics-'));
const draftsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quizz-drafts-'));
fs.writeFileSync(
  path.join(picturesDir, 'smoke.png'),
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'),
);

function writeBankFiles(sprintQs: unknown[], memoryQs: unknown[], climaxQs: unknown[]) {
  fs.writeFileSync(path.join(draftsDir, 'sprint.json'), JSON.stringify({ questions: sprintQs }, null, 2));
  fs.writeFileSync(path.join(draftsDir, 'memory.json'), JSON.stringify({ questions: memoryQs }, null, 2));
  fs.writeFileSync(path.join(draftsDir, 'climax.json'), JSON.stringify({ questions: climaxQs }, null, 2));
}

const smokeSprint = [
  { id: 's_001', theme: 'General knowledge', prompt: 'Capital of France?', answer: 'Paris', difficulty: 'medium', image: 'smoke.png' },
  { id: 's_002', theme: 'General knowledge', prompt: 'Chemical symbol for gold?', answer: 'Au', difficulty: 'hard', image: 'smoke.png' },
];
const smokeMemory = [
  { id: 'm_001', theme: 'Space', contributor: 'Ann', prompt: 'Biggest planet?', answer: 'Jupiter', difficulty: 'easy', image: 'smoke.png' },
  {
    id: 'm_002',
    theme: 'Space',
    contributor: 'Ann',
    prompt: 'First on the Moon?',
    answer: 'Armstrong',
    difficulty: 'medium',
    is_mcq: true,
    options: ['Aldrin', 'Armstrong', 'Collins', 'Glenn'],
  },
  {
    id: 'm_003',
    theme: 'Cinema',
    contributor: 'Bob',
    prompt: 'Director of Jaws?',
    answer: 'Spielberg',
    difficulty: 'medium',
    is_mcq: false,
    options: ['Spielberg', 'Lucas', 'Coppola', 'Scorsese'],
  },
  { id: 'm_004', theme: 'Cinema', contributor: 'Bob', prompt: 'Best Picture 1994?', answer: 'Forrest Gump', difficulty: 'hard' },
  { id: 'm_005', theme: 'Food', contributor: 'Cy', prompt: 'Main ingredient of guacamole?', answer: 'Avocado', difficulty: 'easy' },
  { id: 'm_006', theme: 'Food', contributor: 'Cy', prompt: 'Country of origin of sushi?', answer: 'Japan', difficulty: 'easy' },
];
const smokeClimax = [
  { id: 'c_001', theme: 'Space', prompt: 'How many moons does Mars have?', answer: 'Two', difficulty: 'hard' },
  { id: 'c_002', theme: 'Cinema', prompt: 'Who directed Psycho?', answer: 'Hitchcock', difficulty: 'medium', image: 'smoke.png' },
];
writeBankFiles(smokeSprint, smokeMemory, smokeClimax);

let failures = 0;
function check(cond: unknown, label: string) {
  if (cond) console.log(`  ok    ${label}`);
  else {
    failures++;
    console.log(`  FAIL  ${label}`);
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function sampleQuestion(
  id: number,
  bank: QuestionRec['bank'],
  theme: string,
  difficulty: QuestionRec['difficulty'],
): QuestionRec {
  return {
    id,
    bank,
    theme,
    contributor: null,
    difficulty,
    prompt: String(id),
    answer: 'a',
    notes: null,
    image: null,
    options: null,
    isMcq: false,
  };
}

console.log('\nNight draw');
{
  const n = NIGHT_SIZE.sprint;
  const ids1 = (count: number) => Array.from({ length: count }, (_, i) => i + 1);
  const fresh = ids1(n + 2).map((id) => sampleQuestion(id, 'sprint', 'General', 'easy'));
  const hand = drawNight(fresh, new Map([[1, 1], [2, 2]]));
  check(hand.length === n && hand.every((q) => q.id > 2), 'fresh sprint questions are drawn before ones already asked');

  const scarce = [
    ...ids1(n + 2).map((id) => sampleQuestion(id, 'sprint', 'General', 'easy')),
    sampleQuestion(n + 3, 'sprint', 'General', 'medium'),
    sampleQuestion(n + 4, 'sprint', 'General', 'hard'),
  ];
  const mixed = drawNight(scarce, new Map());
  check(
    mixed.some((q) => q.difficulty === 'medium') && mixed.some((q) => q.difficulty === 'hard') && mixed.length === n,
    'a sprint hand keeps scarce difficulties',
  );

  const aged = ids1(n + 2).map((id) => sampleQuestion(id, 'sprint', 'General', 'easy'));
  const oldest = drawNight(aged, new Map(ids1(n + 2).slice(2).map((id) => [id, id * 10])));
  const ids = new Set(oldest.map((q) => q.id));
  check(ids.has(1) && ids.has(2) && ids.has(3) && !ids.has(n + 2), 'when the fresh pile runs out, the oldest asked questions return first');

  const perTheme = 20;
  const memory = ['Space', 'Cinema', 'Food'].flatMap((theme, ti) =>
    Array.from({ length: perTheme }, (_, i) => sampleQuestion(200 + ti * 100 + i, 'memory', theme, 'easy')),
  );
  const grid = drawNight(memory, new Map());
  const tally: Record<string, number> = {};
  for (const q of grid) tally[q.theme] = (tally[q.theme] ?? 0) + 1;
  const fair = Math.floor(NIGHT_SIZE.memory / 3);
  check(
    grid.length === NIGHT_SIZE.memory && tally.Space >= fair && tally.Cinema >= fair && tally.Food >= fair,
    'memory hand spreads across themes',
  );
}

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

const server = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'src/server/index.ts'], {
  env: {
    ...process.env,
    PORT: String(PORT),
    DATA_DIR: dataDir,
    PICTURES_DIR: picturesDir,
    DRAFTS_DIR: draftsDir,
    HOST_PIN: PIN,
    CLIMAX_ANSWER_MS: '60000',
  },
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
  check((await api('GET', '/api/pile')).status === 401, 'prep API requires auth');
  check((await api('POST', '/api/auth', { pin: 'nope' })).status === 401, 'wrong PIN rejected');
  const { token } = (await api('POST', '/api/auth', { pin: PIN })).json;
  check(typeof token === 'string', 'right PIN returns a token');
  check((await fetch(BASE + '/media/smoke.png')).status === 200, 'a picture in the folder is served');
  check((await fetch(BASE + '/media/..%2Fpackage.json')).status === 404, 'picture paths cannot leave the folder');

  const synced = await api('POST', '/api/sync', {}, token);
  check(synced.status === 200 && synced.json.added === 10, 'sync imports all draft questions as new');
  check(synced.json.reviewCount === 10, 'sync leaves everything in the review inbox');
  const inbox = await api('GET', '/api/inbox', undefined, token);
  check(inbox.json.length === 10, 'inbox lists every draft question');

  writeBankFiles(
    [{ ...smokeSprint[0], image: 'missing.png' }, smokeSprint[1]],
    smokeMemory,
    smokeClimax,
  );
  const badSync = await api('POST', '/api/sync', {}, token);
  check(badSync.json.problems?.length >= 1, 'sync reports a missing picture path');
  writeBankFiles(smokeSprint, smokeMemory, smokeClimax);

  for (const q of inbox.json) await api('PATCH', `/api/questions/${q.id}`, { status: 'approved' }, token);
  const afterApprove = await api('POST', '/api/sync', {}, token);
  check(afterApprove.json.unchanged === 10 && afterApprove.json.reviewCount === 0, 'unchanged approved questions stay out of the inbox');

  const pileQs = await api('GET', '/api/pile/questions', undefined, token);
  check(pileQs.json.length === 10, 'pile questions lists every approved question');
  const sprintPile = await api('GET', '/api/pile/questions?bank=sprint', undefined, token);
  check(sprintPile.json.length === 2 && sprintPile.json.every((q: any) => q.bank === 'sprint'), 'pile questions can filter by bank');

  // Content change → back to inbox; approve updates in place.
  writeBankFiles([{ ...smokeSprint[0], prompt: 'Capitale de la France ?' }, smokeSprint[1]], smokeMemory, smokeClimax);
  const changed = await api('POST', '/api/sync', {}, token);
  check(changed.json.updated === 1 && changed.json.reviewCount === 1, 'fingerprint change returns a question to review');
  const changedInbox = await api('GET', '/api/inbox', undefined, token);
  check(changedInbox.json[0].prompt === 'Capitale de la France ?', 'inbox shows the updated prompt');
  const changedId = changedInbox.json[0].id;
  await api('PATCH', `/api/questions/${changedId}`, { status: 'approved' }, token);

  // Missing from JSON → rejected.
  writeBankFiles([smokeSprint[0], smokeSprint[1]], smokeMemory, [smokeClimax[0]]);
  const removed = await api('POST', '/api/sync', {}, token);
  check(removed.json.rejected === 1, 'questions removed from JSON are rejected');
  // Restore full climax for the game night.
  writeBankFiles([{ ...smokeSprint[0], prompt: 'Capitale de la France ?' }, smokeSprint[1]], smokeMemory, smokeClimax);
  const restored = await api('POST', '/api/sync', {}, token);
  check(restored.json.added === 1 || restored.json.updated >= 1, 'restored climax question returns for review');
  const restoreInbox = await api('GET', '/api/inbox', undefined, token);
  for (const q of restoreInbox.json) await api('PATCH', `/api/questions/${q.id}`, { status: 'approved' }, token);

  console.log('\nNight plan');
  const approvedAll = (await api('GET', '/api/pile/questions', undefined, token)).json as { id: number; bank: string }[];
  const idsOf = (bank: string) => approvedAll.filter((q) => q.bank === bank).map((q) => q.id);
  const [s1, s2] = idsOf('sprint');
  const memId = idsOf('memory')[0];
  const emptyPlan = await api('GET', '/api/night', undefined, token);
  check(emptyPlan.status === 200 && emptyPlan.json.selected.sprint.length === 0, 'no night is prepared at first');
  const saved = await api('PUT', '/api/night', { selected: { sprint: [s2, s1, s2, memId, 999999], memory: [], climax: [] } }, token);
  check(
    JSON.stringify(saved.json.selected.sprint) === JSON.stringify([s2, s1]),
    'a prepared round keeps its order and drops duplicates, other rounds and unknown ids',
  );
  const preparedPile = await api('GET', '/api/pile', undefined, token);
  check(preparedPile.json.prepared.sprint === 2 && preparedPile.json.prepared.memory === 0, 'the pile summary counts prepared questions');
  const filled = await api('POST', '/api/night/fill', { bank: 'memory' }, token);
  check(
    filled.json.selected.memory.length === idsOf('memory').length && filled.json.selected.sprint.length === 2,
    'filling a round tops it up from the pile without touching the others',
  );
  const cleared = await api('PUT', '/api/night', { selected: { sprint: [], memory: [], climax: [] } }, token);
  check(BANKS.every((b) => cleared.json.selected[b].length === 0), 'a prepared night can be cleared');
  const unauthed = await api('GET', '/api/night');
  check(unauthed.status === 401, 'the night plan needs the PIN');
  check((await api('GET', '/api/guests')).status === 401, 'the guest list needs the PIN');
  const guests = await api('PUT', '/api/guests', { names: [' Ann ', 'Bob', 'Cy', 'ann', ''] }, token);
  check(JSON.stringify(guests.json.names) === '["Ann","Bob","Cy"]', 'guest list is trimmed and deduplicated');

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
  const pile = await api('GET', '/api/pile', undefined, token);
  check(pile.json.tonight.sprint === 2 && pile.json.tonight.memory === 6 && pile.json.tonight.climax === 2, 'a night draws from the whole approved pile');
  await host.cmd({ t: 'game.create' });
  const code = host.state?.joinCode ?? '';
  check(/^[A-Z]{4}$/.test(code) && tv.state?.joinCode === code, `game created with code ${code}, visible on TV`);

  const choices = await api('GET', `/api/join/${code}`);
  check(choices.json?.guests?.length === 3 && choices.json.guests.every((g: { taken: boolean }) => !g.taken), 'phones see the guest list');
  check((await api('GET', '/api/join/ZZZZ')).status === 404, 'no guest list for a wrong code');

  const ann = new Client('Ann');
  const bob = new Client('Bob');
  const cy = new Client('Cy');
  await ann.connect({ t: 'hello', role: 'play', code, name: 'Ann' });
  await bob.connect({ t: 'hello', role: 'play', code, name: 'Bob' });
  await cy.connect({ t: 'hello', role: 'play', code, name: 'Cy' });
  clients.push(ann, bob, cy);
  check(host.state?.players.length === 3, 'three players joined');
  const takenNow = await api('GET', `/api/join/${code}`);
  check(takenNow.json.guests.every((g: { taken: boolean }) => g.taken), 'joined guests show as taken');

  const stranger = new Client('Eve');
  await stranger.connect({ t: 'hello', role: 'play', code, name: 'Eve' });
  check(stranger.errors.length > 0 && host.state?.players.length === 3, 'a name not on the guest list is refused');
  stranger.ws.close();

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
  const afterLeave = await api('GET', `/api/join/${code}`);
  check(afterLeave.json.guests.find((g: { name: string }) => g.name === 'Ann')?.taken === false, 'a disconnected guest can pick their name again');
  const ann2 = new Client('Ann2');
  await ann2.connect({ t: 'hello', role: 'play', code, name: 'ANN' });
  clients.push(ann2);
  check(ann2.playerId === annId && host.state?.players.find((p) => p.id === annId)?.connected === true, 'retyping the name reclaims the same player');
  const players = { ann: ann2, bob, cy };

  console.log('\nOpening: winner predictions');
  await host.cmd({ t: 'phase.set', phase: 'predictions' });
  check(host.state!.predictions.status === 'open', 'predictions open when entering the mini-step');
  check(tv.state!.predictions.picks.length === 0, 'TV does not see pick targets before reveal');
  await players.ann.cmd({ t: 'predict', playerId: players.bob.playerId! });
  await players.bob.cmd({ t: 'predict', playerId: players.bob.playerId! });
  await players.cy.cmd({ t: 'predict', playerId: players.ann.playerId! });
  check(players.ann.state!.predictions.myPick === players.bob.playerId, 'phone keeps its own pick');
  check(players.ann.state!.players.find((p) => p.id === players.ann.playerId)?.hasPick === true, 'hasPick is set on the voter');
  check(
    host.state!.predictions.picks.some((p) => p.voterId === players.ann.playerId && p.targetId === players.bob.playerId),
    'host sees who picked whom',
  );
  await players.ann.cmd({ t: 'predict', playerId: players.ann.playerId! });
  check(players.ann.state!.predictions.myPick === players.ann.playerId, 'picks can change until lock');
  await host.cmd({ t: 'predictions.lock' });
  await players.cy.cmd({ t: 'predict', playerId: players.cy.playerId! });
  check(players.cy.errors.length > 0, 'picks cannot change after lock');
  check(host.state!.predictions.status === 'locked', 'predictions locked');

  console.log('\nPhase 1: Sprint');
  await host.cmd({ t: 'phase.set', phase: 'sprint' });
  await players.bob.cmd({ t: 'buzz' });
  check(host.state?.sprint.status === 'idle', 'buzzing before a question does nothing');
  await host.cmd({ t: 'sprint.next' });
  const shown = tv.state?.sprint.question;
  const hostQ = host.state?.sprint.question;
  check(!!shown?.prompt && shown.prompt === hostQ?.prompt, 'TV shows the question');
  check(shown?.answer === undefined && !!hostQ?.answer, 'answer only goes to the host');
  check(players.bob.state?.sprint.question === null, 'phones never get the prompt');
  check(typeof shown?.image === 'string' && shown.image.startsWith('/media/'), 'TV gets the picture');
  check(!JSON.stringify(players.bob.state).includes('/media/'), 'phones do not receive the picture');
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
  check(secondScore === host.state!.sprint.question!.points, 'award matches the question points');
  await host.cmd({ t: 'sprint.next' });
  check(host.state!.sprint.status === 'asking' && host.state!.sprint.index === 1, 'next question starts');
  await host.cmd({ t: 'sprint.skip' });
  await host.cmd({ t: 'sprint.next' });
  check(host.errors.length > 0, 'no more sprint questions after the last one');

  // Put known scores on the board for the climax.
  const scoreOf = (name: string) => host.state!.players.find((p) => p.name.toLowerCase() === name)!.score;

  console.log('\nPhase 2: Memory Grid');
  await host.cmd({ t: 'phase.set', phase: 'memory' });
  check(host.state!.memory.status === 'playing' && host.state!.memory.tiles.length === 6, '6 tiles shuffled onto the always-face-up grid');
  check(host.state!.memory.tiles.every((t) => t.face === 'open' && !!t.theme && !!t.difficulty), 'themes and difficulties visible on every open tile');
  check(tv.state!.memory.tiles.every((t) => !!t.theme), 'TV also sees themes permanently');
  check(!JSON.stringify(tv.state).includes('Jupiter'), 'TV has no answers in its state');
  check(!JSON.stringify(tv.state!.memory.tiles).includes('Armstrong'), 'peek tiles never leak MCQ answers');

  async function endLeech() {
    if (host.state!.memory.askStatus === 'leeching') await host.cmd({ t: 'memory.endLeech' });
  }

  let sawPhoto = false;
  let sawMcq = false;
  let scoredCoord: string | null = null;
  let turn1: string | null = null;
  while ((!sawPhoto || !sawMcq) && host.state!.memory.tiles.some((x) => x.face === 'open')) {
    const next = host.state!.memory.tiles.find((x) => x.face === 'open')!;
    await host.cmd({ t: 'memory.flip', coord: next.coord });
    check(host.state!.memory.askStatus === 'leeching' && host.state!.memory.leechUntil !== null, 'opening a card starts the leech window');
    const asking = host.state!.memory.asking!;
    if (!sawPhoto && asking.image) {
      check(
        typeof tv.state!.memory.asking?.image === 'string' && tv.state!.memory.asking!.image!.startsWith('/media/'),
        'TV shows the memory photo immediately on flip',
      );
      check(
        typeof host.state!.memory.asking?.image === 'string' && host.state!.memory.asking!.image!.startsWith('/media/'),
        'host sees the memory photo too',
      );
      check(tv.state!.memory.askingCoord === next.coord && !!tv.state!.memory.asking?.prompt, 'TV shows the asked question in a modal');
      check(tv.state!.memory.asking?.answer === undefined && !!host.state!.memory.asking?.answer, 'answer stays on /host');
      check(asking.points === 2 || asking.points === 4 || asking.points === 6, 'grid uses memory point values (2/4/6)');
      const otherOpen = host.state!.memory.tiles.find((x) => x.face === 'open');
      if (otherOpen) {
        await host.cmd({ t: 'memory.flip', coord: otherOpen.coord });
        check(host.errors.length > 0, 'cannot flip a second tile while one is being asked');
      } else {
        await host.cmd({ t: 'memory.flip', coord: 'Z9' });
        check(host.errors.length > 0, 'cannot flip a second tile while one is being asked');
      }
      await host.cmd({ t: 'memory.hint' });
      check(host.errors.length > 0, 'hints are locked during the leech window');
      turn1 = host.state!.memory.turnPlayerId!;
      const leecher = [players.ann, players.bob, players.cy].find((p) => p.playerId !== turn1)!;
      await leecher.cmd({ t: 'answer', text: 'leech-ok' });
      check(host.state!.memory.leeches.some((l) => l.playerId === leecher.playerId && l.text === 'leech-ok'), 'host sees live leech submissions');
      await endLeech();
      check(host.state!.memory.askStatus === 'answering', 'host can end the leech window early');
      const pts = host.state!.memory.asking!.points;
      const before = host.state!.players.find((p) => p.id === turn1)!.score;
      const leecherBefore = host.state!.players.find((p) => p.id === leecher.playerId)!.score;
      await host.cmd({ t: 'memory.resolve', correct: true, leechIds: [leecher.playerId!] });
      const activeAfter = host.state!.players.find((p) => p.id === turn1)!.score;
      const floor = pts === 2 ? 1 : 2;
      const expectedActive = Math.max(floor, pts - 1);
      check(activeAfter === before + expectedActive, `correct answer awards floored payout (${expectedActive}) after one leech`);
      check(
        host.state!.players.find((p) => p.id === leecher.playerId)!.score === leecherBefore + 1,
        'correct leecher receives +1',
      );
      check(host.state!.memory.tiles.find((t) => t.coord === next.coord)!.face === 'consumed', 'tile consumed after a hit');
      check(host.state!.memory.turnPlayerId !== turn1, 'turn moved to the next player (round-robin)');
      scoredCoord = next.coord;
      sawPhoto = true;
      continue;
    }
    if (!sawMcq && asking.isMcq && asking.options?.length === 4) {
      check(tv.state!.memory.asking?.options?.length === 4, 'TV shows four MCQ options on flip for native MCQ');
      check(
        tv.state!.memory.asking?.answer === undefined && host.state!.memory.asking?.answer === 'Armstrong',
        'MCQ answer stays on /host; options do not reveal it on TV',
      );
      await endLeech();
      await host.cmd({ t: 'memory.resolve', correct: true });
      sawMcq = true;
      continue;
    }
    if (asking.options?.length === 4 && !asking.isMcq && asking.difficulty === 'medium') {
      check(tv.state!.memory.asking?.options === undefined, 'open-ended with options hides QCM until the format hint');
      await endLeech();
      await host.cmd({ t: 'memory.hint' });
      check(tv.state!.memory.asking?.options?.length === 4, 'format hint reveals the four options on TV');
      check(host.state!.memory.asking!.points === 2, 'medium format hint halves the card to 2 pts');
      await host.cmd({ t: 'memory.resolve', correct: false });
      continue;
    }
    await endLeech();
    await host.cmd({ t: 'memory.resolve', correct: false });
  }
  check(sawPhoto, 'found the memory photo card');
  check(sawMcq, 'found the memory MCQ card');

  await host.cmd({ t: 'memory.flip', coord: scoredCoord! });
  check(host.errors.length > 0, 'a consumed tile cannot be asked again');
  // The search above may have used every tile, depending on the shuffle.
  const coord2 = host.state!.memory.tiles.find((x) => x.face === 'open')?.coord;
  if (coord2) {
    const turn2 = host.state!.memory.turnPlayerId!;
    const before2 = host.state!.players.find((p) => p.id === turn2)!.score;
    await host.cmd({ t: 'memory.flip', coord: coord2 });
    await endLeech();
    await host.cmd({ t: 'memory.resolve', correct: false });
    check(host.state!.players.find((p) => p.id === turn2)!.score === before2, 'a miss scores nothing for the active player');
    const t2 = host.state!.memory.tiles.find((t) => t.coord === coord2)!;
    check(t2.face === 'consumed' && t2.result === 'miss', 'a missed tile is consumed too and never returns');
  }
  check(
    host.state!.memory.remaining === host.state!.memory.tiles.filter((t) => t.face !== 'consumed').length,
    'remaining matches unconsumed tiles',
  );

  console.log('\nPhase 3: Finale');
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
  check(host.state!.climax.status === 'answering', 'locking bets opens the answer window');
  check(!!tv.state!.climax.question?.prompt && !!players.ann.state!.climax.question?.prompt, 'question shown on TV and phones while answering');
  check(tv.state!.climax.question?.answer === undefined, 'official answer still hidden during typing');
  check(tv.state!.climax.submissions.length === 0, 'TV does not show answers before the timer ends');
  await players.ann.cmd({ t: 'answer', text: 'Deux' });
  await players.bob.cmd({ t: 'answer', text: 'Quatre' });
  check(players.ann.state!.climax.myAnswer === 'Deux', 'phone keeps the typed answer');
  await host.cmd({ t: 'climax.lockAnswers' });
  check(host.state!.climax.status === 'asking', 'locking answers moves to judging');
  check(tv.state!.climax.submissions.length === 2, 'TV shows every bettor name + answer');
  check(
    tv.state!.climax.submissions.some((s) => s.name === 'Ann' && s.text === 'Deux' && s.wager === 6) &&
      tv.state!.climax.submissions.some((s) => s.name === 'Bob' && s.text === 'Quatre' && s.wager === 4),
    'submissions include Ann and Bob answers with wagers',
  );
  await host.cmd({ t: 'climax.judge', playerId: players.ann.playerId!, correct: true });
  check(scoreOf('ann') === 10 + 2 * 6, 'hard correct pays +2× wager (10 -> 22)');
  check(host.state!.climax.status === 'asking', 'round stays open until everybody is judged');
  await host.cmd({ t: 'climax.judge', playerId: players.bob.playerId!, correct: false });
  check(scoreOf('bob') === 0, 'wrong answer wipes the wagered points (4 -> 0)');
  check(tv.state!.climax.status === 'resolved' && tv.state!.climax.question?.answer !== undefined, 'round resolved, answer revealed on TV');

  // Medium payout: Ann bets 5 on a medium question and wins → +5 (2× total).
  const mediumQ = host.state!.climax.candidates.find((c) => c.difficulty === 'medium')!;
  await host.cmd({ t: 'climax.pick', questionId: mediumQ.id });
  await host.cmd({ t: 'climax.openBetting' });
  await players.ann.cmd({ t: 'bet', amount: 5 });
  await host.cmd({ t: 'climax.lockBets' });
  await players.ann.cmd({ t: 'answer', text: 'Hitchcock' });
  await host.cmd({ t: 'climax.lockAnswers' });
  await host.cmd({ t: 'climax.judge', playerId: players.ann.playerId!, correct: true });
  check(scoreOf('ann') === 22 + 5, 'medium correct pays +1× wager (22 -> 27)');

  console.log('\nReveal predictions');
  // Ann leads with 27; she picked herself earlier → +5. Bob picked himself (wrong). Cy picked Ann (correct).
  await host.cmd({ t: 'phase.set', phase: 'reveal' });
  check(host.state!.predictions.winnerIds.includes(players.ann.playerId!), 'Ann is frozen as #1 for the bet');
  check(tv.state!.predictions.picks.length === 0 && tv.state!.predictions.revealIndex === -1, 'TV starts on the teaser');
  await host.cmd({ t: 'reveal.all' });
  check(tv.state!.predictions.picks.length === 3, 'TV shows every pick after reveal.all');
  await host.cmd({ t: 'reveal.award' });
  check(scoreOf('ann') === 27 + 5, 'correct prediction awards +5 to Ann');
  check(scoreOf('cy') === 5, 'correct prediction awards +5 to Cy');
  check(scoreOf('bob') === 0, 'wrong prediction awards nothing');
  check(host.state!.predictions.awarded === true, 'bonus flagged as awarded');

  const askedDb = new Database(path.join(dataDir, 'quizz-in.db'));
  const askedCount = (askedDb.prepare('SELECT COUNT(DISTINCT question_id) AS n FROM question_asks').get() as { n: number }).n;
  askedDb.close();
  check(askedCount >= 5, `asked questions are remembered for the next night (${askedCount})`);

  console.log('\nSnapshot / restart');
  await host.cmd({ t: 'phase.set', phase: 'results' });
  await sleep(500); // snapshot is debounced
  const joinCode = code;
  const seq = host.state!.seq;
  server.kill();
  await new Promise((r) => server.once('exit', r));
  const server2 = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'src/server/index.ts'], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, PICTURES_DIR: picturesDir, HOST_PIN: PIN },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise<void>((resolve) => server2.stdout!.on('data', (d) => String(d).includes('Quizz In is running') && resolve()));
  const tv2 = new Client('tv2');
  await tv2.connect({ t: 'hello', role: 'tv' });
  clients.push(tv2);
  check(tv2.state?.joinCode === joinCode && tv2.state.seq === seq && tv2.state.phase === 'results', 'game resumed from the snapshot after a restart');
  check(tv2.state?.players.find((p) => p.name === 'Ann')?.score === 32, 'scores survived the restart');
  const ann3 = new Client('Ann3');
  await ann3.connect({ t: 'hello', role: 'play', code: joinCode, name: 'ann' });
  clients.push(ann3);
  check(ann3.playerId === annId, 'player rejoins by retyping their name after a restart');

  console.log('\nStats');
  const token2 = (await api('POST', '/api/auth', { pin: PIN })).json.token;
  const host2 = new Client('host2');
  await host2.connect({ t: 'hello', role: 'host', token: token2 });
  clients.push(host2);
  await host2.cmd({ t: 'game.end' });
  const statsDb = new Database(path.join(dataDir, 'quizz-in.db'), { readonly: true });
  const games = statsDb.prepare('SELECT id, ended_at FROM games').all() as { id: number; ended_at: number | null }[];
  check(games.length === 1 && games[0].ended_at !== null, 'the game is recorded once, with its end time');
  const finals = statsDb.prepare('SELECT name, score, rank FROM game_players ORDER BY rank, name').all() as {
    name: string;
    score: number;
    rank: number;
  }[];
  check(finals[0]?.name === 'Ann' && finals[0].score === 32 && finals[0].rank === 1 && finals.length === 3, 'final scores and ranks are kept');
  const sums = new Map(
    (statsDb.prepare('SELECT player, SUM(points) AS pts FROM plays WHERE player IS NOT NULL GROUP BY player').all() as {
      player: string;
      pts: number;
    }[]).map((r) => [r.player, r.pts]),
  );
  check(finals.every((f) => (sums.get(f.name) ?? 0) === f.score), 'recorded plays add up to every final score');
  const predictionRows = statsDb.prepare("SELECT player, correct, answer FROM plays WHERE round = 'prediction'").all() as {
    player: string;
    correct: number;
    answer: string;
  }[];
  check(
    predictionRows.length === 3 && predictionRows.some((r) => r.player === 'Bob' && r.correct === 0 && r.answer === 'Bob'),
    'winner predictions are recorded with who was picked',
  );
  const climaxRow = statsDb.prepare("SELECT wager, answer, points FROM plays WHERE round = 'climax' AND player = 'Ann' ORDER BY id LIMIT 1").get() as
    | { wager: number; answer: string; points: number }
    | undefined;
  check(climaxRow?.wager === 6 && climaxRow.answer === 'Deux' && climaxRow.points === 12, 'finale rows keep the wager and typed answer');
  check(
    (statsDb.prepare("SELECT COUNT(*) AS n FROM plays WHERE round = 'sprint' AND correct = 0").get() as { n: number }).n >= 1,
    'wrong sprint buzzes are recorded',
  );
  statsDb.close();
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
    fs.rmSync(picturesDir, { recursive: true, force: true });
  } catch {
    // Windows may still hold the SQLite file for a moment; the OS temp folder gets cleaned up eventually.
  }
}

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
