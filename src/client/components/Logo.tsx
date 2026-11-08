import { useEffect, useId, useState } from 'react';

const SPIN_MS = 1100;
const AUTO_SPIN_MS = 20_000;
const DISPLAY = "'Abril Fatface', Didot, 'Bodoni MT', Georgia, serif";

/** Art Deco "Quizz In" wordmark: a copper chip, a Didone "Quizz" and a neon "IN". Size it with `font-size` (2.2em tall). */
export function Logo({ autoSpin = true, className = '' }: { autoSpin?: boolean; className?: string }) {
  const [spinning, setSpinning] = useState(false);
  const glow = `logo-glow-${useId().replace(/:/g, '')}`;

  useEffect(() => {
    if (!autoSpin) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const interval = setInterval(() => {
      setSpinning(true);
      timer = setTimeout(() => setSpinning(false), SPIN_MS);
    }, AUTO_SPIN_MS);
    return () => {
      clearInterval(interval);
      clearTimeout(timer);
    };
  }, [autoSpin]);

  return (
    <span className={`logo ${spinning ? 'spinning' : ''} ${className}`}>
      <svg viewBox="0 0 300 80" role="img" aria-label="Quizz In">
        <defs>
          <filter id={glow} x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="2.4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* casino chip with the Q */}
        <g className="logo-chip">
          <circle cx="40" cy="40" r="35" fill="#6e3d1a" />
          <circle cx="40" cy="38" r="35" fill="#b87333" />
          <circle cx="40" cy="38" r="30" fill="none" stroke="#f4efe4" strokeWidth="8" strokeDasharray="9 14.56" />
          <circle cx="40" cy="38" r="23" fill="#0a1128" stroke="#e0a878" strokeWidth="1.5" />
          <circle cx="40" cy="38" r="19" fill="none" stroke="#e0a878" strokeWidth="1" strokeDasharray="2 2.5" opacity="0.8" />
          <text x="40" y="49" textAnchor="middle" fontFamily={DISPLAY} fontSize="31" fill="#f4efe4">
            Q
          </text>
        </g>

        {/* "Quizz" with a stepped copper shadow */}
        <g fontFamily={DISPLAY} fontSize="46">
          <text x="88" y="56" textLength="124" lengthAdjust="spacingAndGlyphs" fill="#6e3d1a">
            Quizz
          </text>
          <text x="86" y="54" textLength="124" lengthAdjust="spacingAndGlyphs" fill="#b87333">
            Quizz
          </text>
          <text x="84" y="52" textLength="124" lengthAdjust="spacingAndGlyphs" fill="#f4efe4">
            Quizz
          </text>
        </g>
        <path d="M84 66h54M154 66h54" stroke="#b87333" strokeWidth="1.5" />
        <path d="M146 61l5 5-5 5-5-5z" fill="#ff2e88" />

        {/* neon "IN" sign */}
        <g className="logo-neon" filter={`url(#${glow})`}>
          <rect x="222" y="14" width="70" height="52" rx="10" fill="#1c0a0c" fillOpacity="0.55" stroke="#ff2e88" strokeWidth="3" />
          <text
            x="257"
            y="53"
            textAnchor="middle"
            fontFamily="'Segoe UI', system-ui, sans-serif"
            fontWeight="800"
            fontSize="36"
            textLength="44"
            lengthAdjust="spacingAndGlyphs"
            fill="none"
            stroke="#ff2e88"
            strokeWidth="3"
            strokeLinejoin="round"
          >
            IN
          </text>
        </g>
        <g className="logo-neon" pointerEvents="none">
          <rect x="222" y="14" width="70" height="52" rx="10" fill="none" stroke="#ffd1e6" strokeWidth="1" />
          <text
            x="257"
            y="53"
            textAnchor="middle"
            fontFamily="'Segoe UI', system-ui, sans-serif"
            fontWeight="800"
            fontSize="36"
            textLength="44"
            lengthAdjust="spacingAndGlyphs"
            fill="none"
            stroke="#ffe6f1"
            strokeWidth="1"
          >
            IN
          </text>
        </g>
      </svg>
    </span>
  );
}
