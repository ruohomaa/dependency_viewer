#!/usr/bin/env node
import 'dotenv/config';
import fs from 'fs';
import { Command } from 'commander';
import { fetchAllMetadata, fetchApexStats, fetchAllDependencies, fetchDependenciesByIds } from './salesforce';
import { initDb, clearDependencies, insertComponents, updateComponentStats, insertDependencyEdges, getDb } from './db';
import { startServer } from './server';

const program = new Command();


program
  .name('dep-viewer')
  .description('Salesforce Metadata Dependency Viewer')
  .version('1.0.0')
  .option('-d, --db <path>', 'Path to SQLite database file');

program.on('option:db', (dbPath) => {
  process.env.DATABASE_PATH = dbPath;
});

program.command('clean')
  .description('Delete the entire local SQLite database')
  .action(() => {
    const dbPath = process.env.DATABASE_PATH || 'dependencies.db';
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
      const dbPath = process.env.DATABASE_PATH || 'dependencies.db';
      
      if (options.clean) {
         if (fs.existsSync(dbPath)) {
           console.log(`[Clean] Deleting existing database: ${dbPath}`);
           fs.unlinkSync(dbPath);
         }
      }

      console.log(`\n=== Starting Sync for org: ${options.targetOrg} ===`);
      
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

program.command('repair')
  .description('Repair local DB by fetching missing component details from Salesforce')
  .requiredOption('-o, --target-org <org>', 'Target Salesforce Org')
  .action(async (options) => {
      try {
          initDb();
          const db = getDb();
          
          console.log(`Checking for missing components...`);
          
          // Find IDs used in dependencies that are missing from components table
          // Check Source IDs
          const missingSource = db.prepare('SELECT DISTINCT d.sourceId FROM metadata_dependencies d LEFT JOIN metadata_components s ON d.sourceId = s.id WHERE s.id IS NULL').all();
          // Check Target IDs
          const missingTarget = db.prepare('SELECT DISTINCT d.targetId FROM metadata_dependencies d LEFT JOIN metadata_components t ON d.targetId = t.id WHERE t.id IS NULL').all();
          
          const missingIds = new Set<string>();
          missingSource.forEach((r: any) => missingIds.add(r.sourceId));
          missingTarget.forEach((r: any) => missingIds.add(r.targetId));
          
          if (missingIds.size === 0) {
              console.log('No missing components found. Database is consistent.');
              return;
          }
          
          console.log(`Found ${missingIds.size} missing components. Fetching details...`);
          
          const allMissingIds = Array.from(missingIds);
          const BATCH_SIZE = 20; 
          const chunks: string[][] = [];
          for (let i = 0; i < allMissingIds.length; i += BATCH_SIZE) {
               chunks.push(allMissingIds.slice(i, i + BATCH_SIZE));
          }
           
          const foundComponentsMap = new Map<string, { id: string, name: string, type: string }>();
          let completed = 0;

          // Process chunks sequentially or with limited concurrency to avoid API limits
          for (const chunk of chunks) {
              // We query dependencies for these IDs to check their name/type fields
              const records = await fetchDependenciesByIds(options.targetOrg, chunk);
              
              records.forEach((d: any) => {
                   if (d.MetadataComponentId) {
                      foundComponentsMap.set(d.MetadataComponentId, {
                          id: d.MetadataComponentId,
                          name: d.MetadataComponentName,
                          type: d.MetadataComponentType
                      });
                   }
                   if (d.RefMetadataComponentId) {
                      foundComponentsMap.set(d.RefMetadataComponentId, {
                          id: d.RefMetadataComponentId,
                          name: d.RefMetadataComponentName, // fallback
                          type: d.RefMetadataComponentType
                      });
                   }
              });
              
              completed += chunk.length;
              const percent = Math.round((completed / allMissingIds.length) * 100);
              process.stdout.write(`      Progress: [${completed}/${allMissingIds.length}] ${percent}% \r`);
          }

          console.log('\n');
          
          const componentsToInsert = Array.from(foundComponentsMap.values());
          // Filter to only those that were actually missing
          const actuallyMissing = componentsToInsert.filter(c => missingIds.has(c.id));
          
          if (actuallyMissing.length > 0) {
              console.log(`Restoring ${actuallyMissing.length} components to database...`);
              insertComponents(actuallyMissing);
              console.log('✓ Repair complete.');
          } else {
             console.log('Could not resolve details for missing components (they might be deleted or inaccessible).');
          }

      } catch (e: any) {
          console.error(`Repair failed: ${e.message}`);
          process.exit(1);
      }
  });

program.command('serve')
  .description('Start the web server')
  .option('-p, --port <port>', 'Port to run on', '3000')
  .option('-o, --target-org <org>', 'Target Salesforce Org for live dependency fetching')
  .action((options) => {
    startServer(parseInt(options.port), options.targetOrg);
  });

program.parse(process.argv);
