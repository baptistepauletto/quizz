import { createHash, timingSafeEqual } from 'node:crypto';

// One shared PIN protects /prep and /host. Set HOST_PIN in the environment.
export const usingDefaultPin = !process.env.HOST_PIN;
const PIN = process.env.HOST_PIN ?? '1234';

// The token is derived from the PIN so it survives server restarts
// (the host phone does not have to log in again mid-game).
const TOKEN = createHash('sha256').update(`quizz-in:${PIN}`).digest('hex');

const MAX_FAILURES = 5;
const LOCKOUT_MS = 30_000;
let failures = 0;
let lockedUntil = 0;

export type LoginResult = { ok: true; token: string } | { ok: false; retryInMs: number };

export function login(pin: string): LoginResult {
  const now = Date.now();
  if (now < lockedUntil) return { ok: false, retryInMs: lockedUntil - now };

  if (safeEqual(pin, PIN)) {
    failures = 0;
    return { ok: true, token: TOKEN };
  }
  failures += 1;
  if (failures >= MAX_FAILURES) {
    failures = 0;
    lockedUntil = now + LOCKOUT_MS;
    return { ok: false, retryInMs: LOCKOUT_MS };
  }
  return { ok: false, retryInMs: 0 };
}

export function isValidToken(token: unknown): boolean {
  return typeof token === 'string' && safeEqual(token, TOKEN);
}

export function tokenFromHeader(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const m = /^Bearer\s+(.+)$/i.exec(header);
  return m?.[1];
}

function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}
