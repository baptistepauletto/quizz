import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { isValidToken, login, tokenFromHeader } from './auth';
import { DraftError, parseDraft } from './draft';
import { deletePack, getPack, importDraft, listPacks, setPackStatus, setQuestionStatus } from './packs';
import type { PackStatus, QuestionStatus } from '../shared/types';

async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  if (!isValidToken(tokenFromHeader(req.headers.authorization))) {
    return reply.code(401).send({ error: 'Not authorised' });
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
      error: res.retryInMs > 0 ? `Too many attempts. Try again in ${Math.ceil(res.retryInMs / 1000)}s.` : 'Wrong PIN',
      retryInMs: res.retryInMs,
    });
  });

  app.register(async (api) => {
    api.addHook('preHandler', requireAuth);

    api.get('/api/packs', async () => listPacks());

    api.get('/api/packs/:id', async (req, reply) => {
      const pack = getPack(idParam(req));
      return pack ?? reply.code(404).send({ error: 'Pack not found' });
    });

    api.delete('/api/packs/:id', async (req, reply) => {
      return deletePack(idParam(req)) ? { ok: true } : reply.code(404).send({ error: 'Pack not found' });
    });

    // Import a JSON draft file (written by the Cursor agent) as a new pack of draft questions.
    api.post('/api/import', async (req, reply) => {
      try {
        const body = req.body as { draft?: unknown } | null;
        const draft = parseDraft(body?.draft);
        const id = importDraft(draft);
        return { id, pack: getPack(id) };
      } catch (err) {
        if (err instanceof DraftError) return reply.code(400).send({ error: 'Invalid draft file', problems: err.problems });
        throw err;
      }
    });

    // Swipe right/left: approve or reject (or put back to draft for "undo").
    api.patch('/api/questions/:id', async (req, reply) => {
      const status = (req.body as { status?: QuestionStatus } | null)?.status;
      if (status !== 'draft' && status !== 'approved' && status !== 'rejected') {
        return reply.code(400).send({ error: 'status must be draft, approved or rejected' });
      }
      return setQuestionStatus(idParam(req), status) ? { ok: true } : reply.code(404).send({ error: 'Question not found' });
    });

    api.post('/api/packs/:id/status', async (req, reply) => {
      const status = (req.body as { status?: PackStatus } | null)?.status;
      if (status !== 'draft' && status !== 'ready') {
        return reply.code(400).send({ error: 'status must be draft or ready' });
      }
      const res = setPackStatus(idParam(req), status);
      return res.ok ? { ok: true } : reply.code(400).send({ error: res.message });
    });
  });
}
