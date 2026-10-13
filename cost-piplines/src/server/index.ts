import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import http from 'http';
import https from 'https';
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

// Helper to resolve certificate path safely
function resolveCertPath(certPath: string): string | null {
  if (!certPath) return null;
  if (path.isAbsolute(certPath) && fs.existsSync(certPath)) return certPath;
  const fromCwd = path.resolve(process.cwd(), certPath);
  if (fs.existsSync(fromCwd)) return fromCwd;
  const fromRoot = path.resolve(__dirname, '../../', certPath);
  if (fs.existsSync(fromRoot)) return fromRoot;
  const fromDir = path.resolve(__dirname, certPath);
  if (fs.existsSync(fromDir)) return fromDir;
  return null;
}

// Server startup: HTTPS (if SSL_PFX_PATH is configured) + HTTP fallback
const SSL_PFX_PATH = process.env.SSL_PFX_PATH;
const SSL_PASSPHRASE = process.env.SSL_PASSPHRASE;
const HTTPS_PORT = Number(process.env.HTTPS_PORT || 443);

const resolvedPfx = SSL_PFX_PATH ? resolveCertPath(SSL_PFX_PATH) : null;

if (resolvedPfx) {
  try {
    const pfxBuffer = fs.readFileSync(resolvedPfx);
    const httpsOptions: https.ServerOptions = {
      pfx: pfxBuffer,
      passphrase: SSL_PASSPHRASE || undefined,
    };

    https.createServer(httpsOptions, app).listen(HTTPS_PORT, () => {
      console.log(`🔒 [HTTPS] Cost Intelligence Dashboard listening on https://localhost:${HTTPS_PORT}`);
    });

    // Also keep HTTP listening so users who type http are supported
    http.createServer(app).listen(PORT, () => {
      console.log(`🚀 [HTTP] Cost Intelligence API listening on http://localhost:${PORT}`);
    });
  } catch (sslErr: any) {
    console.error('❌ [HTTPS] Failed to initialize SSL PFX certificate:', sslErr.message);
    console.warn('⚠️ Falling back to standard HTTP on port', PORT);
    app.listen(PORT, () => {
      console.log(`🚀 Cost Intelligence API listening on http://localhost:${PORT}`);
    });
  }
} else {
  if (SSL_PFX_PATH) {
    console.warn(`⚠️ [HTTPS] SSL_PFX_PATH specified (${SSL_PFX_PATH}) but certificate file was not found.`);
  }
  app.listen(PORT, () => {
    console.log(`🚀 Cost Intelligence API listening on http://localhost:${PORT}`);
  });
}

export default app;
