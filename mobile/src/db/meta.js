import { getDB } from './connection.js';

/* ------------------------------------------------------------------ *
 *  Meta: small saved values (user, points, streak, last sync time)
 * ------------------------------------------------------------------ */

/**
 * Reads a saved value. Numbers, text, true/false and objects come back as
 * the same kind of value they were saved as. Returns null if not saved.
 */
export async function getMeta(key) {
  const db = await getDB();
  const row = await db.getFirstAsync('SELECT value FROM meta WHERE key = ?;', [key]);
  if (!row || row.value === null) return null;
  try {
    return JSON.parse(row.value);
  } catch {
    return row.value;
  }
}

/** Saves any value (number, text, true/false, object). */
export async function setMeta(key, value) {
  const db = await getDB();
  await db.runAsync(
    `INSERT INTO meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value;`,
    [key, JSON.stringify(value)]
  );
}
