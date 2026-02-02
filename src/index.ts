#!/usr/bin/env node
import 'dotenv/config';
import fs from 'fs';
import { Command } from 'commander';
import { fetchAllMetadata, fetchApexStats } from './salesforce';
import { initDb, clearDependencies, insertComponents, updateComponentStats } from './db';
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

      console.log(`\nDone! Sync complete.`);
    } catch (err: any) {
      console.error('Error:', err.message);
      process.exit(1);
    }
  });

program.command('serve')
  .description('Start the web server')
  .option('-p, --port <port>', 'Port to run on', '3000')
  .requiredOption('-o, --target-org <org>', 'Target Salesforce Org for live dependency fetching')
  .action((options) => {
    startServer(parseInt(options.port), options.targetOrg);
  });

program.parse(process.argv);
