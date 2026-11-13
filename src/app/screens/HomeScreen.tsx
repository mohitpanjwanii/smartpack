import { useState } from 'react';
import { useSession } from '../session';
import { storageDescription } from '../../db/connection';

/**
 * The home dashboard. Each tile is a module; modules not yet built show the
 * stage in which they arrive instead of pretending to work.
 */
const MODULES: { key: string; name: string; stage: number; main?: boolean }[] = [
  { key: 'pack', name: 'Pack an order', stage: 4, main: true },
  { key: 'orders', name: 'Customer orders', stage: 3 },
  { key: 'invoice', name: 'Invoice photo', stage: 3 },
  { key: 'products', name: 'Products', stage: 2 },
  { key: 'barcodes', name: 'Register barcodes', stage: 2 },
  { key: 'cartons', name: 'Cartons', stage: 6 },
  { key: 'history', name: 'Packing history', stage: 8 },
  { key: 'reports', name: 'Reports', stage: 8 },
  { key: 'users', name: 'Users', stage: 8 },
  { key: 'backup', name: 'Backup and sync', stage: 8 },
];

export function HomeScreen() {
  const { user, businessName, logout } = useSession();
  const [showAbout, setShowAbout] = useState(false);

  return (
    <div className="screen">
      <div className="screen-header">
        <div>
          <h1 className="screen-title">{businessName}</h1>
          <div className="subtle">Signed in: {user.name} ({user.role})</div>
        </div>
        <button className="btn btn-small" onClick={logout}>Sign out</button>
      </div>

      <div className="tiles">
        {MODULES.map((m) => (
          <button key={m.key} className={`tile${m.main ? ' tile-main' : ''}`} disabled>
            <span className="tile-name">{m.name}</span>
            <span className="tile-note">Coming in Stage {m.stage}</span>
          </button>
        ))}
      </div>

      <button className="btn btn-small" onClick={() => setShowAbout((v) => !v)}>
        {showAbout ? 'Hide app details' : 'App details'}
      </button>
      {showAbout && (
        <div className="card">
          <dl className="kv">
            <dt>Version</dt><dd>0.1.0 (Stage 1)</dd>
            <dt>Data stored in</dt><dd>{storageDescription()}</dd>
            <dt>Internet needed</dt><dd>No</dd>
          </dl>
        </div>
      )}
    </div>
  );
}
