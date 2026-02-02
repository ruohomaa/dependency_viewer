import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import path from 'path';
import open from 'open';
import { getAllDependencies, getDependenciesForComponent, initDb, searchComponents, insertDependencies } from './db';
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
            insertDependencies(records);
         } catch (e: any) {
            console.error('Error fetching from Salesforce:', e.message);
         }
      }
      
      const deps = getDependenciesForComponent(id);
      res.json(deps);
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
