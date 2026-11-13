import { createContext, useContext } from 'react';
import type { User } from '../db/repositories/users';
import type { Db } from '../db/types';

export interface Session {
  db: Db;
  user: User;
  businessName: string;
  logout: () => void;
}

export const SessionContext = createContext<Session | null>(null);

/** The logged-in user and database, available to every screen. */
export function useSession(): Session {
  const s = useContext(SessionContext);
  if (!s) throw new Error('useSession used outside a logged-in screen');
  return s;
}
