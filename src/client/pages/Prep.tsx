import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { PinGate } from '../components/PinGate';
import { DifficultyChip } from '../components/ui';
import { ApiError, api } from '../lib/api';
import { BANKS } from '../../shared/types';
import type { DraftFile, PackDetail, PackSummary, QuestionDto, QuestionStatus } from '../../shared/types';
import samplePack from '../../../drafts/example.json';

const EXAMPLE: DraftFile = {
  title: 'Friday night',
  sprint: [{ theme: 'General knowledge', questions: [{ prompt: 'Capital of France?', answer: 'Paris', difficulty: 'easy' }] }],
  memory: [
    {
      theme: 'Space',
      contributor: 'Alice',
      questions: [{ prompt: 'Largest planet?', answer: 'Jupiter', difficulty: 'easy', notes: 'optional host note' }],
    },
  ],
  climax: [{ theme: 'Cinema', questions: [{ prompt: 'Who directed Psycho?', answer: 'Hitchcock', difficulty: 'medium' }] }],
};

function totals(pack: PackSummary) {
  const t = { draft: 0, approved: 0, rejected: 0 };
  for (const b of BANKS) for (const k of ['draft', 'approved', 'rejected'] as const) t[k] += pack.counts[b][k];
  return t;
}

export function PrepHome() {
  return (
    <PinGate>
      <PrepList />
    </PinGate>
  );
}

