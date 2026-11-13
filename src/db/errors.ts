/** Helpers to turn raw SQLite errors into messages factory staff understand. */

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** True when the error is a UNIQUE violation, optionally on a given `table.column`. */
export function isUniqueViolation(err: unknown, target?: string): boolean {
  const m = message(err);
  if (!/UNIQUE constraint failed/i.test(m)) return false;
  return target ? m.includes(target) : true;
}

export function isConstraintViolation(err: unknown): boolean {
  return /constraint failed|FOREIGN KEY|CHECK constraint|SMARTPACK_RULE/i.test(message(err));
}

/** Errors raised deliberately by database triggers start with SMARTPACK_RULE. */
export function ruleMessage(err: unknown): string | null {
  const m = message(err).match(/SMARTPACK_RULE: ([^\n]+)/);
  return m ? m[1].trim() : null;
}
