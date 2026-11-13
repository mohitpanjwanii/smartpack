import { useEffect, useState } from 'react';
import { getDb } from '../db/connection';
import type { Db } from '../db/types';
import { countUsers, type User } from '../db/repositories/users';
import { getSetting, SettingKeys } from '../db/repositories/settings';
import { SessionContext } from './session';
import { SetupScreen } from './screens/SetupScreen';
import { LoginScreen } from './screens/LoginScreen';
import { HomeScreen } from './screens/HomeScreen';
import { NavProvider, type Route } from './nav';
import { ProductListScreen } from '../modules/products/ProductListScreen';
import { ProductFormScreen } from '../modules/products/ProductFormScreen';
import { ProductImportScreen } from '../modules/products/ProductImportScreen';

function renderRoute(route: Route) {
  switch (route.name) {
    case 'home':
      return <HomeScreen />;
    case 'products':
      return <ProductListScreen />;
    case 'productForm':
      return <ProductFormScreen key={route.id ?? 'new'} id={route.id} />;
    case 'productImport':
      return <ProductImportScreen />;
    default:
      return <HomeScreen />;
  }
}

type Boot =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'ready'; db: Db; hasUsers: boolean; businessName: string };

export function App() {
  const [boot, setBoot] = useState<Boot>({ state: 'loading' });
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    (async () => {
      const db = await getDb();
      const [n, name] = await Promise.all([countUsers(db), getSetting(db, SettingKeys.businessName)]);
      setBoot({ state: 'ready', db, hasUsers: n > 0, businessName: name ?? 'SMP Bakers' });
    })().catch((err) => setBoot({ state: 'error', message: err instanceof Error ? err.message : String(err) }));
  }, []);

  if (boot.state === 'loading') return <div className="center">Opening SmartPack…</div>;
  if (boot.state === 'error')
    return (
      <div className="screen">
        <div className="banner banner-bad">SmartPack could not open its database: {boot.message}</div>
      </div>
    );

  const { db, businessName } = boot;

  if (!boot.hasUsers)
    return (
      <SetupScreen
        db={db}
        onDone={(u, biz) => {
          setBoot({ state: 'ready', db, hasUsers: true, businessName: biz });
          setUser(u);
        }}
      />
    );

  if (!user) return <LoginScreen db={db} businessName={businessName} onLogin={setUser} />;

  return (
    <SessionContext.Provider value={{ db, user, businessName, logout: () => setUser(null) }}>
      <NavProvider>{renderRoute}</NavProvider>
    </SessionContext.Provider>
  );
}
