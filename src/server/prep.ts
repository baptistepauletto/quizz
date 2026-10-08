import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { isValidToken, login, tokenFromHeader } from './auth';
import { DraftError, parseDraft } from './draft';
import { deletePack, getPack, importDraft, listPacks, pileSummary, setPackStatus, setQuestionStatus } from './packs';
import type { PackStatus, QuestionStatus } from '../shared/types';

async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  if (!isValidToken(tokenFromHeader(req.headers.authorization))) {
    return reply.code(401).send({ error: 'Non autorisé' });
  }
}

function idParam(req: FastifyRequest): number {
  return Number((req.params as { id: string }).id);
}

/** REST API used by /prep (and by /host to list playable packs). */
export async function prepRoutes(app: FastifyInstance) {
  app.post('/api/auth', async (req, reply) => {
    const pin = String((req.body as { pin?: unknown } | null)?.pin ?? '');
    const res = login(pin);
    if (res.ok) return { token: res.token };
    return reply.code(res.retryInMs > 0 ? 429 : 401).send({
      error: res.retryInMs > 0 ? `Trop d’essais. Réessaie dans ${Math.ceil(res.retryInMs / 1000)}s.` : 'Mauvais PIN',
      retryInMs: res.retryInMs,
    });
  });

  app.register(async (api) => {
    api.addHook('preHandler', requireAuth);

    api.get('/api/packs', async () => listPacks());
    api.get('/api/pile', async () => pileSummary());

    api.get('/api/packs/:id', async (req, reply) => {
      const pack = getPack(idParam(req));
      return pack ?? reply.code(404).send({ error: 'Import introuvable' });
    });

    api.delete('/api/packs/:id', async (req, reply) => {
      return deletePack(idParam(req)) ? { ok: true } : reply.code(404).send({ error: 'Import introuvable' });
    });

    // Import a JSON draft file (written by the Cursor agent) as a new pack of draft questions.
    api.post('/api/import', async (req, reply) => {
      try {
        const body = req.body as { draft?: unknown } | null;
        const draft = parseDraft(body?.draft);
        const id = importDraft(draft);
        return { id, pack: getPack(id) };
      } catch (err) {
        if (err instanceof DraftError) return reply.code(400).send({ error: 'Fichier brouillon invalide', problems: err.problems });
        throw err;
      }
    });

    // Swipe right/left: approve or reject (or put back to draft for "undo").
    api.patch('/api/questions/:id', async (req, reply) => {
      const status = (req.body as { status?: QuestionStatus } | null)?.status;
      if (status !== 'draft' && status !== 'approved' && status !== 'rejected') {
        return reply.code(400).send({ error: 'status doit être draft, approved ou rejected' });
      }
      return setQuestionStatus(idParam(req), status) ? { ok: true } : reply.code(404).send({ error: 'Question introuvable' });
    });

    api.post('/api/packs/:id/status', async (req, reply) => {
      const status = (req.body as { status?: PackStatus } | null)?.status;
      if (status !== 'draft' && status !== 'ready') {
        return reply.code(400).send({ error: 'status doit être draft ou ready' });
      }
      const res = setPackStatus(idParam(req), status);
      return res.ok ? { ok: true } : reply.code(400).send({ error: res.message });
    });
  });
}
