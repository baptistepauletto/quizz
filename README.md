# Quizz In

Local multiplayer trivia for a living room: one PC runs the server and shows the TV, everyone else uses their phone on the same Wi-Fi.

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
2. On your phone open `http://<lan-ip>:3000/prep`, enter the PIN, import a draft, swipe, then mark the pack **ready**.
3. Open `/host`, pick the pack, start the game. Players scan the QR.
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
    { "prompt": "Capital of Australia?", "answer": "Canberra", "difficulty": "medium", "notes": "optional" }
  ]}],
  "memory": [{ "theme": "Cinema", "contributor": "Alice", "questions": [ /* same shape */ ] }],
  "climax": [{ "theme": "Space", "questions": [ /* same shape */ ] }]
}
```

`difficulty` is `easy | medium | hard`. See `drafts/example.json`. A pack can be marked ready only when each bank has at least one approved question.

## Testing

- `npm run smoke` – end-to-end server test with fake clients and a temporary DB.
- `npm run bots -- <CODE> <N>` – N fake players join room `<CODE>` and buzz/bet randomly.
- `npm run typecheck`

The audio layer is intentionally silent: gameplay events are already emitted and mapped in `src/client/lib/sfx.ts`, ready for sound files later.
