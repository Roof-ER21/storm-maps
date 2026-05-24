/**
 * Phase 6 — in-process act handlers.
 *
 * Most act tools loopback to an /api/intel/* endpoint (see invoke.ts). But the
 * loopback is unauthenticated (no session cookie → consumerLabel = anonymous),
 * which is fine for system records but wrong for anything that must be
 * attributed to the acting user. Acts listed here run IN-PROCESS instead, under
 * the authenticated actor resolved from req.user in the chat/confirm path — so
 * authorship is trustworthy and no new unauthenticated write route is exposed.
 */
import type { Actor } from './registry.js';
import { appendEntityNote } from '../intel/notes-store.js';

export interface LocalResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

export type LocalHandler = (args: Record<string, unknown>, actor: Actor) => Promise<LocalResult>;

export const LOCAL_HANDLERS: Record<string, LocalHandler> = {
  append_note: async (args, actor) => {
    try {
      const note = await appendEntityNote({
        entityType: String(args.entity_type ?? ''),
        entityId: String(args.entity_id ?? ''),
        content: String(args.content ?? ''),
        authorId: actor.id,
        authorEmail: actor.email,
        source: 'ai',
      });
      return { ok: true, data: { saved: true, note } };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  },
};
