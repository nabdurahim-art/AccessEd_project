import { DatabaseSync } from 'node:sqlite';
let opens = 0;
export const stats = () => opens;
export async function openDatabaseAsync() {
  opens++;
  const db = new DatabaseSync(globalThis.__DBFILE__ || ':memory:');
  return {
    async execAsync(sql) { db.exec(sql); },
    async runAsync(sql, params = []) { return db.prepare(sql).run(...params); },
    async getAllAsync(sql, params = []) { return db.prepare(sql).all(...params); },
    async getFirstAsync(sql, params = []) { return db.prepare(sql).get(...params) ?? null; },
    async withTransactionAsync(fn) { db.exec('BEGIN'); try { await fn(); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; } },
  };
}
