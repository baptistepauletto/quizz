import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { isValidToken, login, tokenFromHeader } from './auth';
import {
  draftQuestions,
  pileQuestions,
  pileSummary,
  setQuestionStatus,
  syncDraftsFromDisk,
} from './packs';
import { BANKS } from '../shared/types';
import type { Bank, QuestionStatus } from '../shared/types';

async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  if (!isValidToken(tokenFromHeader(req.headers.authorization))) {
    return reply.code(401).send({ error: 'Non autorisé' });
  }
}

function idParam(req: FastifyRequest): number {
  return Number((req.params as { id: string }).id);
}

/** REST API used by /prep (and by /host for the pile summary). */
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

    api.get('/api/pile', async () => pileSummary());

    api.get('/api/pile/questions', async (req, reply) => {
      const raw = String((req.query as { bank?: string }).bank ?? '').toLowerCase();
      if (raw && !BANKS.includes(raw as Bank)) {
        return reply.code(400).send({ error: 'bank doit être sprint, memory ou climax' });
      }
      return pileQuestions(raw ? (raw as Bank) : undefined);
    });

    api.get('/api/inbox', async () => draftQuestions());

    api.post('/api/sync', async () => syncDraftsFromDisk());

    api.patch('/api/questions/:id', async (req, reply) => {
      const status = (req.body as { status?: QuestionStatus } | null)?.status;
      if (status !== 'draft' && status !== 'approved' && status !== 'rejected') {
        return reply.code(400).send({ error: 'status doit être draft, approved ou rejected' });
      }
      return setQuestionStatus(idParam(req), status) ? { ok: true } : reply.code(404).send({ error: 'Question introuvable' });
    });
  });
}
