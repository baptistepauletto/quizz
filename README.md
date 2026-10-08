# Quizz In

Local multiplayer trivia for a living room: one PC runs the server and shows the TV, everyone else uses their phone on the same Wi-Fi. The on-screen UI is in French; code and this README stay in English.

| Route | Who | What |
|-------|-----|------|
| `/tv` | TV PC | Join code + QR, scoreboard, grid, question modal, podium |
| `/play` | Players (via QR) | Buzzer, secret bets |
| `/host` | You (phone) | Read answers, award points, change phase (PIN) |
| `/prep` | You (phone) | Import JSON drafts, swipe to approve/discard (PIN) |

## Run it

```powershell
npm install
npm run build
$env:HOST_PIN = "4242"      # choose your own; default is 1234 with a warning
npm start                   # listens on 0.0.0.0:3000 (PORT to change)
```

1. Open `http://localhost:3000/tv` on the TV PC. Press `i` on the TV page to cycle LAN addresses if the QR uses the wrong network adapter.
2. On your phone open `http://<lan-ip>:3000/prep`, enter the PIN, import a draft, and swipe to approve. Approved questions join one shared pile.
3. Open `/host` and draw tonight's hand from that pile. Players scan the QR. Questions already asked wait at the bottom until the fresh ones run out.
4. If phones can't connect, allow Node.js through Windows Firewall (private networks).

Dev mode with hot reload: `npm run dev` (client on 5173, server on 3000).

Data lives in `data/quizz-in.db` (override with `DATA_DIR`). The running game is snapshotted, so a server restart resumes it.

## Game rules

- Points: easy 1, medium 3, hard 5. Wrong answers cost nothing (except Phase 3).
- **Sprint**: first buzz (server arrival time) wins. Host says Correct / Wrong. Wrong reopens the buzzer, the previous buzzer is locked out for that question.
- **Memory Grid**: themes face-up for 30s, then face-down. Players take turns round-robin and call a coordinate (e.g. `B3`); host flips it. The tile is consumed on hit or miss.
- **Double or Nothing**: players with 0 points sit out. Secret wager up to your score; correct = wager tripled (+2x net), wrong = wager lost.
- Reconnect by retyping your name.

## Draft JSON format

```json
{
  "title": "Friday night",
  "sprint": [{ "theme": "General knowledge", "questions": [
    { "prompt": "Capital of Australia?", "answer": "Canberra", "difficulty": "medium", "notes": "optional" },
    { "prompt": "Who is this?", "answer": "Corentin", "difficulty": "medium", "image": "friends/corentin.jpg" }
  ]}],
  "memory": [{ "theme": "Cinema", "contributor": "Alice", "questions": [ /* same shape, no image */ ] }],
  "climax": [{ "theme": "Space", "questions": [ /* same shape, no image */ ] }]
}
```

`difficulty` is `easy | medium | hard`. A sprint question can set `image` to a file inside the `pictures/` folder (see `pictures/README.md`). The TV blurs it, then sharpens it while people buzz. Phones never get the picture.

Imports are review batches, not separate nights. Everything you approve goes into one pile. Starting a night draws 8 sprint, 16 memory and 4 finale questions (or fewer, if the pile is smaller): never-asked first, then the ones asked longest ago. Sprint keeps a mix of difficulties. Memory spreads across themes.

Draft JSON files live in `drafts/` (for example `drafts/example.json` and `drafts/pictures.json`). Import them on `/prep`, swipe to approve, and they join the shared pile. The smoke test's questions live only inside `scripts/smoke.ts` and are thrown away with the test database. Marking an import finished still requires one approved question in each bank; that mark is only a reminder. The night itself only needs the pile to have one approved question in each bank.

## Theme board

Before a game night, friends open one page, set a nickname, and claim a theme. The list is stored in a Google Sheet. How to deploy it is in `signup/README.md`. The name you add is kept next to the nickname they choose.

## Testing

- `npm run smoke` – end-to-end server test with fake clients and a temporary DB.
- `npm run bots -- <CODE> <N>` – N fake players join room `<CODE>` and buzz/bet randomly.
- `npm run typecheck`

The audio layer is intentionally silent: gameplay events are already emitted and mapped in `src/client/lib/sfx.ts`, ready for sound files later.
