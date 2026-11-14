import { getDatabase, saveDatabase } from '../server/db.js';
import { rollbackLastMigration, runPendingMigrations } from '../server/migrations.js';

async function main() {
  const mode = process.argv[2] || 'up';
  const db = await getDatabase();
  if (mode === 'down' || mode === 'rollback') {
    const res = rollbackLastMigration(db);
    await saveDatabase(db);
    console.log(res.rolledBack ? `Rolled back migration: ${res.rolledBack}` : 'No migrations to rollback.');
    return;
  }
  const res = runPendingMigrations(db);
  await saveDatabase(db);
  console.log(res.applied.length > 0 ? `Applied migrations: ${res.applied.join(', ')}` : 'All migrations already applied.');
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
