import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { PinGate } from '../components/PinGate';
import { DifficultyChip, OptionsList } from '../components/ui';
import { api } from '../lib/api';
import type { Bank, QuestionDto, QuestionStatus } from '../../shared/types';

const THRESHOLD = 110;

const BANK_LABEL: Record<Bank | 'all', string> = {
  all: 'tout',
  sprint: 'sprint',
  memory: 'grille',
  climax: 'finale',
};

export function Swipe() {
  return (
    <PinGate>
      <SwipeDeck />
    </PinGate>
  );
}

function SwipeDeck() {
  const [questions, setQuestions] = useState<QuestionDto[] | null>(null);
  const [bank, setBank] = useState<'all' | Bank>('all');
  const [history, setHistory] = useState<number[]>([]);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api<QuestionDto[]>('GET', '/api/inbox')
      .then(setQuestions)
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  const setLocal = useCallback((qid: number, status: QuestionStatus) => {
    setQuestions((list) => list && list.map((q) => (q.id === qid ? { ...q, status } : q)));
  }, []);

  const decide = useCallback(
    async (q: QuestionDto, status: 'approved' | 'rejected') => {
      setLocal(q.id, status);
      setHistory((h) => [...h, q.id]);
      try {
        await api('PATCH', `/api/questions/${q.id}`, { status });
      } catch (e) {
        setLocal(q.id, 'draft');
        setHistory((h) => h.filter((x) => x !== q.id));
        setError((e as Error).message);
      }
    },
    [setLocal],
  );

  const undo = useCallback(async () => {
    const last = history[history.length - 1];
    if (last === undefined) return;
    setHistory((h) => h.slice(0, -1));
    setLocal(last, 'draft');
    try {
      await api('PATCH', `/api/questions/${last}`, { status: 'draft' });
    } catch (e) {
      setError((e as Error).message);
    }
  }, [history, setLocal]);

  const queue = questions?.filter((q) => q.status === 'draft' && (bank === 'all' || q.bank === bank)) ?? [];
  const top = queue[0];
  const next = queue[1];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' && top) decide(top, 'approved');
      else if (e.key === 'ArrowLeft' && top) decide(top, 'rejected');
      else if (e.key.toLowerCase() === 'z') undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [top, decide, undo]);

  if (!questions) return <div className="page muted">{error || 'Chargement…'}</div>;

  const approved = questions.filter((q) => q.status === 'approved').length;
  const rejected = questions.filter((q) => q.status === 'rejected').length;

  return (
    <div className="page">
      <div className="topbar">
        <Link to="/prep" className="muted">
          ← préparation
        </Link>
        <span className="muted">
          {queue.length} restantes · {approved} gardées · {rejected} écartées
        </span>
      </div>

      <div className="row wrap">
        {(['all', 'sprint', 'memory', 'climax'] as const).map((b) => (
          <button key={b} className={`chip ${bank === b ? 'hard' : ''}`} style={{ border: 0, cursor: 'pointer' }} onClick={() => setBank(b)}>
            {BANK_LABEL[b]}
          </button>
        ))}
      </div>

      <div className="deck">
        {!top && (
          <div className="card center stack" style={{ height: '100%', justifyContent: 'center' }}>
            <h2>Tout est relu</h2>
            <p className="muted">Les questions gardées sont dans le tas. Resync si tu modifies encore le JSON.</p>
            <Link to="/prep" className="btn primary">
              Retour
            </Link>
          </div>
        )}
        {next && <CardBody q={next} behind />}
        {top && <DraggableCard key={top.id} q={top} onDecide={(s) => decide(top, s)} />}
      </div>

      {error && <p className="error">{error}</p>}
      <div className="swipe-actions">
        <button className="btn bad" aria-label="Écarter" disabled={!top} onClick={() => top && decide(top, 'rejected')}>
          ✕
        </button>
        <button className="btn" aria-label="Annuler" disabled={history.length === 0} onClick={undo}>
          ↶
        </button>
        <button className="btn ok" aria-label="Garder" disabled={!top} onClick={() => top && decide(top, 'approved')}>
          ✓
        </button>
      </div>
      <p className="muted center" style={{ fontSize: '0.85rem' }}>
        Swipe à droite pour garder, à gauche pour écarter. Flèches et Z (annuler) sur ordinateur.
      </p>
    </div>
  );
}

function DraggableCard({ q, onDecide }: { q: QuestionDto; onDecide: (s: 'approved' | 'rejected') => void }) {
  const [dx, setDx] = useState(0);
  const [leaving, setLeaving] = useState<'approved' | 'rejected' | null>(null);
  const startX = useRef<number | null>(null);

  const fling = (s: 'approved' | 'rejected') => {
    setLeaving(s);
    setDx(s === 'approved' ? window.innerWidth : -window.innerWidth);
    setTimeout(() => onDecide(s), 180);
  };

  return (
    <CardBody
      q={q}
      dx={dx}
      animate={leaving !== null || startX.current === null}
      handlers={{
        onPointerDown: (e) => {
          if (leaving) return;
          startX.current = e.clientX;
          e.currentTarget.setPointerCapture(e.pointerId);
        },
        onPointerMove: (e) => {
          if (startX.current !== null && !leaving) setDx(e.clientX - startX.current);
        },
        onPointerUp: () => {
          const moved = dx;
          startX.current = null;
          if (leaving) return;
          if (moved > THRESHOLD) fling('approved');
          else if (moved < -THRESHOLD) fling('rejected');
          else setDx(0);
        },
        onPointerCancel: () => {
          startX.current = null;
          setDx(0);
        },
      }}
    />
  );
}

interface CardBodyProps {
  q: QuestionDto;
  behind?: boolean;
  dx?: number;
  animate?: boolean;
  handlers?: React.HTMLAttributes<HTMLDivElement>;
}

function CardBody({ q, behind, dx = 0, animate, handlers }: CardBodyProps) {
  const strength = Math.min(1, Math.abs(dx) / THRESHOLD);
  return (
    <div
      className={`swipe-card ${behind ? 'behind' : ''}`}
      style={
        behind
          ? undefined
          : {
              transform: `translateX(${dx}px) rotate(${dx / 18}deg)`,
              transition: animate ? 'transform 0.18s ease-out' : 'none',
              cursor: 'grab',
            }
      }
      {...handlers}
    >
      <span className="swipe-stamp yes" style={{ opacity: dx > 0 ? strength : 0 }}>
        OUI
      </span>
      <span className="swipe-stamp no" style={{ opacity: dx < 0 ? strength : 0 }}>
        NON
      </span>
      <div className="row wrap">
        <span className="chip">{BANK_LABEL[q.bank]}</span>
        <span className="chip muted">{q.sourceId}</span>
        <b>{q.theme}</b>
        {q.contributor && <span className="muted">· {q.contributor}</span>}
      </div>
      <DifficultyChip difficulty={q.difficulty} />
      {q.image && <img className="q-photo" src={'/media/' + q.image.split('/').map(encodeURIComponent).join('/')} alt="" />}
      <div className="prompt">{q.prompt}</div>
      {q.options && <OptionsList options={q.options} correct={q.answer} />}
      <div className="answer">
        <div className="muted" style={{ fontSize: '0.8rem' }}>
          Réponse
        </div>
        <b>{q.answer}</b>
        {q.notes && <div className="muted" style={{ marginTop: 6, fontSize: '0.9rem' }}>{q.notes}</div>}
      </div>
    </div>
  );
}
