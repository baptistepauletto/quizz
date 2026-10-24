import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { initialOf } from '../lib/colors';
import { useNow } from './ui';

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/** Round badge with the player's initial, in their color. */
export function Token({ name, color, className = '' }: { name: string; color?: string; className?: string }) {
  return (
    <span className={`token ${className}`} style={{ '--pc': color } as CSSProperties} aria-hidden="true">
      {initialOf(name)}
    </span>
  );
}

/** Animates a number from its previous value to the new one. */
export function useCountUp(value: number, ms = 700): number {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = from.current;
    if (start === value || reducedMotion()) {
      from.current = value;
      setShown(value);
      return;
    }
    const t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / ms);
      const eased = 1 - (1 - k) ** 3;
      const v = Math.round(start + (value - start) * eased);
      from.current = v;
      setShown(v);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return shown;
}

export function CountUp({ value, ms }: { value: number; ms?: number }) {
  return <>{useCountUp(value, ms)}</>;
}

/** True for `ms` after `key` changes to a non-null value. */
export function useFlash(key: string | number | null, ms: number): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (key === null) return;
    setOn(true);
    const id = setTimeout(() => setOn(false), ms);
    return () => clearTimeout(id);
  }, [key, ms]);
  return on;
}

/** One finite burst of paper. Remount (change `key`) to fire again. */
export function Confetti({ colors, count = 90, duration = 3.2 }: { colors: readonly string[]; count?: number; duration?: number }) {
  const pieces = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        left: Math.random() * 100,
        delay: Math.random() * 0.6,
        dur: duration * (0.7 + Math.random() * 0.5),
        drift: (Math.random() - 0.5) * 30,
        spin: 360 + Math.random() * 720,
        w: 0.5 + Math.random() * 0.5,
        color: colors[i % colors.length],
        round: Math.random() < 0.25,
      })),
    [colors, count, duration],
  );
  if (reducedMotion()) return null;
  return (
    <div className="confetti" aria-hidden="true">
      {pieces.map((p, i) => (
        <i
          key={i}
          className={p.round ? 'round' : ''}
          style={
            {
              left: `${p.left}%`,
              background: p.color,
              width: `${p.w}em`,
              animationDelay: `${p.delay}s`,
              animationDuration: `${p.dur}s`,
              '--drift': `${p.drift}vw`,
              '--spin': `${p.spin}deg`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}

/** Draining ring around the seconds left. The full circle is whatever was left when `until` first appeared. */
export function CountdownRing({ until, className = '' }: { until: number | null; className?: string }) {
  const now = useNow(100);
  const total = useRef<{ until: number | null; ms: number }>({ until: null, ms: 1 });
  if (until && total.current.until !== until) total.current = { until, ms: Math.max(1, until - Date.now()) };
  const leftMs = until ? Math.max(0, until - now) : 0;
  const frac = Math.min(1, leftMs / total.current.ms);
  const seconds = Math.ceil(leftMs / 1000);
  const C = 2 * Math.PI * 42;
  return (
    <svg className={`ring ${seconds <= 5 ? 'urgent' : ''} ${className}`} viewBox="0 0 100 100" role="img" aria-label={`${seconds} secondes`}>
      <circle className="ring-track" cx="50" cy="50" r="42" />
      <circle
        className="ring-fill"
        cx="50"
        cy="50"
        r="42"
        strokeDasharray={C}
        strokeDashoffset={C * (1 - frac)}
        transform="rotate(-90 50 50)"
      />
      <text x="50" y="50" dominantBaseline="central" textAnchor="middle">
        {seconds}
      </text>
    </svg>
  );
}

/** Light-bulb frame, like a game-show set. The child needs an opaque background. */
export function Marquee({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`marquee ${className}`}>{children}</div>;
}

// --- casino chips -------------------------------------------------------------

interface Denomination {
  value: number;
  face: string;
  stripe: string;
  ink: string;
}

const DENOMINATIONS: Denomination[] = [
  { value: 100, face: '#1d1530', stripe: '#e7a23a', ink: '#ffd27a' },
  { value: 25, face: '#1f8a5b', stripe: '#f4efe4', ink: '#f4efe4' },
  { value: 10, face: '#2f63d6', stripe: '#f4efe4', ink: '#f4efe4' },
  { value: 5, face: '#d23553', stripe: '#f4efe4', ink: '#f4efe4' },
  { value: 1, face: '#f4efe4', stripe: '#3a2868', ink: '#1a1230' },
];

const MAX_CHIPS = 12;

/** Greedy split into casino denominations, largest at the bottom of the stack. */
export function chipsFor(amount: number): Denomination[] {
  const out: Denomination[] = [];
  let left = Math.max(0, Math.floor(amount));
  for (const d of DENOMINATIONS) {
    while (left >= d.value && out.length < MAX_CHIPS) {
      out.push(d);
      left -= d.value;
    }
  }
  return out;
}

export type StackMode = 'empty' | 'secret' | 'shown' | 'won' | 'lost';

/**
 * A stack of chips seen from the side. While bets are secret the chips are in the
 * player's color with their initial on top; once revealed they are real
 * denominations with the amount on top.
 */
export function ChipStack({
  mode,
  amount = 0,
  color,
  name = '',
}: {
  mode: StackMode;
  amount?: number;
  color?: string;
  name?: string;
}) {
  if (mode === 'empty') return <div className="chip-stack empty" aria-hidden="true" />;

  const chips: Denomination[] =
    mode === 'secret'
      ? Array.from({ length: 3 }, () => ({ value: 0, face: color ?? '#3a2868', stripe: '#f4efe4', ink: '#1a1230' }))
      : chipsFor(amount);
  if (chips.length === 0) chips.push({ value: 0, face: '#271c3c', stripe: '#5c4d78', ink: '#b3a7c9' });
  const label = mode === 'secret' ? initialOf(name) : String(amount);

  return (
    <div
      className={`chip-stack ${mode}`}
      style={{ '--n': chips.length } as CSSProperties}
      role="img"
      aria-label={mode === 'secret' ? 'Mise cachée' : `${amount} points misés`}
      key={`${mode}-${amount}`}
    >
      {chips.map((c, i) => (
        <span
          key={i}
          className="cchip"
          style={{ '--i': i, '--face': c.face, '--stripe': c.stripe, '--label': c.ink } as CSSProperties}
        >
          {i === chips.length - 1 && <b>{label}</b>}
        </span>
      ))}
    </div>
  );
}

/** A single chip seen from above, used as a button on the phone. */
export function ChipButton({ value, onClick, disabled }: { value: number; onClick: () => void; disabled?: boolean }) {
  const d = DENOMINATIONS.find((x) => x.value === value) ?? DENOMINATIONS[DENOMINATIONS.length - 1];
  return (
    <button
      type="button"
      className="chip-btn"
      style={{ '--face': d.face, '--stripe': d.stripe, '--label': d.ink } as CSSProperties}
      onClick={onClick}
      disabled={disabled}
      aria-label={`Ajouter ${value}`}
    >
      <b>+{value}</b>
    </button>
  );
}
