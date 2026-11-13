import type { Db } from '../types';
import { newId } from '../../domain/ids';

export const SettingKeys = {
  businessName: 'business.name',
  businessAddress: 'business.address',
  deviceId: 'device.id',
  deviceName: 'device.name',
} as const;

export async function getSetting(db: Db, key: string): Promise<string | null> {
  const row = await db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]);
  return row?.value ?? null;
}

export async function setSetting(db: Db, key: string, value: string): Promise<void> {
  await db.run(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
    [key, value],
  );
}

/**
 * Each phone gets a permanent id the first time SmartPack runs. It is stamped
 * on every packing event so we always know which phone recorded a scan.
 */
export async function getDeviceId(db: Db): Promise<string> {
  const existing = await getSetting(db, SettingKeys.deviceId);
  if (existing) return existing;
  const id = newId();
  await db.run('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', [SettingKeys.deviceId, id]);
  return (await getSetting(db, SettingKeys.deviceId)) ?? id;
}
