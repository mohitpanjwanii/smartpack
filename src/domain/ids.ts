/** A new globally unique id (UUID v4). Safe to create offline on any phone. */
export function newId(): string {
  return crypto.randomUUID();
}

/** Current time as ISO-8601 UTC text, the format stored in the database. */
export function nowIso(): string {
  return new Date().toISOString();
}