function PrepList() {
  const navigate = useNavigate();
  const [packs, setPacks] = useState<PackSummary[] | null>(null);
  const [text, setText] = useState('');
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api<PackSummary[]>('GET', '/api/packs')
      .then(setPacks)
      .catch((e) => e instanceof ApiError && e.status === 401 && location.reload());
  }, []);
  useEffect(load, [load]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) setText(await file.text());
    e.target.value = '';
  }

  const sample = samplePack as DraftFile;
  const sampleAlready = packs?.find((p) => p.title === sample.title);

  async function importSample() {
    setProblems([]);
    setBusy(true);
    try {
      const res = await api<{ id: number }>('POST', '/api/import', { draft: sample });
      navigate(`/prep/${res.id}/swipe`);
    } catch (err) {
      setProblems(err instanceof ApiError && err.problems.length ? err.problems : [(err as Error).message]);
    } finally {
      setBusy(false);
    }
  }

  async function doImport() {
    setProblems([]);
    let draft: unknown;
    try {
      draft = JSON.parse(text);
    } catch (err) {
      return setProblems([`That is not valid JSON: ${(err as Error).message}`]);
    }
    setBusy(true);
    try {
      const res = await api<{ id: number }>('POST', '/api/import', { draft });
      setText('');
      navigate(`/prep/${res.id}`);
    } catch (err) {
      setProblems(err instanceof ApiError && err.problems.length ? err.problems : [(err as Error).message]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <div className="topbar">
        <h1 className="brand">
          Prep <span>/ packs</span>
        </h1>
        <Link to="/" className="muted">
          home
        </Link>
      </div>

      <section className="stack">
        <h2>Your packs</h2>
        {packs === null && <p className="muted">Loading…</p>}
        {packs?.length === 0 && <p className="muted">No pack yet. Import a JSON draft below.</p>}
        {packs?.map((p) => {
          const t = totals(p);
          return (
            <Link key={p.id} to={`/prep/${p.id}`} className="card row" style={{ textDecoration: 'none', color: 'inherit' }}>
              <div className="grow">
                <b>{p.title}</b>
                <div className="muted" style={{ fontSize: '0.85rem' }}>
                  {t.approved} approved · {t.draft} to review · {t.rejected} discarded
                </div>
              </div>
              <span className={`chip ${p.status === 'ready' ? 'ok' : ''}`}>{p.status}</span>
            </Link>
          );
        })}
      </section>

      <section className="stack">
        <h2>Import JSON drafts</h2>
        <p className="muted">
          Ask the Cursor agent to write the drafts from the players&apos; themes, then paste the JSON here or pick the file.
        </p>
        {sampleAlready ? (
          <Link to={`/prep/${sampleAlready.id}/swipe`} className="btn primary" style={{ textAlign: 'center', textDecoration: 'none' }}>
            Review “{sample.title}”
          </Link>
        ) : (
          <button className="btn primary" disabled={busy || packs === null} onClick={importSample}>
            Import “{sample.title}” to review
          </button>
        )}
        <p className="muted" style={{ margin: 0 }}>
          That pack is the file <b>drafts/example.json</b> (6 sprint, 20 memory, 3 climax). The smoke test uses a smaller throwaway set inside <b>scripts/smoke.ts</b> and never saves it.
        </p>
        <div className="row">
          <label className="btn ghost small">
            Choose file
            <input type="file" accept=".json,application/json" onChange={onFile} hidden />
          </label>
          <button className="btn ghost small" onClick={() => setText(JSON.stringify(sample, null, 2))}>
            Show sample JSON
          </button>
        </div>
        <textarea
          className="input"
          placeholder='{ "title": "...", "sprint": [...], "memory": [...], "climax": [...] }'
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
        />
        {problems.length > 0 && (
          <ul className="error" style={{ margin: 0, paddingLeft: 18 }}>
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
        <button className="btn primary" disabled={busy || !text.trim()} onClick={doImport}>
          Import as draft pack
        </button>
        <details className="muted">
          <summary>Draft file format</summary>
          <pre style={{ overflow: 'auto', fontSize: '0.75rem' }}>{JSON.stringify(EXAMPLE, null, 2)}</pre>
          <p>
            <b>sprint</b>: general-knowledge questions. <b>memory</b>: one group per player theme (5-6 questions, mixed
            difficulties). <b>climax</b>: the spicy Double or Nothing set. Difficulty is easy, medium or hard.
          </p>
        </details>
      </section>
    </div>
  );
}

export function PackPage() {
  return (
    <PinGate>
      <PackDetailView />
    </PinGate>
  );
}

function PackDetailView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [pack, setPack] = useState<PackDetail | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api<PackDetail>('GET', `/api/packs/${id}`)
      .then(setPack)
      .catch((e: Error) => setError(e.message));
  }, [id]);
  useEffect(load, [load]);

  async function setStatus(q: QuestionDto, status: QuestionStatus) {
    await api('PATCH', `/api/questions/${q.id}`, { status });
    load();
  }

  async function setReady(status: 'ready' | 'draft') {
    setError('');
    try {
      await api('POST', `/api/packs/${id}/status`, { status });
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function remove() {
    if (!window.confirm('Delete this pack and all its questions?')) return;
    await api('DELETE', `/api/packs/${id}`);
    navigate('/prep');
  }

  if (!pack) return <div className="page muted">{error || 'Loading…'}</div>;
  const toReview = totals(pack).draft;

  // Group questions by theme (keeping the order they were imported in).
  const groups = new Map<number, { label: string; bank: string; contributor: string | null; items: QuestionDto[] }>();
  for (const q of pack.questions) {
    const g = groups.get(q.themeId) ?? { label: q.theme, bank: q.bank, contributor: q.contributor, items: [] };
    g.items.push(q);
    groups.set(q.themeId, g);
  }

  return (
    <div className="page">
      <div className="topbar">
        <Link to="/prep" className="muted">
          ← packs
        </Link>
        <span className={`chip ${pack.status === 'ready' ? 'ok' : ''}`}>{pack.status}</span>
      </div>
      <h1>{pack.title}</h1>

      <div className="card stack">
        {BANKS.map((b) => (
          <div key={b} className="row">
            <b className="grow" style={{ textTransform: 'capitalize' }}>
              {b}
            </b>
            <span className="chip ok">{pack.counts[b].approved} approved</span>
            <span className="chip">{pack.counts[b].draft} to review</span>
            <span className="chip bad">{pack.counts[b].rejected}</span>
          </div>
        ))}
      </div>

      <Link
        to={`/prep/${pack.id}/swipe`}
        className={`btn primary big ${toReview === 0 ? 'ghost' : ''}`}
        style={{ textAlign: 'center', textDecoration: 'none' }}
      >
        {toReview > 0 ? `Review ${toReview} question${toReview > 1 ? 's' : ''} (swipe)` : 'Nothing left to review'}
      </Link>

      {error && <p className="error">{error}</p>}
      <div className="row">
        {pack.status === 'ready' ? (
          <button className="btn grow" onClick={() => setReady('draft')}>
            Back to draft
          </button>
        ) : (
          <button className="btn ok grow" onClick={() => setReady('ready')}>
            Mark ready to play
          </button>
        )}
        <button className="btn bad" onClick={remove}>
          Delete
        </button>
      </div>

      <h2>All questions</h2>
      {[...groups.values()].map((g) => (
        <div key={g.label + g.bank + g.items[0].id} className="card stack">
          <div className="row">
            <b className="grow">{g.label}</b>
            <span className="chip">{g.bank}</span>
            {g.contributor && <span className="muted">{g.contributor}</span>}
          </div>
          {g.items.map((q) => (
            <div key={q.id} className="stack" style={{ borderTop: '1px solid var(--line)', paddingTop: 10 }}>
              <div className="row wrap">
                <DifficultyChip difficulty={q.difficulty} />
                <span className={`chip ${q.status === 'approved' ? 'ok' : q.status === 'rejected' ? 'bad' : ''}`}>{q.status}</span>
              </div>
              <div>{q.prompt}</div>
              <div className="muted">
                Answer: <b style={{ color: 'var(--text)' }}>{q.answer}</b>
              </div>
              <div className="row">
                <button className="btn small ok" disabled={q.status === 'approved'} onClick={() => setStatus(q, 'approved')}>
                  Approve
                </button>
                <button className="btn small bad" disabled={q.status === 'rejected'} onClick={() => setStatus(q, 'rejected')}>
                  Discard
                </button>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
