import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import path from 'path';
import open from 'open';
import { getAllDependencies, getComponents, initDb, searchComponents } from './db';
import { fetchDependenciesForId } from './salesforce';

export function startServer(port: number, targetOrg?: string) {
  const app = express();
  app.use(cors());
  app.use(express.json());

  // Initialize DB safely
  initDb();

  app.get('/api/dependencies', (req, res) => {
    try {
      const deps = getAllDependencies();
      res.json(deps);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/components', (req: Request, res: Response) => {
    try {
      const q = req.query.q as string || '';
      const results = searchComponents(q);
      res.json(results);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/dependencies/:id', async (req: Request, res: Response) => {
    const id = req.params.id as string;
    try {
      if (targetOrg) {
         try {
            console.log(`Fetching dependencies for ${id} from Salesforce...`);
            const records = await fetchDependenciesForId(targetOrg, id);
            
            // Map records to a format the UI expects, and augment with local component data if possible
            // Since we don't store dependencies, we return the records directly in the expected format
            // optionally resolving component names/stats from our local DB.
            
            const db = getComponents(); 
            const compMap = new Map(db.map((c: any) => [c.id, c]));

            const results = records.map((dep: any) => {
                const s = compMap.get(dep.MetadataComponentId) || {};
                const t = compMap.get(dep.RefMetadataComponentId) || {};

                return {
                    id: dep.Id || `${dep.MetadataComponentId}-${dep.RefMetadataComponentId}`,
                    metadataComponentId: dep.MetadataComponentId,
                    metadataComponentName: dep.MetadataComponentName,
                    metadataComponentType: dep.MetadataComponentType,
                    metadataComponentSize: s.size,
                    metadataComponentCoverage: s.coverage,

                    refMetadataComponentId: dep.RefMetadataComponentId,
                    refMetadataComponentName: dep.RefMetadataComponentName || dep.RefMetadataComponentComponentName,
                    refMetadataComponentType: dep.RefMetadataComponentType,
                    refMetadataComponentSize: t.size,
                    refMetadataComponentCoverage: t.coverage
                };
            });
            
            res.json(results);
            return;

         } catch (e: any) {
            console.error('Error fetching from Salesforce:', e.message);
            res.status(500).json({ error: e.message });
            return;
         }
      }
      
      // If no targetOrg, we can't really do anything since we don't store dependencies
       res.json([]);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Serve frontend
  const clientDist = path.join(__dirname, '../client/dist');
  app.use(express.static(clientDist));

  // SPA fallback for any other route
  app.get(/.*/, (req: Request, res: Response) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });

  app.listen(port, () => {
    const url = `http://localhost:${port}`;
    console.log(`Server running at ${url}`);
    if (targetOrg) console.log(`Connected to Salesforce Org: ${targetOrg}`);
    console.log('Opening browser...');
    open(url);
  });
}
