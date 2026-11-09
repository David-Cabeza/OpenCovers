export interface Migration {
  version: number;
  sql: string;
}

const MIGRATIONS_TABLE = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);
`;

export function applyMigrations(
  sql: SqlStorage,
  storage: DurableObjectStorage,
  migrations: Migration[],
): void {
  const sorted = [...migrations].sort((a, b) => a.version - b.version);
  const seen = new Set<number>();
  sql.exec(MIGRATIONS_TABLE);
  for (const migration of sorted) {
    if (seen.has(migration.version)) {
      throw new Error(`duplicate migration version ${migration.version}`);
    }
    seen.add(migration.version);
    const applied =
      sql
        .exec("SELECT 1 AS x FROM schema_migrations WHERE version = ?", migration.version)
        .toArray().length > 0;
    if (applied) continue;
    storage.transactionSync(() => {
      sql.exec(migration.sql);
      sql.exec(
        "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
        migration.version,
        Math.floor(Date.now() / 1000),
      );
    });
  }
}
