
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
    console.log(`\n[1/2] Fetching All Metadata Components...`);
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

export async function fetchApexStats(targetOrg: string) {
    console.log(`\n[2/2] Fetching Apex Code Coverage and Size Stats...`);
    const startTime = Date.now();

    async function query(soql: string) {
        try {
            const cmd = `sf data query --query "${soql}" --target-org "${targetOrg}" --use-tooling-api --json`;
            const stdout = await runCommand(cmd);
            const res = JSON.parse(stdout);
            if (res.status === 0 && res.result) return res.result.records;
        } catch (e: any) {
            // console.warn('Query failed', soql, e.message);
        }
        return [];
    }

    // Parallel fetch
    const [classes, triggers, coverage] = await Promise.all([
        query('SELECT Id, LengthWithoutComments FROM ApexClass'),
        query('SELECT Id, LengthWithoutComments FROM ApexTrigger'),
        query('SELECT ApexClassOrTriggerId, NumLinesCovered, NumLinesUncovered FROM ApexCodeCoverageAggregate')
    ]);

    const statsMap = new Map<string, { id: string, size?: number, coverage?: number }>();

    // Process Size
    const processSize = (records: any[]) => {
        for (const r of records) {
            if (r.Id && r.LengthWithoutComments != null) {
                statsMap.set(r.Id, { id: r.Id, size: r.LengthWithoutComments });
            }
        }
    };
    processSize(classes);
    processSize(triggers);

    // Process Coverage
    for (const c of coverage) {
        const id = c.ApexClassOrTriggerId;
        if (!id) continue;
        
        const covered = c.NumLinesCovered || 0;
        const uncovered = c.NumLinesUncovered || 0;
        const total = covered + uncovered;
        let pct = 0;
        if (total > 0) pct = Math.round((covered / total) * 100);

        const existing: { id: string, size?: number, coverage?: number } = statsMap.get(id) || { id };
        existing.coverage = pct;
        statsMap.set(id, existing);
    }
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`      ✓ Fetched stats for ${statsMap.size} components in ${duration}s.`);
    return Array.from(statsMap.values());
}

export async function fetchDependencies(targetOrg: string, type: string) {
    try {
        const query = `SELECT MetadataComponentId, MetadataComponentName, MetadataComponentType, RefMetadataComponentId, RefMetadataComponentName, RefMetadataComponentType FROM MetadataComponentDependency WHERE MetadataComponentType='${type}'`;
        const stdout = await runCommand(`sf data query --use-tooling-api --query "${query}" --target-org "${targetOrg}" --json`);
        const result = JSON.parse(stdout);
        if (result.status === 0 && result.result && result.result.records) {
            return result.result.records;
        }
        return [];
    } catch (e: any) {
        return [];
    }
}

export async function fetchAllDependencies(targetOrg: string) {
    console.log(`\n[3/3] Fetching Dependency Edges...`);
    const startTime = Date.now();

    const types = await describeMetadata(targetOrg);
    const validTypes = types.filter((typeObj: any) => {
        const typeName = typeObj.xmlName;
        if (['User', 'Group', 'Organization', 'DataType', 'EntityDefinition'].includes(typeName)) return false;
        if (typeName.endsWith('History') || typeName.endsWith('Share') || typeName.endsWith('Feed')) return false;
        return true;
    });

    console.log(`      Scanning dependencies for ${validTypes.length} types...`);

    const results: any[] = [];
    const CONCURRENCY_LIMIT = 5; 
    const activePromises: Set<Promise<void>> = new Set();
    let completed = 0;

    for (const typeObj of validTypes) {
        const typeName = typeObj.xmlName;

        const p = (async () => {
            const records = await fetchDependencies(targetOrg, typeName);
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
    console.log(`\n      ✓ Fetched ${allRecords.length} dependency edges in ${duration}s.`);
    return allRecords;
}

export async function openInSalesforce(org: string, id: string) {
    console.log(`Opening ${id} in ${org}...`);
    // -r: url only (no json) does not exist for org open, but --url-only results in a URL string if used with json?
    // Actually sf org open -p /id opens it in the browser.
    // If we want to return the URL to the client, we might use --url-only -r.
    // But since this is a local tool, we can just run the command to open the browser.
    await runCommand(`sf org open --target-org "${org}" --path "/${id}"`);
}



