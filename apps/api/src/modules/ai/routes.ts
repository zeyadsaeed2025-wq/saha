import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { findInOrg, inOrg, store } from '../../common/store.js';
import {
  asyncRoute, getAuth, logAudit, requireFeature, requireOrg, requirePermission,
} from '../../common/middleware.js';
import { badRequest, notFound } from '../../common/errors.js';
import type { AiInsight } from '../../domain/types.js';

export const aiRouter = Router({ mergeParams: true });

aiRouter.use(requireOrg);
aiRouter.use(requireFeature('ai'));
aiRouter.use(requirePermission('report:read'));

const summarySchema = z.object({
  sourceText: z.string().min(20).max(20_000),
  meetingId: z.string().uuid().nullable().optional(),
  kind: z.enum(['summary', 'highlight', 'insight']).optional(),
});

const INSIGHT_NOTE = 'Deterministic local summarization; no external model or personal data leaves this instance.';

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'that', 'with', 'this', 'from', 'are', 'was', 'were', 'have', 'has', 'had',
  'but', 'not', 'you', 'your', 'our', 'their', 'its', 'into', 'about', 'than', 'then', 'they',
  'them', 'his', 'her', 'she', 'him', 'will', 'would', 'could', 'should', 'been', 'being', 'also',
  'all', 'any', 'some', 'more', 'most', 'such', 'only', 'very', 'can', 'may', 'per', 'via',
]);

/** Removes phone-like numbers before any text is persisted into an insight. */
function redactPhoneNumbers(text: string): string {
  return text.replace(/(?:\+?\d[\d\s().-]{5,}\d)/g, '[redacted]');
}

/** Drops CSV / tabular attendance rows rather than embedding them in a summary. */
function dropTabularRows(text: string): string {
  return text.split('\n').filter((line) => {
    const cells = line.split(/[,\t|]/);
    if (cells.length >= 4) return false;
    const attendanceRow = /\b(?:attendance|joined|left|heartbeat|lateness|firstjoin|lastleave|check-?in|check-?out)\b/i
      .test(line);
    return !(attendanceRow && cells.length >= 3 && /\d{1,2}:\d{2}/.test(line));
  }).join('\n');
}

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+(?:['’-][a-z0-9]+)*/g) ?? [];
}

/**
 * Deterministic extractive summarization: score sentences by keyword frequency
 * and length, keep the three best in their original order. No network calls.
 */
export function localSummary(sourceText: string): string {
  const cleaned = dropTabularRows(redactPhoneNumbers(sourceText));
  const sentences = (cleaned.match(/[^.!?\n]+(?:[.!?]+|$)/g) ?? [])
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);

  if (sentences.length === 0) {
    return 'Local summary: No substantive text was available to summarize.';
  }

  const frequencies = new Map<string, number>();
  for (const token of tokenize(cleaned)) {
    if (token.length < 3 || STOP_WORDS.has(token)) continue;
    frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
  }

  const scored = sentences.map((sentence, index) => {
    let score = Math.min(sentence.length, 240) / 240;
    for (const token of tokenize(sentence)) {
      const frequency = frequencies.get(token) ?? 0;
      if (frequency > 0) score += Math.min(frequency, 4) * (token.length >= 5 ? 2 : 1);
    }
    return { sentence, index, score };
  });

  const picked = scored
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 3)
    .sort((a, b) => a.index - b.index)
    .map((entry) => entry.sentence);

  return redactPhoneNumbers(`Local summary: ${picked.join(' ')}`.slice(0, 2000));
}

aiRouter.get('/insights', (req, res) => {
  const auth = getAuth(req)!;
  const insights = store.read((state) => inOrg(state.aiInsights, auth.orgId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
    .slice(0, 50));
  res.json({ insights, provider: 'local', available: true, note: INSIGHT_NOTE });
});

aiRouter.post('/summary', asyncRoute(async (req, res) => {
  const parsed = summarySchema.safeParse(req.body);
  if (!parsed.success) {
    throw badRequest('sourceText must contain between 20 and 20000 characters', 'INVALID_SOURCE_TEXT');
  }
  const auth = getAuth(req)!;
  const created = await store.mutate((draft) => {
    if (parsed.data.meetingId && !findInOrg(draft.meetings, auth.orgId, parsed.data.meetingId)) {
      throw notFound('Meeting not found');
    }
    const insight: AiInsight = {
      id: randomUUID(),
      organizationId: auth.orgId,
      meetingId: parsed.data.meetingId ?? null,
      kind: parsed.data.kind ?? 'summary',
      content: localSummary(parsed.data.sourceText),
      provider: 'local',
      createdAt: new Date().toISOString(),
    };
    draft.aiInsights.push(insight);
    logAudit(draft, auth, 'ai.summary_created', insight.id, {
      kind: insight.kind, provider: 'local', meetingId: insight.meetingId,
    });
    return insight;
  });
  res.status(201).json({ insight: created });
}));

aiRouter.get('/insights/:id', (req, res) => {
  const auth = getAuth(req)!;
  const insight = store.read((state) => findInOrg(state.aiInsights, auth.orgId, req.params.id));
  if (!insight) throw notFound('Insight not found');
  res.json({ insight });
});

aiRouter.delete('/insights/:id', requirePermission('report:export'), asyncRoute(async (req, res) => {
  const auth = getAuth(req)!;
  await store.mutate((draft) => {
    const insight = findInOrg(draft.aiInsights, auth.orgId, req.params.id);
    if (!insight) throw notFound('Insight not found');
    draft.aiInsights = draft.aiInsights.filter((item) => item.id !== insight.id);
    logAudit(draft, auth, 'ai.insight_deleted', insight.id, { kind: insight.kind });
  });
  res.json({ ok: true });
}));
