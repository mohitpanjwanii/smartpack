import { migration001 } from './001_init';

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

/**
 * Every database change ever made, in order. Never edit a migration that has
 * shipped; add a new numbered one instead, so phones upgrade safely.
 */
export const migrations: Migration[] = [migration001];
