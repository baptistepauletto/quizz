import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { PinGate } from '../components/PinGate';
import { DifficultyChip } from '../components/ui';
import { ApiError, api } from '../lib/api';
import { BANKS } from '../../shared/types';
import type { DraftFile, PackDetail, PackSummary, QuestionDto, QuestionStatus } from '../../shared/types';
import samplePack from '../../../drafts/example.json';
import picturesPack from '../../../drafts/pictures.json';

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
  const pictures = picturesPack as DraftFile;
  const sampleAlready = packs?.find((p) => p.title === sample.title);
  const picturesAlready = packs?.find((p) => p.title === pictures.title);

  async function importDraftFile(draft: DraftFile) {
    setProblems([]);
    setBusy(true);
    try {
      const res = await api<{ id: number }>('POST', '/api/import', { draft });
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
      return setProblems([`JSON invalide : ${(err as Error).message}`]);
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
          Préparation <span>/ questions</span>
        </h1>
        <Link to="/" className="muted">
          accueil
        </Link>
      </div>

      <section className="stack">
        <h2>Tes imports</h2>
        <p className="muted">Les questions validées rejoignent un seul tas. Une soirée sur /host tire depuis ce tas, et laisse celles déjà posées jusqu’à ce que le neuf soit épuisé.</p>
        {packs === null && <p className="muted">Chargement…</p>}
        {packs?.length === 0 && <p className="muted">Rien d’importé pour l’instant. Colle un brouillon JSON ci-dessous.</p>}
        {packs?.map((p) => {
          const t = totals(p);
          return (
            <Link key={p.id} to={`/prep/${p.id}`} className="card row" style={{ textDecoration: 'none', color: 'inherit' }}>
              <div className="grow">
                <b>{p.title}</b>
                <div className="muted" style={{ fontSize: '0.85rem' }}>
                  {t.approved} validées · {t.draft} à revoir · {t.rejected} rejetées
                </div>
              </div>
              <span className={`chip ${p.status === 'ready' ? 'ok' : ''}`}>{p.status === 'ready' ? 'prêt' : 'brouillon'}</span>
            </Link>
          );
        })}
      </section>

      <section className="stack">
        <h2>Importer des brouillons JSON</h2>
        <p className="muted">
          Demande à Cursor d’écrire les brouillons à partir des thèmes, puis colle le JSON ici ou choisis le fichier.
        </p>
        <div className="row wrap">
          {sampleAlready ? (
            <Link to={`/prep/${sampleAlready.id}/swipe`} className="btn primary" style={{ textAlign: 'center', textDecoration: 'none' }}>
              Relire « {sample.title} »
            </Link>
          ) : (
            <button className="btn primary" disabled={busy || packs === null} onClick={() => importDraftFile(sample)}>
              Importer « {sample.title} »
            </button>
          )}
          {picturesAlready ? (
            <Link to={`/prep/${picturesAlready.id}/swipe`} className="btn" style={{ textAlign: 'center', textDecoration: 'none' }}>
              Relire « {pictures.title} »
            </Link>
          ) : (
            <button className="btn" disabled={busy || packs === null} onClick={() => importDraftFile(pictures)}>
              Importer « {pictures.title} »
            </button>
          )}
        </div>
        <p className="muted" style={{ margin: 0 }}>
          Les questions vivent dans <b>drafts/*.json</b>. Les photos pointent vers <b>pictures/</b>. Une fois importées et validées, elles rejoignent le tas.
        </p>
        <div className="row">
          <label className="btn ghost small">
            Choisir un fichier
            <input type="file" accept=".json,application/json" onChange={onFile} hidden />
          </label>
          <button className="btn ghost small" onClick={() => setText(JSON.stringify(sample, null, 2))}>
            Afficher un exemple JSON
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
          Importer comme brouillon
        </button>
        <details className="muted">
          <summary>Format du fichier brouillon</summary>
          <pre style={{ overflow: 'auto', fontSize: '0.75rem' }}>{JSON.stringify(EXAMPLE, null, 2)}</pre>
          <p>
            <b>sprint</b> : culture générale. Ajoute <b>image</b> (chemin dans le dossier pictures, ex.
            friends/corentin.jpg) et la TV affiche la photo qui se dévoile pendant le buzz. <b>memory</b> : un groupe par
            thème joueur (5-6 questions, difficultés mélangées). <b>climax</b> : le quitte ou double. Difficulté
            easy, medium ou hard.
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
    if (!window.confirm('Supprimer cet import et toutes ses questions\u00a0?')) return;
    await api('DELETE', `/api/packs/${id}`);
    navigate('/prep');
  }

  if (!pack) return <div className="page muted">{error || 'Chargement…'}</div>;
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
          ← imports
        </Link>
        <span className={`chip ${pack.status === 'ready' ? 'ok' : ''}`}>{pack.status === 'ready' ? 'prêt' : 'brouillon'}</span>
      </div>
      <h1>{pack.title}</h1>

      <div className="card stack">
        {BANKS.map((b) => (
          <div key={b} className="row">
            <b className="grow">{b === 'sprint' ? 'Sprint' : b === 'memory' ? 'Grille' : 'Finale'}</b>
            <span className="chip ok">{pack.counts[b].approved} validées</span>
            <span className="chip">{pack.counts[b].draft} à revoir</span>
            <span className="chip bad">{pack.counts[b].rejected}</span>
          </div>
        ))}
      </div>

      <Link
        to={`/prep/${pack.id}/swipe`}
        className={`btn primary big ${toReview === 0 ? 'ghost' : ''}`}
        style={{ textAlign: 'center', textDecoration: 'none' }}
      >
        {toReview > 0 ? `Relire ${toReview} question${toReview > 1 ? 's' : ''} (swipe)` : 'Plus rien à relire'}
      </Link>

      {error && <p className="error">{error}</p>}
      <div className="row">
        {pack.status === 'ready' ? (
          <button className="btn grow" onClick={() => setReady('draft')}>
            Remettre en brouillon
          </button>
        ) : (
          <button className="btn ok grow" onClick={() => setReady('ready')}>
            Relecture terminée
          </button>
        )}
        <button className="btn bad" onClick={remove}>
          Supprimer
        </button>
      </div>

      <h2>Toutes les questions</h2>
      {[...groups.values()].map((g) => (
        <div key={g.label + g.bank + g.items[0].id} className="card stack">
          <div className="row">
            <b className="grow">{g.label}</b>
            <span className="chip">{{ sprint: 'sprint', memory: 'grille', climax: 'finale' }[g.bank as 'sprint' | 'memory' | 'climax']}</span>
            {g.contributor && <span className="muted">{g.contributor}</span>}
          </div>
          {g.items.map((q) => (
            <div key={q.id} className="stack" style={{ borderTop: '1px solid var(--line)', paddingTop: 10 }}>
              <div className="row wrap">
                <DifficultyChip difficulty={q.difficulty} />
                <span className={`chip ${q.status === 'approved' ? 'ok' : q.status === 'rejected' ? 'bad' : ''}`}>
                  {q.status === 'approved' ? 'validée' : q.status === 'rejected' ? 'rejetée' : 'brouillon'}
                </span>
              </div>
              {q.image && <div className="muted">Photo : {q.image}</div>}
              <div>{q.prompt}</div>
              <div className="muted">
                Réponse : <b style={{ color: 'var(--text)' }}>{q.answer}</b>
              </div>
              <div className="row">
                <button className="btn small ok" disabled={q.status === 'approved'} onClick={() => setStatus(q, 'approved')}>
                  Valider
                </button>
                <button className="btn small bad" disabled={q.status === 'rejected'} onClick={() => setStatus(q, 'rejected')}>
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
