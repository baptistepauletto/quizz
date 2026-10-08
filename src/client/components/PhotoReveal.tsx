import { useEffect, useMemo, useRef, useState } from 'react';

export type RevealMode = 'blur' | 'pixel' | 'zoomIn' | 'zoomOut';

const MODES: RevealMode[] = ['blur', 'pixel', 'zoomIn', 'zoomOut'];
const DURATION_MS = 12_000;
/** Close-up that pulls back to 1×. */
const ZOOM_IN_START = 12;
/** Tiny / pulled-out view that grows up to 1×. */
const ZOOM_OUT_START = 0.12;
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

export function PhotoReveal({ src, questionId, phase }: Props) {
  const mode = useMemo(() => pickMode(questionId), [questionId]);
  const clear = phase === 'resolved';
  const frozen = phase === 'locked';

  if (mode === 'pixel') {
    return <PixelReveal src={src} clear={clear} frozen={frozen} questionId={questionId} />;
  }
  if (mode === 'zoomIn' || mode === 'zoomOut') {
    return (
      <ZoomReveal
        src={src}
        clear={clear}
        frozen={frozen}
        questionId={questionId}
        from={mode === 'zoomIn' ? ZOOM_IN_START : ZOOM_OUT_START}
      />
    );
  }
  return <BlurReveal src={src} clear={clear} frozen={frozen} questionId={questionId} />;
}

function BlurReveal({
  src,
  clear,
  frozen,
  questionId,
}: {
  src: string;
  clear: boolean;
  frozen: boolean;
  questionId: number;
}) {
  const className = ['reveal-photo', 'reveal-blur', clear ? 'clear' : '', frozen && !clear ? 'frozen' : '']
    .filter(Boolean)
    .join(' ');
  return (
    <div className="reveal-frame">
      <img key={questionId} className={className} src={src} alt="" />
    </div>
  );
}

function ZoomReveal({
  src,
  clear,
  frozen,
  questionId,
  from,
}: {
  src: string;
  clear: boolean;
  frozen: boolean;
  questionId: number;
  /** Scale at t=0; always ends at 1. */
  from: number;
}) {
  const imgRef = useRef<HTMLImageElement>(null);
  const startRef = useRef(0);
  const freezeAtRef = useRef<number | null>(null);
  const rafRef = useRef(0);
  const origin = useMemo(() => pickOrigin(questionId), [questionId]);

  useEffect(() => {
    freezeAtRef.current = null;
    startRef.current = performance.now();
  }, [src, questionId, from]);

  useEffect(() => {
    if (frozen && freezeAtRef.current === null) {
      freezeAtRef.current = Math.min(1, (performance.now() - startRef.current) / DURATION_MS);
    }
    if (!frozen && !clear) freezeAtRef.current = null;
  }, [frozen, clear]);

  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;

    img.style.transformOrigin = `${origin.x * 100}% ${origin.y * 100}%`;

    const apply = (progress: number) => {
      const p = clear ? 1 : Math.min(1, Math.max(0, progress));
      // Ease out so the last seconds settle into a readable frame.
      const eased = 1 - Math.pow(1 - p, 2);
      const scale = from + (1 - from) * eased;
      img.style.transform = `scale(${scale})`;
    };

    const tick = (now: number) => {
      const t = clear ? 1 : frozen && freezeAtRef.current !== null ? freezeAtRef.current : (now - startRef.current) / DURATION_MS;
      apply(t);
      if (!clear && !frozen && t < 1) rafRef.current = requestAnimationFrame(tick);
    };

    if (clear) {
      apply(1);
      return;
    }
    if (frozen) {
      apply(freezeAtRef.current ?? 0);
      return;
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [src, questionId, clear, frozen, from, origin.x, origin.y]);

  return (
    <div className="reveal-frame reveal-frame-zoom">
      <img key={questionId} ref={imgRef} className="reveal-photo reveal-zoom" src={src} alt="" />
    </div>
  );
}

function PixelReveal({
  src,
  clear,
  frozen,
  questionId,
}: {
  src: string;
  clear: boolean;
  frozen: boolean;
  questionId: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const startRef = useRef(0);
  const freezeAtRef = useRef<number | null>(null);
  const rafRef = useRef(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    freezeAtRef.current = null;
    startRef.current = performance.now();
    setReady(false);
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      imgRef.current = img;
      setReady(true);
    };
    img.src = src;
    return () => {
      cancelAnimationFrame(rafRef.current);
      imgRef.current = null;
    };
  }, [src, questionId]);

  useEffect(() => {
    if (frozen && freezeAtRef.current === null) {
      freezeAtRef.current = Math.min(1, (performance.now() - startRef.current) / DURATION_MS);
    }
    if (!frozen && !clear) freezeAtRef.current = null;
  }, [frozen, clear]);

  useEffect(() => {
    if (!ready) return;
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;

    const draw = (t: number) => {
      const progress = clear ? 1 : frozen && freezeAtRef.current !== null ? freezeAtRef.current : Math.min(1, t);
      const block = Math.max(1, Math.round(48 * (1 - progress) + 1 * progress));
      const w = canvas.clientWidth || 640;
      const h = canvas.clientHeight || 360;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = '#1a1230';
      ctx.fillRect(0, 0, w, h);

      const scale = Math.min(w / img.naturalWidth, h / img.naturalHeight);
      const dw = img.naturalWidth * scale;
      const dh = img.naturalHeight * scale;
      const dx = (w - dw) / 2;
      const dy = (h - dh) / 2;

      if (progress >= 0.98) {
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
      ctx.drawImage(tiny, 0, 0, sw, sh, dx, dy, dw, dh);
    };

    const tick = (now: number) => {
      const t = (now - startRef.current) / DURATION_MS;
      draw(t);
      if (!clear && !frozen && t < 1) rafRef.current = requestAnimationFrame(tick);
    };

    if (clear) {
      draw(1);
      return;
    }
    if (frozen) {
      draw(freezeAtRef.current ?? 0);
      return;
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [ready, clear, frozen, src]);

  return (
    <div className="reveal-frame reveal-frame-pixel">
      <canvas ref={canvasRef} className="reveal-canvas" aria-hidden />
    </div>
  );
}
