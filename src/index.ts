#!/usr/bin/env node
import 'dotenv/config';
import { Command } from 'commander';
import { login, fetchDependencies } from './salesforce';
import { initDb, clearDependencies, insertDependencies } from './db';
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
  .requiredOption('-u, --username <username>', 'Salesforce username')
  .requiredOption('-p, --password <password>', 'Salesforce password (security token appended if needed)')
  .option('-l, --loginUrl <loginUrl>', 'Login URL', 'https://login.salesforce.com')
  .action(async (options) => {
    try {
      console.log('Connecting to Salesforce...');
      const conn = await login(options.username, options.password, options.loginUrl);
      console.log('Connected. Fetching dependencies...');
      
      const records = await fetchDependencies(conn);
      console.log(`Fetched ${records.length} dependency records.`);
      
      console.log('Saving to database...');
      initDb();
      clearDependencies();
      
      insertDependencies(records);
      console.log(`\nDone! Saved ${records.length} records.`);
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
