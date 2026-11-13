import type { Db } from '../types';
import { newId, nowIso } from '../../domain/ids';

export interface AuditEntry {
  userId: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  deviceId: string;
}

/** Append a permanent audit record. Audit rows can never be edited or deleted. */
export async function writeAudit(db: Db, e: AuditEntry): Promise<void> {
  await db.run(
    `INSERT INTO audit_logs (id, user_id, action, entity, entity_id, before_json, after_json, device_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      newId(),
      e.userId,
      e.action,
      e.entity,
      e.entityId ?? null,
      e.before === undefined ? null : JSON.stringify(e.before),
      e.after === undefined ? null : JSON.stringify(e.after),
      e.deviceId,
      nowIso(),
    ],
  );
}
