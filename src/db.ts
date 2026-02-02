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
      type TEXT
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS metadata_dependencies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sourceId TEXT,
      targetId TEXT,
      FOREIGN KEY(sourceId) REFERENCES metadata_components(id),
      FOREIGN KEY(targetId) REFERENCES metadata_components(id)
    )
  `);
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

export function insertDependencyEdges(edges: { sourceId: string, targetId: string }[]) {
  const stmt = getDb().prepare(`
    INSERT INTO metadata_dependencies (sourceId, targetId)
    VALUES (@sourceId, @targetId)
  `);

  const insertMany = getDb().transaction((items) => {
    for (const item of items) {
      if (item.sourceId && item.targetId) stmt.run(item);
    }
  });

  insertMany(edges);
}

// Keep the old function for backward compatibility or simple bulk inserts, 
// but implementing it via the new tables
export function insertDependencies(deps: any[]) {
  const components = new Map<string, { id: string, name: string, type: string }>();
  const edges: { sourceId: string, targetId: string }[] = [];

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
    
    if (dep.MetadataComponentId && dep.RefMetadataComponentId) {
      edges.push({
        sourceId: dep.MetadataComponentId,
        targetId: dep.RefMetadataComponentId
      });
    }
  }

  insertComponents(Array.from(components.values()));
  insertDependencyEdges(edges);
}

export function getAllDependencies() {
  // reconstruct the flat view
  const stmt = getDb().prepare(`
    SELECT 
      d.id as id,
      s.id as metadataComponentId,
      s.name as metadataComponentName,
      s.type as metadataComponentType,
      t.id as refMetadataComponentId,
      t.name as refMetadataComponentName,
      t.type as refMetadataComponentType
    FROM metadata_dependencies d
    JOIN metadata_components s ON d.sourceId = s.id
    JOIN metadata_components t ON d.targetId = t.id
  `);
  return stmt.all();
}

export function getComponents() {
    return getDb().prepare('SELECT * FROM metadata_components').all();
}

export function clearDependencies() {
  getDb().exec('DELETE FROM metadata_dependencies');
  getDb().exec('DELETE FROM metadata_components');
}

export function searchComponents(query: string) {
  const term = `%${query}%`;
  return getDb().prepare('SELECT * FROM metadata_components WHERE name LIKE ? OR id LIKE ? LIMIT 50').all(term, term);
}

export function getDependenciesForComponent(id: string) {
  const stmt = getDb().prepare(`
    SELECT 
      d.id as dependencyId,
      s.id as metadataComponentId,
      s.name as metadataComponentName,
      s.type as metadataComponentType,
      t.id as refMetadataComponentId,
      t.name as refMetadataComponentName,
      t.type as refMetadataComponentType
    FROM metadata_dependencies d
    JOIN metadata_components s ON d.sourceId = s.id
    JOIN metadata_components t ON d.targetId = t.id
    WHERE d.sourceId = ? OR d.targetId = ?
  `);
  return stmt.all(id, id);
}

