import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PinGate } from '../components/PinGate';
import { DifficultyChip } from '../components/ui';
import { ApiError, api } from '../lib/api';
import { BANKS } from '../../shared/types';
import type { Bank, PileSummary, QuestionDto, QuestionStatus, SyncResult } from '../../shared/types';

const BANK_LABEL: Record<Bank, string> = {
  sprint: 'Sprint',
  memory: 'Grille',
  climax: 'Finale',
};

export function PrepHome() {
  return (
    <PinGate>
      <PrepHub />
    </PinGate>
  );
}

export function PilePage() {
  return (
    <PinGate>
      <PileBrowser />
    </PinGate>
  );
}

function PrepHub() {
  const [pile, setPile] = useState<PileSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api<PileSummary>('GET', '/api/pile')
      .then(setPile)
      .catch((e) => e instanceof ApiError && e.status === 401 && location.reload());
  }, []);
  useEffect(load, [load]);

  async function sync() {
    setBusy(true);
    setError('');
    setSyncMsg('');
    try {
      const res = await api<SyncResult>('POST', '/api/sync');
      const parts = [
        res.added ? `${res.added} nouvelle${res.added > 1 ? 's' : ''}` : '',
        res.updated ? `${res.updated} mise${res.updated > 1 ? 's' : ''} à jour` : '',
        res.rejected ? `${res.rejected} rejetée${res.rejected > 1 ? 's' : ''} (retirée${res.rejected > 1 ? 's' : ''} du JSON)` : '',
        res.unchanged ? `${res.unchanged} inchangée${res.unchanged > 1 ? 's' : ''}` : '',
      ].filter(Boolean);
      setSyncMsg(parts.length ? parts.join(' · ') : 'Rien à synchroniser');
      if (res.problems.length) {
        setError(res.problems.map((p) => `${p.file}: ${p.problems[0]}`).join('\n'));
      }
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <div className="topbar">
        <h1 className="brand">
          Préparation <span>/ questions</span>
        </h1>
        <Link to="/" className="muted">
          accueil
        </Link>
      </div>

      {pile === null && <p className="muted">Chargement…</p>}

      {pile && (
        <>
          <section className="stack">
            <h2>Le tas</h2>
            <p className="muted">
              {BANKS.map((b) => `${BANK_LABEL[b]} ${pile.approved[b]}`).join(' · ')}
              {pile.rejected > 0 ? ` · ${pile.rejected} rejetée${pile.rejected > 1 ? 's' : ''}` : ''}
            </p>
            <div className="row wrap">
              {BANKS.map((b) => (
                <Link key={b} to={`/prep/pile?bank=${b}`} className="chip ok" style={{ textDecoration: 'none' }}>
                  {BANK_LABEL[b]} · {pile.approved[b]}
                </Link>
              ))}
              <Link to="/prep/pile" className="btn" style={{ textDecoration: 'none' }}>
                Voir les validées
              </Link>
            </div>
          </section>

          <section className="stack">
            <h2>À relire</h2>
            {pile.draft > 0 ? (
              <Link to="/prep/swipe" className="btn primary big" style={{ textAlign: 'center', textDecoration: 'none' }}>
                Relire {pile.draft} question{pile.draft > 1 ? 's' : ''}
              </Link>
            ) : (
              <p className="muted">Rien en attente. Synchronise après avoir modifié drafts/*.json.</p>
            )}
          </section>

          <section className="stack">
            <button className="btn ghost" disabled={busy} onClick={sync}>
              {busy ? 'Sync…' : 'Synchroniser drafts/'}
            </button>
            <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
              Compare sprint.json, memory.json et climax.json avec la base. Nouveautés et modifications reviennent à relire.
            </p>
            {syncMsg && <p className="muted">{syncMsg}</p>}
            {error && (
              <p className="error" style={{ whiteSpace: 'pre-wrap' }}>
                {error}
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function PileBrowser() {
  const [search, setSearch] = useSearchParams();
  const raw = search.get('bank') ?? '';
  const bank: 'all' | Bank = BANKS.includes(raw as Bank) ? (raw as Bank) : 'all';
  const [questions, setQuestions] = useState<QuestionDto[] | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    const q = bank === 'all' ? '' : `?bank=${bank}`;
    api<QuestionDto[]>('GET', `/api/pile/questions${q}`)
      .then(setQuestions)
      .catch((e: Error) => setError(e.message));
  }, [bank]);
  useEffect(load, [load]);

  async function setStatus(q: QuestionDto, status: QuestionStatus) {
    await api('PATCH', `/api/questions/${q.id}`, { status });
    load();
  }

  const groups = useMemo(() => {
    const map = new Map<string, QuestionDto[]>();
    for (const q of questions ?? []) {
      const key = `${q.bank}::${q.theme}`;
      const list = map.get(key) ?? [];
      list.push(q);
      map.set(key, list);
    }
    return [...map.entries()].map(([key, items]) => ({
      key,
      bank: items[0].bank,
      theme: items[0].theme,
      contributor: items[0].contributor,
      items,
    }));
  }, [questions]);

  function setBank(next: 'all' | Bank) {
    if (next === 'all') setSearch({});
    else setSearch({ bank: next });
  }

  return (
    <div className="page">
      <div className="topbar">
        <Link to="/prep" className="muted">
          ← préparation
        </Link>
        <span className="muted">{questions?.length ?? '…'} validées</span>
      </div>
      <h1>Questions validées</h1>

      <div className="row wrap">
        {(['all', ...BANKS] as const).map((b) => (
          <button
            key={b}
            type="button"
            className={`chip ${bank === b ? 'hard' : ''}`}
            style={{ border: 0, cursor: 'pointer' }}
            onClick={() => setBank(b)}
          >
            {b === 'all' ? 'tout' : BANK_LABEL[b]}
          </button>
        ))}
      </div>

      {error && <p className="error">{error}</p>}
      {questions === null && <p className="muted">Chargement…</p>}
      {questions?.length === 0 && <p className="muted">Aucune question validée dans ce filtre.</p>}

      {groups.map((g) => (
        <div key={g.key} className="card stack">
          <div className="row wrap">
            <b className="grow">{g.theme}</b>
            <span className="chip">{BANK_LABEL[g.bank]}</span>
            {g.contributor && <span className="muted">{g.contributor}</span>}
          </div>
          {g.items.map((q) => (
            <div key={q.id} className="stack" style={{ borderTop: '1px solid var(--line)', paddingTop: 10 }}>
              <div className="row wrap">
                <DifficultyChip difficulty={q.difficulty} />
                <span className="chip muted">{q.sourceId}</span>
                <span className="chip ok">validée</span>
              </div>
              {q.image && <div className="muted">Photo : {q.image}</div>}
              <div>{q.prompt}</div>
              {q.options && (
                <div className="muted">
                  QCM : {q.options.map((o, i) => `${'ABCD'[i]}. ${o}`).join(' · ')}
                </div>
              )}
              <div className="muted">
                Réponse : <b style={{ color: 'var(--text)' }}>{q.answer}</b>
              </div>
              <div className="row">
                <button className="btn small bad" onClick={() => setStatus(q, 'rejected')}>
                  Rejeter
                </button>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
