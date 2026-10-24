import { useEffect, useState } from 'react';

const FLIP_MS = 950;
const AUTO_FLIP_MS = 20_000;

function PixelLetterZ({ x, y = 22 }: { x: number; y?: number }) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      <rect x="0" y="0" width="18" height="5" />
      <rect x="0" y="23" width="18" height="5" />
      <rect x="13" y="5" width="5" height="2" />
      <rect x="11" y="7" width="5" height="2" />
      <rect x="10" y="9" width="5" height="2" />
      <rect x="8" y="11" width="5" height="2" />
      <rect x="6" y="13" width="6" height="2" />
      <rect x="5" y="15" width="5" height="2" />
      <rect x="3" y="17" width="5" height="2" />
      <rect x="2" y="19" width="5" height="2" />
      <rect x="0" y="21" width="5" height="2" />
    </g>
  );
}

/** Pixel-art "Quizz In" wordmark. Size it with `font-size` (the art is 2.2em tall). */
export function Logo({
  steam = true,
  autoFlip = true,
  className = '',
}: {
  steam?: boolean;
  autoFlip?: boolean;
  className?: string;
}) {
  const [flipping, setFlipping] = useState(false);

  useEffect(() => {
    if (!autoFlip) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const interval = setInterval(() => {
      setFlipping(true);
      timer = setTimeout(() => setFlipping(false), FLIP_MS);
    }, AUTO_FLIP_MS);
    return () => {
      clearInterval(interval);
      clearTimeout(timer);
    };
  }, [autoFlip]);

  return (
    <span className={`logo ${flipping ? 'flipping' : ''} ${className}`}>
      {/* viewBox must keep its 0,0 origin: the animation transform-origins are in user units. */}
      <svg viewBox="0 0 204 60" shapeRendering="crispEdges" role="img" aria-label="Quizz In">
        {/* Q - frying pan */}
        <g className="logo-pan">
          <path d="M34,45 h3 v1 h1 v1 h1 v1 h1 v1 h1 v1 h1 v1 h1 v1 h1 v1 h1 v1 h1 v1 h1 v3 h-3 v-1 h-1 v-1 h-1 v-1 h-1 v-1 h-1 v-1 h-1 v-1 h-1 v-1 h-1 v-1 h-1 v-1 h-1 v-1 h-1 z" fill="#e8e2d0" />
          <path d="M35,46 h2 v1 h1 v1 h1 v1 h1 v1 h1 v1 h1 v1 h1 v1 h1 v1 h1 v1 h1 v2 h-2 v-1 h-1 v-1 h-1 v-1 h-1 v-1 h-1 v-1 h-1 v-1 h-1 v-1 h-1 v-1 h-1 z" fill="#565449" />
          <rect x="44" y="56" width="1" height="1" fill="#161922" />
          <path d="M18,22 h12 v1 h3 v1 h2 v2 h2 v3 h1 v12 h-1 v3 h-2 v2 h-2 v1 h-3 v1 h-12 v-1 h-3 v-1 h-2 v-2 h-2 v-3 h-1 v-12 h1 v-3 h2 v-2 h2 v-1 h3 z" fill="#e8e2d0" />
          <path d="M19,24 h10 v1 h3 v1 h1 v1 h1 v3 h1 v10 h-1 v3 h-1 v1 h-1 v1 h-3 v1 h-10 v-1 h-3 v-1 h-1 v-1 h-1 v-3 h-1 v-10 h1 v-3 h1 v-1 h1 v-1 h3 z" fill="#3a3a3c" />
          <path d="M19,24 h10 v1 h3 v1 h-16 v-1 h3 z M13,30 h1 v10 h-1 z" fill="#2c2c2e" />
          <path d="M19,47 h10 v1 h-10 z M34,31 h1 v9 h-1 z" fill="#48484a" />
          <g className="logo-shadow">
            <path d="M19,30 h10 v1 h2 v10 h-2 v1 h-10 v-1 h-2 v-10 h2 z" fill="#222224" opacity="0.45" />
          </g>
        </g>

        {/* Sunny-side-up egg */}
        <g className="logo-egg">
          <path d="M20,29 h8 v1 h2 v1 h1 v9 h-1 v2 h-2 v1 h-8 v-1 h-2 v-1 h-1 v-9 h1 v-2 h2 z" fill="#d8d4c5" />
          <path d="M20,29 h8 v1 h2 v1 h1 v8 h-1 v2 h-2 v1 h-8 v-1 h-2 v-1 h-1 v-8 h1 v-2 h2 z" fill="#f5f3eb" />
          <path d="M22,32 h4 v1 h1 v4 h-1 v1 h-4 v-1 h-1 v-4 h1 z" fill="#d99316" />
          <path d="M22,32 h4 v1 h1 v3 h-1 v1 h-4 v-1 h-1 v-3 h1 z" fill="#f5b82e" />
          <rect x="22" y="33" width="2" height="2" fill="#ffda66" />
          <rect x="22" y="33" width="1" height="1" fill="#fffdf5" />
        </g>

        {/* Sizzle sparks */}
        <g className="logo-sizzle">
          <rect x="15" y="28" width="1" height="1" fill="#f5b82e" />
          <rect x="32" y="27" width="1" height="1" fill="#fffdf5" />
          <rect x="14" y="39" width="1" height="1" fill="#fffdf5" />
          <rect x="33" y="40" width="1" height="1" fill="#f5b82e" />
        </g>

        {/* U I Z Z */}
        <g fill="#f5f3eb">
          <path d="M43,22 h5 v23 h8 v-23 h5 v24 h-1 v2 h-2 v2 h-12 v-2 h-2 v-2 h-1 z" />
          <path d="M66,22 h12 v5 h-3 v18 h3 v5 h-12 v-5 h3 v-18 h-3 z" />
          <PixelLetterZ x={83} />
          <PixelLetterZ x={106} />
        </g>

        {/* Chef's hat on the 2nd Z */}
        <g className="logo-hat">
          <path d="M117,10 h7 v1 h3 v1 h3 v2 h3 v5 h-1 v2 h-2 v2 h-1 v3 h-6 v-1 h-4 v-1 h-4 v-1 h-1 v-3 h1 v-2 h-2 v-4 h1 v-2 h2 v-1 h1 z" fill="#161922" />
          <path d="M118,11 h6 v1 h3 v1 h2 v2 h2 v3 h-1 v1 h-2 v1 h-11 v-1 h-2 v-3 h1 v-2 h2 z" fill="#f5f3eb" />
          <path d="M127,14 h2 v1 h2 v3 h-1 v1 h-3 v-2 h1 v-2 h-1 z M120,16 h1 v3 h-1 z M124,16 h1 v3 h-1 z" fill="#d9d4c5" />
          <path d="M116,18 h4 v1 h5 v1 h4 v3 h-4 v-1 h-5 v-1 h-4 z" fill="#e6e1d3" />
          <path d="M116,20 h4 v1 h5 v1 h4 v1 h-4 v-1 h-5 v-1 h-4 z" fill="#bab3a0" />
        </g>

        {steam && (
          <g>
            <g className="logo-steam-1">
              <rect x="163" y="9" width="2" height="2" fill="#8c8c8e" />
              <rect x="162" y="11" width="2" height="2" fill="#b5b2a8" />
              <rect x="163" y="13" width="2" height="2" fill="#b5b2a8" />
              <rect x="164" y="15" width="2" height="2" fill="#757578" />
            </g>
            <g className="logo-steam-2">
              <rect x="173" y="8" width="2" height="2" fill="#b5b2a8" />
              <rect x="172" y="10" width="2" height="2" fill="#8c8c8e" />
              <rect x="173" y="12" width="2" height="2" fill="#b5b2a8" />
              <rect x="174" y="14" width="2" height="3" fill="#757578" />
            </g>
          </g>
        )}

        {/* IN - terracotta baking dish */}
        <g>
          <path d="M139,30 h3 v12 h-3 v-1 h-1 v-10 h1 z" fill="#e6b85c" />
          <rect x="139" y="32" width="3" height="8" fill="#8f2c11" />
          <path d="M196,30 h3 v1 h1 v10 h-1 v1 h-3 z" fill="#e6b85c" />
          <rect x="196" y="32" width="3" height="8" fill="#8f2c11" />
          <path d="M144,20 h50 v1 h1 v1 h1 v28 h-1 v1 h-1 v1 h-50 v-1 h-1 v-1 h-1 v-28 h1 v-1 h1 z" fill="#e6b85c" />
          <path d="M145,22 h48 v1 h1 v26 h-1 v1 h-48 v-1 h-1 v-26 h1 z" fill="#b03a1a" />
          <rect x="145" y="22" width="48" height="2" fill="#8f2c11" />
          <rect x="145" y="48" width="48" height="2" fill="#c84622" />
          <g fill="#f2b632">
            <path d="M152,27 h10 v4 h-3 v10 h3 v4 h-10 v-4 h3 v-10 h-3 z" />
            <rect x="168" y="27" width="4" height="18" />
            <rect x="182" y="27" width="4" height="18" />
            <rect x="172" y="29" width="2" height="4" />
            <rect x="174" y="31" width="2" height="4" />
            <rect x="176" y="33" width="2" height="4" />
            <rect x="178" y="35" width="2" height="4" />
            <rect x="180" y="37" width="2" height="4" />
          </g>
        </g>
      </svg>
    </span>
  );
}
