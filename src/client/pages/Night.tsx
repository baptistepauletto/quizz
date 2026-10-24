import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PinGate } from '../components/PinGate';
import { DifficultyChip } from '../components/ui';
import { api } from '../lib/api';
import { BANKS, DIFFICULTIES, NIGHT_SIZE } from '../../shared/types';
import type { Bank, NightPlanDto, QuestionDto } from '../../shared/types';

const BANK_LABEL: Record<Bank, string> = {
  sprint: 'Sprint',
  memory: 'Grille',
  climax: 'Finale',
};

const DIFFICULTY_LABEL = { easy: 'faciles', medium: 'moyennes', hard: 'dures' } as const;

type Selection = Record<Bank, number[]>;

export function NightPage() {
  return (
    <PinGate>
      <NightPlanner />
    </PinGate>
  );
}

function shuffled<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function Thumb({ image }: { image: string | null }) {
  if (!image) return null;
  const src = '/media/' + image.split('/').map(encodeURIComponent).join('/');
  return <img className="night-thumb" src={src} alt="" loading="lazy" />;
}

const dateFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });

/** Saves the whole selection shortly after the last edit; edits made meanwhile win over the server echo. */
function useAutosave(onSaved: (plan: NightPlanDto) => void) {
  const timer = useRef<number | undefined>(undefined);
  const version = useRef(0);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const saveNow = useCallback(
    async (selection: Selection) => {
      window.clearTimeout(timer.current);
      const mine = ++version.current;
      setStatus('saving');
      try {
        const res = await api<NightPlanDto>('PUT', '/api/night', { selected: selection });
        if (mine === version.current) {
          onSaved(res);
          setStatus('saved');
        }
      } catch {
        if (mine === version.current) setStatus('error');
      }
    },
    [onSaved],
  );

  const schedule = useCallback(
    (selection: Selection) => {
      window.clearTimeout(timer.current);
      version.current++;
      setStatus('saving');
      timer.current = window.setTimeout(() => void saveNow(selection), 400);
    },
    [saveNow],
  );

  useEffect(() => () => window.clearTimeout(timer.current), []);
  return { status, schedule, saveNow };
}

