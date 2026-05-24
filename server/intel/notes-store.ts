/**
 * Writable entity-notes store. Distinct from the read-only imported job notes
 * (build-notes.mjs → notes.json, surfaced by get_notes): these are
 * user/AI-authored annotations attached to any intel entity, with authorship.
 *
 * The append path is reached two ways, both server-side authenticated:
 *   • AI act `append_note` — runs in-process via server/ai/local-handlers.ts
 *     under the confirming user (NOT the anonymous /api/intel loopback).
 *   • Manual POST /api/intel/notes/append — requireAuth-gated (future UI).
 */
import { sql as pgSql } from '../db.js';

export const NOTE_ENTITY_TYPES = ['job', 'customer', 'carrier', 'rep', 'adjuster', 'lead', 'zip'] as const;
export type NoteEntityType = (typeof NOTE_ENTITY_TYPES)[number];

const MAX_CONTENT = 5000;

export interface EntityNote {
  id: number;
  entity_type: string;
  entity_id: string;
  content: string;
  author_id: number | null;
  author_email: string | null;
  source: string;
  created_at: string;
}

export interface AppendNoteInput {
  entityType: string;
  entityId: string;
  content: string;
  authorId: number | null;
  authorEmail: string | null;
  source?: 'ai' | 'manual';
}

function normType(t: string): NoteEntityType {
  const v = String(t ?? '').trim().toLowerCase();
  if (!(NOTE_ENTITY_TYPES as readonly string[]).includes(v)) {
    throw new Error(`invalid entity_type "${t}" — must be one of: ${NOTE_ENTITY_TYPES.join(', ')}`);
  }
  return v as NoteEntityType;
}

export async function appendEntityNote(input: AppendNoteInput): Promise<EntityNote> {
  const entityType = normType(input.entityType);
  const entityId = String(input.entityId ?? '').trim();
  const content = String(input.content ?? '').trim();
  if (!entityId) throw new Error('entity_id required');
  if (!content) throw new Error('content required');
  if (content.length > MAX_CONTENT) throw new Error(`content too long (${content.length} > ${MAX_CONTENT} chars)`);
  const source = input.source === 'manual' ? 'manual' : 'ai';

  const rows = await pgSql<EntityNote[]>`
    INSERT INTO entity_notes (entity_type, entity_id, content, author_id, author_email, source)
    VALUES (${entityType}, ${entityId}, ${content}, ${input.authorId ?? null}, ${input.authorEmail ?? null}, ${source})
    RETURNING id, entity_type, entity_id, content, author_id, author_email, source, created_at`;
  return rows[0];
}

export async function listEntityNotes(entityType: string, entityId: string, limit = 50): Promise<EntityNote[]> {
  const et = String(entityType ?? '').trim().toLowerCase();
  const eid = String(entityId ?? '').trim();
  if (!et || !eid) return [];
  const lim = Math.min(Math.max(Math.floor(Number(limit) || 50), 1), 200);
  return pgSql<EntityNote[]>`
    SELECT id, entity_type, entity_id, content, author_id, author_email, source, created_at
    FROM entity_notes
    WHERE entity_type = ${et} AND entity_id = ${eid}
    ORDER BY created_at DESC
    LIMIT ${lim}`;
}
