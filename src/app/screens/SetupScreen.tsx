import { useState } from 'react';
import type { Db } from '../../db/types';
import { createFirstAdmin, type User } from '../../db/repositories/users';
import { isValidPin, PIN_RULE } from '../../domain/pin';

/** Shown only once, the first time SmartPack opens on a phone. */
export function SetupScreen({ db, onDone }: { db: Db; onDone: (user: User, businessName: string) => void }) {
  const [businessName, setBusinessName] = useState('SMP Bakers');
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError('Enter the owner or admin name');
    if (!isValidPin(pin)) return setError(PIN_RULE);
    if (pin !== pin2) return setError('The two PINs do not match');
    setBusy(true);
    try {
      const user = await createFirstAdmin(db, { name, pin, businessName });
      onDone(user, businessName.trim() || 'SMP Bakers');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="screen" onSubmit={submit}>
      <h1 className="screen-title">Set up SmartPack</h1>
      <p className="subtle">This phone has no users yet. Create the admin account. The admin can add packers and supervisors later.</p>
      <div className="field">
        <label htmlFor="biz">Business name (printed on carton slips)</label>
        <input id="biz" value={businessName} onChange={(e) => setBusinessName(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="name">Admin name</label>
        <input id="name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
      </div>
      <div className="field">
        <label htmlFor="pin">PIN (4 to 6 digits)</label>
        <input id="pin" type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} maxLength={6} />
      </div>
      <div className="field">
        <label htmlFor="pin2">Repeat PIN</label>
        <input id="pin2" type="password" inputMode="numeric" value={pin2} onChange={(e) => setPin2(e.target.value.replace(/\D/g, ''))} maxLength={6} />
      </div>
      {error && <div className="banner banner-bad" role="alert">{error}</div>}
      <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
        {busy ? 'Saving…' : 'Create admin and start'}
      </button>
    </form>
  );
}
