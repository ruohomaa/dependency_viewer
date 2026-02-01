#!/usr/bin/env node
import 'dotenv/config';
import { Command } from 'commander';
import { fetchDependencies, fetchAllMetadata } from './salesforce';
import { initDb, clearDependencies, insertDependencies, insertComponents } from './db';
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

program.command('sync')
  .description('Download metadata dependencies from Salesforce')
  .requiredOption('-o, --target-org <org>', 'Target Salesforce Org (username or alias)')
  .action(async (options) => {
    try {
      console.log(`\n=== Starting Sync for org: ${options.targetOrg} ===`);
      
      initDb();
      clearDependencies();

      // fetchDependencies handles its own detailed logging
      const records = await fetchDependencies(options.targetOrg);
      
      console.log('      Saving dependencies to database...');
      insertDependencies(records);
      
      // fetchAllMetadata handles its own detailed logging
      const allMeta = await fetchAllMetadata(options.targetOrg);
      
      const componentRecords = allMeta.map((m: any) => ({
          id: m.id || m.fileName, // fallback for components without ID
          name: m.fullName,
          type: m.type
      })).filter((c: any) => c.id); // Must have ID/Key
      
      console.log(`      Saving ${componentRecords.length} additional components...`);
      insertComponents(componentRecords);

      console.log(`\nDone! Sync complete.`);
    } catch (err: any) {
      console.error('Error:', err.message);
      process.exit(1);
    }
  });

program.command('serve')
  .description('Start the web server')
  .option('-p, --port <port>', 'Port to run on', '3000')
  .action((options) => {
    startServer(parseInt(options.port));
  });

program.parse(process.argv);
