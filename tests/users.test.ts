import { describe, expect, it } from 'vitest';
import { freshDb } from './helpers';
import { countUsers, createFirstAdmin, createUser, listActiveUsers, verifyLogin, UserError } from '../src/db/repositories/users';
import { getDeviceId, getSetting } from '../src/db/repositories/settings';
import { hashPin, checkPin, isValidPin } from '../src/domain/pin';

describe('PIN security', () => {
  it('accepts only 4 to 6 digit PINs', () => {
    expect(isValidPin('1234')).toBe(true);
    expect(isValidPin('123456')).toBe(true);
    expect(isValidPin('123')).toBe(false);
    expect(isValidPin('1234567')).toBe(false);
    expect(isValidPin('12a4')).toBe(false);
  });

  it('stores a salted hash, never the PIN, and verifies correctly', async () => {
    const a = await hashPin('4821');
    const b = await hashPin('4821');
    expect(a.hash).not.toContain('4821');
    expect(a.hash).not.toBe(b.hash); // different salt each time
    expect(await checkPin('4821', a.hash, a.salt)).toBe(true);
    expect(await checkPin('4822', a.hash, a.salt)).toBe(false);
  });
});

describe('first-run setup and login', () => {
  it('creates the admin and business name once, then refuses a second setup', async () => {
    const db = await freshDb();
    expect(await countUsers(db)).toBe(0);
    const admin = await createFirstAdmin(db, { name: 'Mohit', pin: '2468', businessName: 'SMP Bakers' });
    expect(admin.role).toBe('admin');
    expect(await getSetting(db, 'business.name')).toBe('SMP Bakers');
    await expect(createFirstAdmin(db, { name: 'Intruder', pin: '1111', businessName: 'X' })).rejects.toBeInstanceOf(UserError);
  });

  it('logs in with the right PIN only, and audits every attempt', async () => {
    const db = await freshDb();
    const admin = await createFirstAdmin(db, { name: 'Mohit', pin: '2468', businessName: 'SMP Bakers' });
    expect(await verifyLogin(db, admin.id, '0000')).toBeNull();
    expect((await verifyLogin(db, admin.id, '2468'))?.name).toBe('Mohit');
    const actions = (await db.all<{ action: string }>('SELECT action FROM audit_logs ORDER BY created_at')).map((r) => r.action);
    expect(actions).toEqual(['user.create', 'auth.login_failed', 'auth.login']);
    const row = await db.get<{ pin_hash: string }>('SELECT pin_hash FROM users WHERE id = ?', [admin.id]);
    expect(row?.pin_hash).not.toBe('2468');
  });

  it('refuses two users with the same name (any letter case)', async () => {
    const db = await freshDb();
    const admin = await createFirstAdmin(db, { name: 'Mohit', pin: '2468', businessName: 'SMP Bakers' });
    await createUser(db, { name: 'Ravi', role: 'packer', pin: '1357' }, admin.id);
    await expect(createUser(db, { name: 'ravi', role: 'packer', pin: '1357' }, admin.id)).rejects.toThrow(/already exists/);
    expect((await listActiveUsers(db)).map((u) => u.name)).toEqual(['Mohit', 'Ravi']);
  });

  it('gives the phone one permanent device id', async () => {
    const db = await freshDb();
    const a = await getDeviceId(db);
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
    expect(await getDeviceId(db)).toBe(a);
  });
});
