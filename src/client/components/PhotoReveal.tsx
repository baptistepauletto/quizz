import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';

export type RevealMode = 'blur' | 'pixel' | 'zoomIn' | 'zoomOut';

const MODES: RevealMode[] = ['blur', 'pixel', 'zoomIn', 'zoomOut'];
const DURATION_MS = 12_000;
/** Close-up that pulls back to 1×. */
const ZOOM_IN_START = 12;
/** Tiny / pulled-out view that grows up to 1×. */
const ZOOM_OUT_START = 0.12;
const BLUR_START_PX = 28;
/** Keep focus away from dead empty corners. */
const ORIGIN_MIN = 0.15;
const ORIGIN_MAX = 0.85;

function hashSeed(seed: number): number {
  // Stable for this question id so a re-render does not swap the pattern mid-reveal.
  let x = (seed * 2654435761) >>> 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return x >>> 0;
}

function pickMode(seed: number): RevealMode {
  return MODES[hashSeed(seed) % MODES.length];
}

/** Off-center focal point so zooms do not always land on the middle of the photo. */
function pickOrigin(seed: number): { x: number; y: number } {
  const h = hashSeed(seed ^ 0x9e3779b9);
  const span = ORIGIN_MAX - ORIGIN_MIN;
  const x = ORIGIN_MIN + ((h & 0xffff) / 0xffff) * span;
  const y = ORIGIN_MIN + (((h >>> 16) & 0xffff) / 0xffff) * span;
  return { x, y };
}

type Phase = 'asking' | 'locked' | 'resolved';

interface Props {
  src: string;
  questionId: number;
  phase: Phase;
}

/**
 * Reveal progress from 0 to 1. Time spent locked on a buzz does not count, so a
 * wrong answer picks the reveal up exactly where it stopped.
 */
function useRevealClock(questionId: number, frozen: boolean, clear: boolean): () => number {
  const clock = useRef({ start: 0, pausedAt: null as number | null });

  useLayoutEffect(() => {
    const now = performance.now();
    clock.current = { start: now, pausedAt: null };
  }, [questionId]);

  useLayoutEffect(() => {
    const c = clock.current;
    const now = performance.now();
    if (frozen && c.pausedAt === null) c.pausedAt = now;
    if (!frozen && c.pausedAt !== null) {
      c.start += now - c.pausedAt;
      c.pausedAt = null;
    }
  }, [frozen, questionId]);

  return useCallback(() => {
    if (clear) return 1;
    const c = clock.current;
    return Math.min(1, Math.max(0, ((c.pausedAt ?? performance.now()) - c.start) / DURATION_MS));
  }, [clear]);
}

/** Calls `paint` every frame while the reveal runs, once otherwise (and again on resize). */
function useRevealLoop(
  progress: () => number,
  paint: (p: number) => void,
  running: boolean,
  target: RefObject<Element | null>,
  deps: unknown[],
) {
  useEffect(() => {
    let raf = 0;
    const frame = () => {
      const p = progress();
      paint(p);
      if (running && p < 1) raf = requestAnimationFrame(frame);
    };
    frame();
    const el = target.current;
    const ro = el ? new ResizeObserver(() => paint(progress())) : null;
    if (el) ro!.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
    };
  }, [progress, running, ...deps]);
}

export function PhotoReveal({ src, questionId, phase }: Props) {
  const mode = useMemo(() => pickMode(questionId), [questionId]);
  const clear = phase === 'resolved';
  const frozen = phase === 'locked';
  const progress = useRevealClock(questionId, frozen, clear);
  const running = !clear && !frozen;

  if (mode === 'pixel') return <PixelReveal key={questionId} src={src} progress={progress} running={running} />;
  return (
    <TransformReveal
      key={questionId}
      src={src}
      mode={mode}
      origin={pickOrigin(questionId)}
      progress={progress}
      running={running}
    />
  );
}

/** Blur and zoom: both are a style on the <img> recomputed from progress. */
function TransformReveal({
  src,
  mode,
  origin,
  progress,
  running,
}: {
  src: string;
  mode: Exclude<RevealMode, 'pixel'>;
  origin: { x: number; y: number };
  progress: () => number;
  running: boolean;
}) {
  const imgRef = useRef<HTMLImageElement>(null);

  const paint = (p: number) => {
    const img = imgRef.current;
    if (!img) return;
    // Ease out so the last seconds settle into a readable frame.
    const eased = 1 - Math.pow(1 - p, 2);
    if (mode === 'blur') {
      img.style.filter = p >= 1 ? 'none' : `blur(${BLUR_START_PX * (1 - p)}px)`;
      img.style.transform = `scale(${1.12 - 0.12 * p})`;
      return;
    }
    const from = mode === 'zoomIn' ? ZOOM_IN_START : ZOOM_OUT_START;
    img.style.transformOrigin = `${origin.x * 100}% ${origin.y * 100}%`;
    img.style.transform = `scale(${from + (1 - from) * eased})`;
  };

  useRevealLoop(progress, paint, running, imgRef, [mode, src]);

  return (
    <div className="reveal-frame">
      <img ref={imgRef} className="reveal-photo reveal-live" src={src} alt="" />
    </div>
  );
}

function PixelReveal({ src, progress, running }: { src: string; progress: () => number; running: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    setImg(null);
    const next = new Image();
    next.decoding = 'async';
    next.onload = () => setImg(next);
    next.src = src;
    return () => {
      next.onload = null;
    };
  }, [src]);

  const paint = (p: number) => {
    const canvas = canvasRef.current;
    if (!canvas || !img) return;
    const block = Math.max(1, Math.round(48 * (1 - p) + 1 * p));
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0 || h === 0) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cw = Math.round(w * dpr);
    const ch = Math.round(h * dpr);
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#1a1230';
    ctx.fillRect(0, 0, w, h);

    const scale = Math.min(w / img.naturalWidth, h / img.naturalHeight);
    const dw = img.naturalWidth * scale;
    const dh = img.naturalHeight * scale;
    const dx = (w - dw) / 2;
    const dy = (h - dh) / 2;

    if (p >= 0.98) {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(img, dx, dy, dw, dh);
      return;
    }

    const sw = Math.max(1, Math.ceil(dw / block));
    const sh = Math.max(1, Math.ceil(dh / block));
    const tiny = document.createElement('canvas');
    tiny.width = sw;
    tiny.height = sh;
    const tctx = tiny.getContext('2d');
    if (!tctx) return;
    tctx.imageSmoothingEnabled = true;
    tctx.drawImage(img, 0, 0, sw, sh);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tiny, 0, 0, sw, sh, dx, dy, dw, dh);
  };

  useRevealLoop(progress, paint, running, canvasRef, [img]);

  return (
    <div className="reveal-frame">
      <canvas ref={canvasRef} className="reveal-canvas" aria-hidden />
    </div>
  );
}
