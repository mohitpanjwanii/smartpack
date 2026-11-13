import type { Db } from '../types';
import { newId, nowIso } from '../../domain/ids';
import { checkPin, hashPin } from '../../domain/pin';
import { isUniqueViolation } from '../errors';
import { writeAudit } from './audit';
import { getDeviceId } from './settings';

export type Role = 'packer' | 'supervisor' | 'admin';
export type Language = 'en' | 'hi' | 'te';

export interface User {
  id: string;
  name: string;
  role: Role;
  language: Language;
  active: number;
}

const COLUMNS = 'id, name, role, language, active';

export class UserError extends Error {}

export async function countUsers(db: Db): Promise<number> {
  const row = await db.get<{ n: number }>('SELECT count(*) AS n FROM users');
  return row?.n ?? 0;
}

export async function listActiveUsers(db: Db): Promise<User[]> {
  return db.all<User>(`SELECT ${COLUMNS} FROM users WHERE active = 1 ORDER BY name`);
}

export async function createUser(
  db: Db,
  input: { name: string; role: Role; pin: string; language?: Language },
  createdBy: string | null,
): Promise<User> {
  const name = input.name.trim();
  if (!name) throw new UserError('Name is required');
  const { hash, salt } = await hashPin(input.pin);
  const now = nowIso();
  const user: User = { id: newId(), name, role: input.role, language: input.language ?? 'en', active: 1 };
  const deviceId = await getDeviceId(db);
  try {
    await db.transaction(async (tx) => {
      await tx.run(
        `INSERT INTO users (id, name, role, pin_hash, pin_salt, language, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        [user.id, user.name, user.role, hash, salt, user.language, now, now],
      );
      await writeAudit(tx, {
        userId: createdBy ?? user.id,
        action: 'user.create',
        entity: 'users',
        entityId: user.id,
        after: { name: user.name, role: user.role },
        deviceId,
      });
    });
  } catch (err) {
    if (isUniqueViolation(err, 'users.name')) throw new UserError(`A user named "${name}" already exists`);
    throw err;
  }
  return user;
}

/**
 * First-run setup: creates the owner/admin account and business name in one
 * step. Refuses if any user already exists, so it cannot be used to take over
 * an existing installation.
 */
export async function createFirstAdmin(
  db: Db,
  input: { name: string; pin: string; businessName: string },
): Promise<User> {
  if ((await countUsers(db)) > 0) throw new UserError('SmartPack is already set up on this phone');
  const user = await createUser(db, { name: input.name, role: 'admin', pin: input.pin }, null);
  await db.run(
    "INSERT INTO settings (key, value) VALUES ('business.name', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
    [input.businessName.trim() || 'SMP Bakers'],
  );
  return user;
}

/** Returns the user when the PIN is right; null otherwise. Every attempt is audited. */
export async function verifyLogin(db: Db, userId: string, pin: string): Promise<User | null> {
  const row = await db.get<User & { pin_hash: string; pin_salt: string }>(
    `SELECT ${COLUMNS}, pin_hash, pin_salt FROM users WHERE id = ? AND active = 1`,
    [userId],
  );
  const ok = row ? await checkPin(pin, row.pin_hash, row.pin_salt) : false;
  await writeAudit(db, {
    userId: row ? row.id : null,
    action: ok ? 'auth.login' : 'auth.login_failed',
    entity: 'users',
    entityId: userId,
    deviceId: await getDeviceId(db),
  });
  if (!ok || !row) return null;
  return { id: row.id, name: row.name, role: row.role, language: row.language, active: row.active };
}

/** Roles that may approve supervisor-only actions (overrides, reopening cartons). */
export function canSupervise(role: Role): boolean {
  return role === 'supervisor' || role === 'admin';
}
