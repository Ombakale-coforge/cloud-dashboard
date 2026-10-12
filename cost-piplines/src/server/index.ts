import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import authRoutes from './routes/auth.ts';
import requestRoutes from './routes/requests.ts';
import awsRoutes from './routes/aws.ts';
import azureRoutes from './routes/azure.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from root and cost-dashboard
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../cost-dashboard/.env') });

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Mount routers
app.use('/api/auth', authRoutes);
app.use('/api/requests', requestRoutes);
app.use('/api/aws', awsRoutes);
app.use('/api/azure', azureRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve frontend static build if dist exists (Production VM deployment)
const distPath = path.resolve(__dirname, '../../cost-dashboard/dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  // Client-side SPA routing fallback for non-API GET requests (Express 5 compatible)
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api')) {
      return res.sendFile(path.join(distPath, 'index.html'));
    }
    next();
  });
}

app.listen(PORT, () => {
  console.log(`🚀 Cost Intelligence API listening on http://localhost:${PORT}`);
});

export default app;
