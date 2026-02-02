
import { exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);

async function runCommand(command: string) {
  // 50MB buffer to handle large JSON responses
  const { stdout, stderr } = await execPromise(command, { maxBuffer: 1024 * 1024 * 50 });
  if (stderr) {
    // sf cli sometimes writes warnings to stderr, but we should log it
    // console.warn('Command stderr:', stderr);
  }
  return stdout;
}




export async function describeMetadata(targetOrg: string) {
    // Use sf org list metadata-types
    const stdout = await runCommand(`sf org list metadata-types --target-org "${targetOrg}" --json`);
    try {
        const result = JSON.parse(stdout);
        if (result.status === 0 && result.result && result.result.metadataObjects) {
            return result.result.metadataObjects;
        }
        return [];
    } catch (e: any) {
        throw new Error(`Failed to describe metadata types: ${e.message}`);
    }
}

export async function listMetadata(targetOrg: string, type: string) {
    // Some types might not support list or might fail, handle gracefully
    try {
        const stdout = await runCommand(`sf org list metadata -m "${type}" --target-org "${targetOrg}" --json`);
        const result = JSON.parse(stdout);
        if (result.status === 0) {
            // result.result can be single object or array
            return Array.isArray(result.result) ? result.result : [result.result];
        }
        return [];
    } catch (e: any) {
        // console.warn(`Failed to list metadata for ${type}: ${e.message}`);
        return [];
    }
}

export async function fetchAllMetadata(targetOrg: string) {
    console.log(`\n[2/2] Fetching All Metadata Components...`);
    // console.log('Describing metadata types (via sf org list metadata-types)...');
    const startTime = Date.now();

    const types = await describeMetadata(targetOrg);
    // console.log(`Found ${types.length} types.`);
    
    // Filter types to those likely to be metadata
    const validTypes = types.filter((typeObj: any) => {
        const typeName = typeObj.xmlName;
        // Skip some system types that are not metadata or cause issues
        if (['User', 'Group', 'Organization', 'DataType', 'EntityDefinition'].includes(typeName)) return false;
        if (typeName.endsWith('History') || typeName.endsWith('Share') || typeName.endsWith('Feed')) return false;
        return true;
    });
    
    console.log(`      Found ${validTypes.length} valid metadata types to scan.`);

    const results: any[] = [];
    const CONCURRENCY_LIMIT = 10;
    const activePromises: Set<Promise<void>> = new Set();
    let completed = 0;

    for (const typeObj of validTypes) {
        const typeName = typeObj.xmlName;

        const p = (async () => {
            const records = await listMetadata(targetOrg, typeName);
            if (records && records.length > 0) {
                results.push(records);
            }
            completed++;
            const percent = Math.round((completed / validTypes.length) * 100);
            process.stdout.write(`      Progress: [${completed}/${validTypes.length}] ${percent}% (${typeName})          \r`);
        })();
        
        activePromises.add(p);
        p.then(() => activePromises.delete(p));

        if (activePromises.size >= CONCURRENCY_LIMIT) {
            await Promise.race(activePromises);
        }
    }
    
    await Promise.all(activePromises);
    const allRecords = results.flat();

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n      ✓ Fetched ${allRecords.length} total metadata components in ${duration}s.`);
    return allRecords;
}

export async function fetchDependencies(targetOrg: string) {
  console.log(`\n[1/2] Fetching Dependency Records from ${targetOrg}...`);
  console.log('      Querying MetadataComponentDependency (this may take time)...');
  const startTime = Date.now();

  const query = 'SELECT MetadataComponentId, MetadataComponentName, MetadataComponentType, RefMetadataComponentId, RefMetadataComponentName, RefMetadataComponentType FROM MetadataComponentDependency';
  
  // Use sf data query with tooling api flag
  const command = `sf data query --query "${query}" --target-org "${targetOrg}" --use-tooling-api --json`;
  
  let stdout;
  try {
      // Note: This attempts to fetch all records in one go. 
      // For very large orgs, this might hit buffer limits or timeouts.
      stdout = await runCommand(command);
  } catch (err: any) {
      throw new Error(`Failed to execute sf command: ${err.message}`);
  }
  
  let result;
  try {
    result = JSON.parse(stdout);
  } catch (e) {
    console.error('Failed to parse JSON response from Salesforce');
    throw new Error('Invalid JSON response from Salesforce');
  }

  if (result.status === 0 && result.result) {
    const records = result.result.records;
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`      ✓ Fetched ${records.length} dependency records in ${duration}s`);
    return records;
  } else {
     throw new Error(`Salesforce API Error: ${result.message || 'Unknown error'}`);
  }
}

export async function fetchDependenciesForId(targetOrg: string, id: string) {
    const query = `SELECT MetadataComponentId, MetadataComponentName, MetadataComponentType, RefMetadataComponentId, RefMetadataComponentName, RefMetadataComponentType FROM MetadataComponentDependency WHERE MetadataComponentId = '${id}' OR RefMetadataComponentId = '${id}'`;
    
    // Use sf data query with tooling api flag
    const command = `sf data query --query "${query}" --target-org "${targetOrg}" --use-tooling-api --json`;
    
    // console.log(\`Fetching dependencies for ID: \${id}...\`);

    const stdout = await runCommand(command);
    
    let result;
    try {
        result = JSON.parse(stdout);
    } catch (e) {
        throw new Error('Invalid JSON response from Salesforce');
    }

    if (result.status === 0 && result.result) {
        return result.result.records;
    } else {
        throw new Error(`Salesforce API Error: ${result.message || 'Unknown error'}`);
    }
}