function NightPlanner() {
  const [search, setSearch] = useSearchParams();
  const raw = search.get('bank') ?? '';
  const bank: Bank = BANKS.includes(raw as Bank) ? (raw as Bank) : 'sprint';

  const [questions, setQuestions] = useState<QuestionDto[] | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [asked, setAsked] = useState<Record<number, number>>({});
  const [filter, setFilter] = useState('');
  const [hideAsked, setHideAsked] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const applyPlan = useCallback((plan: NightPlanDto) => {
    setSelection(plan.selected);
    setAsked(plan.asked);
  }, []);
  const { status, schedule, saveNow } = useAutosave(applyPlan);

  useEffect(() => {
    Promise.all([api<QuestionDto[]>('GET', '/api/pile/questions'), api<NightPlanDto>('GET', '/api/night')])
      .then(([qs, plan]) => {
        setQuestions(qs);
        applyPlan(plan);
      })
      .catch((e: Error) => setError(e.message));
  }, [applyPlan]);

  const byId = useMemo(() => new Map((questions ?? []).map((q) => [q.id, q])), [questions]);
  const inBank = useMemo(() => (questions ?? []).filter((q) => q.bank === bank), [questions, bank]);
  const picked = selection?.[bank] ?? [];
  const pickedSet = useMemo(() => new Set(picked), [picked]);
  const target = NIGHT_SIZE[bank];
  const full = picked.length >= target;
  const ordered = bank !== 'memory';

  const groups = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const map = new Map<string, QuestionDto[]>();
    for (const q of inBank) {
      if (hideAsked && asked[q.id] && !pickedSet.has(q.id)) continue;
      if (needle && !`${q.theme} ${q.prompt} ${q.answer}`.toLowerCase().includes(needle)) continue;
      const list = map.get(q.theme) ?? [];
      list.push(q);
      map.set(q.theme, list);
    }
    return [...map.entries()].map(([theme, items]) => ({ theme, items }));
  }, [inBank, filter, hideAsked, asked, pickedSet]);

  const mix = useMemo(() => {
    const counts = { easy: 0, medium: 0, hard: 0 };
    for (const id of picked) {
      const q = byId.get(id);
      if (q) counts[q.difficulty] += 1;
    }
    return counts;
  }, [picked, byId]);

  function update(nextIds: number[]) {
    if (!selection) return;
    const next = { ...selection, [bank]: nextIds };
    setSelection(next);
    schedule(next);
  }

  function toggle(id: number) {
    if (pickedSet.has(id)) update(picked.filter((x) => x !== id));
    else if (!full) update([...picked, id]);
  }

  function toggleTheme(items: QuestionDto[]) {
    const allIn = items.every((q) => pickedSet.has(q.id));
    if (allIn) {
      const drop = new Set(items.map((q) => q.id));
      update(picked.filter((id) => !drop.has(id)));
      return;
    }
    const add = items.filter((q) => !pickedSet.has(q.id)).map((q) => q.id);
    update([...picked, ...add].slice(0, target));
  }

  function move(index: number, delta: number) {
    const next = [...picked];
    const j = index + delta;
    if (j < 0 || j >= next.length) return;
    [next[index], next[j]] = [next[j], next[index]];
    update(next);
  }

  async function fill() {
    if (!selection) return;
    setBusy(true);
    setError('');
    try {
      await saveNow(selection);
      applyPlan(await api<NightPlanDto>('POST', '/api/night/fill', { bank }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function setBank(next: Bank) {
    setSearch({ bank: next });
    setFilter('');
  }

  const available = inBank.length;
  const statusText =
    status === 'saving' ? 'Enregistrement…' : status === 'saved' ? 'Enregistré' : status === 'error' ? 'Pas enregistré' : '';

  return (
    <div className="page night">
      <div className="topbar">
        <Link to="/prep" className="muted">
          ← préparation
        </Link>
        <span className={`muted save-status ${status}`}>{statusText}</span>
      </div>
      <h1>Préparer la soirée</h1>

      <div className="night-tabs" role="tablist">
        {BANKS.map((b) => {
          const n = selection?.[b].length ?? 0;
          return (
            <button
              key={b}
              type="button"
              role="tab"
              aria-selected={b === bank}
              className={`night-tab ${b === bank ? 'on' : ''} ${n >= NIGHT_SIZE[b] ? 'done' : ''}`}
              onClick={() => setBank(b)}
            >
              <span>{BANK_LABEL[b]}</span>
              <b>
                {n} / {NIGHT_SIZE[b]}
              </b>
            </button>
          );
        })}
      </div>

      {error && <p className="error">{error}</p>}
      {(questions === null || selection === null) && !error && <p className="muted">Chargement…</p>}

      {questions && selection && (
        <>
          <section className="card stack">
            <div className="night-meter" style={{ '--fill': `${Math.min(1, picked.length / target) * 100}%` } as CSSProperties}>
              <span />
            </div>
            <p className="muted" style={{ margin: 0 }}>
              {picked.length === 0
                ? `Rien de choisi : ${Math.min(target, available)} questions seront tirées au hasard au lancement.`
                : picked.length < target
                  ? `La manche se jouera avec ces ${picked.length} questions. Il en faut ${target} pour une manche complète.`
                  : 'Manche complète.'}
              {available < target ? ` Il n’y a que ${available} questions validées ici.` : ''}
            </p>
            {bank === 'sprint' && picked.length > 0 && (
              <div className="row wrap">
                {DIFFICULTIES.map((d) => (
                  <span key={d} className={`chip ${d}`}>
                    {mix[d]} {DIFFICULTY_LABEL[d]}
                  </span>
                ))}
              </div>
            )}
            <div className="row wrap">
              <button className="btn small primary" disabled={busy || full || available <= picked.length} onClick={fill}>
                Compléter au hasard
              </button>
              {ordered && (
                <button className="btn small" disabled={picked.length < 2} onClick={() => update(shuffled(picked))}>
                  Mélanger l’ordre
                </button>
              )}
              <button className="btn small ghost" disabled={picked.length === 0} onClick={() => update([])}>
                Vider
              </button>
            </div>
          </section>

          {ordered && picked.length > 0 && (
            <section className="stack">
              <h2>Ordre de passage</h2>
              <ol className="night-order">
                {picked.map((id, i) => {
                  const q = byId.get(id);
                  if (!q) return null;
                  return (
                    <li key={id}>
                      <span className="night-num">{i + 1}</span>
                      <Thumb image={q.image} />
                      <span className="grow night-order-text">
                        <span>{q.prompt}</span>
                        <small className="muted">{q.answer}</small>
                      </span>
                      <span className="night-order-tools">
                        <button className="btn small ghost" aria-label="Monter" disabled={i === 0} onClick={() => move(i, -1)}>
                          ↑
                        </button>
                        <button
                          className="btn small ghost"
                          aria-label="Descendre"
                          disabled={i === picked.length - 1}
                          onClick={() => move(i, 1)}
                        >
                          ↓
                        </button>
                        <button className="btn small ghost" aria-label="Retirer" onClick={() => toggle(id)}>
                          ×
                        </button>
                      </span>
                    </li>
                  );
                })}
              </ol>
            </section>
          )}

          <section className="stack">
            <h2>Questions validées · {BANK_LABEL[bank]}</h2>
            <input
              className="input"
              placeholder="Chercher un thème, une question, une réponse…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            <label className="row muted" style={{ fontSize: '0.9rem' }}>
              <input type="checkbox" checked={hideAsked} onChange={(e) => setHideAsked(e.target.checked)} />
              Cacher les questions déjà posées
            </label>
            {groups.length === 0 && <p className="muted">Aucune question ici.</p>}
            {groups.map((g) => {
              const n = g.items.filter((q) => pickedSet.has(q.id)).length;
              const allIn = n === g.items.length;
              return (
                <div key={g.theme} className="card stack">
                  <div className="row">
                    <b className="grow">{g.theme}</b>
                    <span className="muted">
                      {n} / {g.items.length}
                    </span>
                    <button
                      className="btn small ghost"
                      disabled={!allIn && full}
                      onClick={() => toggleTheme(g.items)}
                    >
                      {allIn ? 'Aucune' : 'Toutes'}
                    </button>
                  </div>
                  {g.items.map((q) => {
                    const on = pickedSet.has(q.id);
                    const when = asked[q.id];
                    return (
                      <button
                        key={q.id}
                        type="button"
                        className={`pick ${on ? 'on' : ''}`}
                        aria-pressed={on}
                        disabled={!on && full}
                        onClick={() => toggle(q.id)}
                      >
                        <span className="pick-box">{on ? (ordered ? picked.indexOf(q.id) + 1 : '✓') : ''}</span>
                        <span className="pick-body">
                          <span className="pick-tags">
                            <DifficultyChip difficulty={q.difficulty} />
                            {when && <span className="chip bad">posée le {dateFmt.format(when)}</span>}
                          </span>
                          <span>{q.prompt}</span>
                          <small className="muted">Réponse : {q.answer}</small>
                        </span>
                        <Thumb image={q.image} />
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </section>
        </>
      )}
    </div>
  );
}
