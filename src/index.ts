#!/usr/bin/env node
import 'dotenv/config';
import fs from 'fs';
import { Command } from 'commander';
import { fetchAllMetadata, fetchApexStats, fetchAllDependencies } from './salesforce';
import { initDb, clearDependencies, insertComponents, updateComponentStats, insertDependencyEdges } from './db';
import { startServer } from './server';

const program = new Command();

function getDatabasePath(targetOrg?: string): string {
  if (process.env.DATABASE_PATH) {
    return process.env.DATABASE_PATH;
  }
  if (targetOrg) {
    const sanitizedOrg = targetOrg.replace(/[^a-zA-Z0-9.@_-]/g, '_');
    return `dependencies_${sanitizedOrg}.db`;
  }
  return 'dependencies.db';
}

program
  .name('dep-viewer')
  .description('Salesforce Metadata Dependency Viewer')
  .version('1.0.0')
  .option('-d, --db <path>', 'Path to SQLite database file');

program.on('option:db', (dbPath) => {
  process.env.DATABASE_PATH = dbPath;
});

program.command('clean')
  .description('Delete the local SQLite database')
  .option('-o, --target-org <org>', 'Target Salesforce Org (username or alias) to identify the database')
  .action((options) => {
    const dbPath = getDatabasePath(options.targetOrg);
    if (fs.existsSync(dbPath)) {
      try {
        fs.unlinkSync(dbPath);
        console.log(`✓ Database deleted: ${dbPath}`);
      } catch (e: any) {
        console.error(`Failed to delete database: ${e.message}`);
      }
    } else {
      console.log(`Database file not found at ${dbPath}, nothing to delete.`);
    }
  });

program.command('sync')
  .description('Download metadata dependencies from Salesforce')
  .requiredOption('-o, --target-org <org>', 'Target Salesforce Org (username or alias)')
  .option('-c, --clean', 'Delete the existing database before syncing')
  .action(async (options) => {
    try {
      const dbPath = getDatabasePath(options.targetOrg);
      // Ensure db module uses this path
      process.env.DATABASE_PATH = dbPath;
      
      if (options.clean) {
         if (fs.existsSync(dbPath)) {
           console.log(`[Clean] Deleting existing database: ${dbPath}`);
           fs.unlinkSync(dbPath);
         }
      }

      console.log(`\n=== Starting Sync for org: ${options.targetOrg} ===`);
      console.log(`Database: ${dbPath}`);
      
      initDb();
      if (!options.clean) {
        clearDependencies(); // Only needed if we didn't just delete the DB
      }

      // 1. Fetch all metadata components (nodes)
      const allMeta = await fetchAllMetadata(options.targetOrg);
      
      const componentRecords = allMeta.map((m: any) => ({
          id: m.id || m.fileName, // fallback for components without ID
          name: m.fullName,
          type: m.type
      })).filter((c: any) => c.id); // Must have ID/Key
      
      console.log(`      Saving ${componentRecords.length} components...`);
      insertComponents(componentRecords);
      
      // 2. Fetch stats (size/coverage)
      const stats = await fetchApexStats(options.targetOrg);
      console.log(`      Saving stats for ${stats.length} components...`);
      updateComponentStats(stats);

      // 3. Fetch dependencies
      const dependencies = await fetchAllDependencies(options.targetOrg, allMeta);
      
      // Extract any components found in dependencies that we might have missed in the initial listing
      const extraComponentsMap = new Map<string, { id: string, name: string, type: string }>();
      
      for (const d of dependencies) {
          if (d.MetadataComponentId) {
              extraComponentsMap.set(d.MetadataComponentId, {
                  id: d.MetadataComponentId,
                  name: d.MetadataComponentName,
                  type: d.MetadataComponentType
              });
          }
          if (d.RefMetadataComponentId) {
              extraComponentsMap.set(d.RefMetadataComponentId, {
                  id: d.RefMetadataComponentId,
                  name: d.RefMetadataComponentName,
                  type: d.RefMetadataComponentType
              });
          }
      }
      
      const extraComponents = Array.from(extraComponentsMap.values());
      if (extraComponents.length > 0) {
          console.log(`      Ensuring ${extraComponents.length} components from dependencies exist in DB...`);
          insertComponents(extraComponents);
      }

      const edges = dependencies.map((d: any) => ({
          sourceId: d.MetadataComponentId,
          targetId: d.RefMetadataComponentId
      })).filter((e: any) => e.sourceId && e.targetId);
      
      console.log(`      Saving ${edges.length} dependency edges...`);
      insertDependencyEdges(edges);

      console.log(`\nDone! Sync complete.`);
    } catch (err: any) {
      console.error('Error:', err.message);
      process.exit(1);
    }
  });



program.command('serve')
  .description('Start the web server')
  .option('-p, --port <port>', 'Port to run on', '3000')
  .option('-o, --target-org <org>', 'Target Salesforce Org to select database')
  .action((options) => {
    const dbPath = getDatabasePath(options.targetOrg);
    process.env.DATABASE_PATH = dbPath;
    console.log(`Serving database: ${dbPath}`);
    startServer(parseInt(options.port), options.targetOrg);
  });

program.parse(process.argv);
