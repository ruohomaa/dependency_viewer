import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import path from 'path';
import open from 'open';
import { getAllDependencies, initDb } from './db';

export function startServer(port: number) {
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

  // Serve frontend
  const clientDist = path.join(__dirname, '../client/dist');
  app.use(express.static(clientDist));

  // SPA fallback for any other route
  app.get(/.*/, (req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });

  app.listen(port, () => {
    const url = `http://localhost:${port}`;
    console.log(`Server running at ${url}`);
    console.log('Opening browser...');
    open(url);
  });
}
