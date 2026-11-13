import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { App as CapApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';

/** Every screen in the app and the data it needs. */
export type Route =
  | { name: 'home' }
  | { name: 'products' }
  | { name: 'productForm'; id?: string }
  | { name: 'productImport' }
  | { name: 'barcodes' }
  | { name: 'barcodeRegister' }
  | { name: 'barcodeLookup' }
  | { name: 'barcodeImport' }
  | { name: 'orders' }
  | { name: 'invoiceCapture' }
  | { name: 'orderReview' }
  | { name: 'orderDetail'; id: string };

interface Nav {
  route: Route;
  push: (r: Route) => void;
  back: () => void;
  home: () => void;
}

const NavContext = createContext<Nav | null>(null);

export function useNav(): Nav {
  const n = useContext(NavContext);
  if (!n) throw new Error('useNav outside NavProvider');
  return n;
}

/** A simple screen stack; the Android back button goes back one screen. */
export function NavProvider({ children }: { children: (route: Route) => React.ReactNode }) {
  const [stack, setStack] = useState<Route[]>([{ name: 'home' }]);
  const push = useCallback((r: Route) => setStack((s) => [...s, r]), []);
  const back = useCallback(() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)), []);
  const home = useCallback(() => setStack([{ name: 'home' }]), []);
  const route = stack[stack.length - 1];

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [route]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const sub = CapApp.addListener('backButton', () => {
      setStack((s) => {
        if (s.length > 1) return s.slice(0, -1);
        void CapApp.minimizeApp();
        return s;
      });
    });
    return () => {
      void sub.then((h) => h.remove());
    };
  }, []);

  const value = useMemo(() => ({ route, push, back, home }), [route, push, back, home]);
  return <NavContext.Provider value={value}>{children(route)}</NavContext.Provider>;
}

/** Standard screen header with a big Back button. */
export function ScreenHeader({ title, right }: { title: string; right?: React.ReactNode }) {
  const { back } = useNav();
  return (
    <div className="screen-header">
      <button className="btn btn-small" onClick={back} aria-label="Back">
        ‹ Back
      </button>
      <h1 className="screen-title" style={{ flex: 1, fontSize: '1.35rem' }}>{title}</h1>
      {right}
    </div>
  );
}
