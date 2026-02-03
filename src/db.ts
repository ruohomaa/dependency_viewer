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
  const db = getDb();
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS metadata_components (
      id TEXT PRIMARY KEY,
      name TEXT,
      type TEXT,
      size INTEGER,
      coverage INTEGER
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS metadata_dependencies (
      sourceId TEXT,
      targetId TEXT,
      PRIMARY KEY (sourceId, targetId)
    );
  `);
  
  db.exec(`CREATE INDEX IF NOT EXISTS idx_deps_source ON metadata_dependencies(sourceId);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_deps_target ON metadata_dependencies(targetId);`);
}

export function insertComponents(components: { id: string, name: string, type: string }[]) {
  const stmt = getDb().prepare(`
    INSERT OR IGNORE INTO metadata_components (id, name, type)
    VALUES (@id, @name, @type)
  `);

  const insertMany = getDb().transaction((comps) => {
    for (const comp of comps) {
      if (comp.id) stmt.run(comp);
    }
  });

  insertMany(components);
}

export function updateComponentStats(stats: { id: string, size?: number, coverage?: number }[]) {
  const stmt = getDb().prepare(`
    UPDATE metadata_components 
    SET size = COALESCE(@size, size), coverage = COALESCE(@coverage, coverage)
    WHERE id = @id
  `);

  const updateMany = getDb().transaction((items) => {
    for (const item of items) {
      if (item.id) {
          stmt.run({
              id: item.id,
              size: item.size ?? null,
              coverage: item.coverage ?? null
          });
      }
    }
  });

  updateMany(stats);
}

export function insertDependencyEdges(edges: { sourceId: string, targetId: string }[]) {
  const stmt = getDb().prepare(`
    INSERT OR IGNORE INTO metadata_dependencies (sourceId, targetId)
    VALUES (@sourceId, @targetId)
  `);

  const insertMany = getDb().transaction((items) => {
    for (const item of items) {
      if (item.sourceId && item.targetId) {
          stmt.run(item);
      }
    }
  });

  insertMany(edges);
}

// Keep the old function for backward compatibility or simple bulk inserts, 
// but implementing it via the new tables
export function insertDependencies(deps: any[]) {
  const components = new Map<string, { id: string, name: string, type: string }>();

  for (const dep of deps) {
    if (dep.MetadataComponentId) {
      components.set(dep.MetadataComponentId, {
        id: dep.MetadataComponentId,
        name: dep.MetadataComponentName,
        type: dep.MetadataComponentType
      });
    }
    if (dep.RefMetadataComponentId) {
       components.set(dep.RefMetadataComponentId, {
        id: dep.RefMetadataComponentId,
        name: dep.RefMetadataComponentName || dep.RefMetadataComponentComponentName, // fallback
        type: dep.RefMetadataComponentType
      });
    }
  }

  insertComponents(Array.from(components.values()));
}

export function getComponents() {
    return getDb().prepare('SELECT * FROM metadata_components').all();
}

export function clearDependencies() {
  getDb().exec('DELETE FROM metadata_components');
  getDb().exec('DELETE FROM metadata_dependencies');
}

export function searchComponents(query: string) {
  const term = `%${query}%`;
  return getDb().prepare('SELECT * FROM metadata_components WHERE name LIKE ? OR id LIKE ? LIMIT 50').all(term, term);
}

export function getAllDependencies() {
  const sql = `
    SELECT 
      d.sourceId || '-' || d.targetId as id,
      d.sourceId as metadataComponentId,
      s.name as metadataComponentName,
      s.type as metadataComponentType,
      s.size as metadataComponentSize,
      s.coverage as metadataComponentCoverage,
      d.targetId as refMetadataComponentId,
      t.name as refMetadataComponentName,
      t.type as refMetadataComponentType,
      t.size as refMetadataComponentSize,
      t.coverage as refMetadataComponentCoverage
    FROM metadata_dependencies d
    LEFT JOIN metadata_components s ON d.sourceId = s.id
    LEFT JOIN metadata_components t ON d.targetId = t.id
  `;
  return getDb().prepare(sql).all();
}

export function getDependenciesForComponent(id: string) {
  const sql = `
    SELECT 
      d.sourceId || '-' || d.targetId as id,
      d.sourceId as metadataComponentId,
      s.name as metadataComponentName,
      s.type as metadataComponentType,
      s.size as metadataComponentSize,
      s.coverage as metadataComponentCoverage,
      d.targetId as refMetadataComponentId,
      t.name as refMetadataComponentName,
      t.type as refMetadataComponentType,
      t.size as refMetadataComponentSize,
      t.coverage as refMetadataComponentCoverage
    FROM metadata_dependencies d
    LEFT JOIN metadata_components s ON d.sourceId = s.id
    LEFT JOIN metadata_components t ON d.targetId = t.id
    WHERE d.sourceId = ? OR d.targetId = ?
  `;
  return getDb().prepare(sql).all(id, id);
}

