import Database from 'better-sqlite3';

let db: Database.Database;

function getDb() {
  if (!db) {
    const dbPath = process.env.DATABASE_PATH || 'dependencies.db';
    db = new Database(dbPath);
  }
  return db;
}

export function initDb() {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS dependencies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      metadataComponentId TEXT,
      metadataComponentName TEXT,
      metadataComponentType TEXT,
      refMetadataComponentId TEXT,
      refMetadataComponentName TEXT,
      refMetadataComponentType TEXT
    )
  `);
}

export function insertDependencies(deps: any[]) {
  const stmt = getDb().prepare(`
    INSERT INTO dependencies (
      metadataComponentId,
      metadataComponentName,
      metadataComponentType,
      refMetadataComponentId,
      refMetadataComponentName,
      refMetadataComponentType
    ) VALUES (
      @MetadataComponentId,
      @MetadataComponentName,
      @MetadataComponentType,
      @RefMetadataComponentId,
      @RefMetadataComponentName,
      @RefMetadataComponentType
    )
  `);

  const insertMany = getDb().transaction((dependencies) => {
    for (const dep of dependencies) {
      try {
        stmt.run(dep);
      } catch (err) {
        console.error('Failed to insert record:', dep);
        throw err;
      }
    }
  });

  insertMany(deps);
}

export function getAllDependencies() {
  const stmt = getDb().prepare('SELECT * FROM dependencies');
  return stmt.all();
}

export function clearDependencies() {
  getDb().exec('DELETE FROM dependencies');
}
