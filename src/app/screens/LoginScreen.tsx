import { useEffect, useState } from 'react';
import type { Db } from '../../db/types';
import { listActiveUsers, verifyLogin, type User } from '../../db/repositories/users';
import { PinPad } from '../../ui/components/PinPad';

const ROLE_LABEL = { packer: 'Packer', supervisor: 'Supervisor', admin: 'Admin' } as const;

export function LoginScreen({ db, businessName, onLogin }: { db: Db; businessName: string; onLogin: (u: User) => void }) {
  const [users, setUsers] = useState<User[] | null>(null);
  const [selected, setSelected] = useState<User | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listActiveUsers(db).then(setUsers, (e) => setError(String(e)));
  }, [db]);

  const submit = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    const user = await verifyLogin(db, selected.id, pin);
    setBusy(false);
    if (user) onLogin(user);
    else {
      setPin('');
      setError('Wrong PIN. Try again.');
    }
  };

  if (!selected) {
    return (
      <div className="screen">
        <h1 className="screen-title">{businessName}</h1>
        <p className="subtle">Tap your name to sign in.</p>
        <div className="user-list">
          {users?.map((u) => (
            <button key={u.id} className="btn btn-block" onClick={() => setSelected(u)}>
              {u.name} <span className="subtle">· {ROLE_LABEL[u.role]}</span>
            </button>
          ))}
        </div>
        {error && <div className="banner banner-bad">{error}</div>}
      </div>
    );
  }

  return (
    <div className="screen">
      <div className="screen-header">
        <h1 className="screen-title">{selected.name}</h1>
        <button className="btn btn-small" onClick={() => { setSelected(null); setPin(''); setError(null); }}>
          Change user
        </button>
      </div>
      <p className="subtle">Enter your PIN.</p>
      {error && <div className="banner banner-bad" role="alert">{error}</div>}
      <PinPad value={pin} onChange={setPin} onSubmit={submit} disabled={busy} submitLabel="Sign in" />
    </div>
  );
}
