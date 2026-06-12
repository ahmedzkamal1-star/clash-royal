import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDb } from '../src/db/index.js';
import { initBot } from '../src/bot/index.js';
import { startScheduler, triggerWarAlerts } from '../src/bot/scheduler.js';
import { setupApiRoutes } from '../src/server/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// Serve dashboard static files
// Note: On Vercel, static files are usually handled by vercel.json rewrites, 
// but we keep this here for local dev compatibility.
app.use(express.static(path.join(__dirname, '../public')));

// Lazy initialization wrapper
let isInitialized = false;
let botInstance = null;

async function ensureInitialized() {
  if (!isInitialized) {
    try {
      await initDb();
      botInstance = await initBot();
      if (botInstance) {
        startScheduler(botInstance);
      }
      isInitialized = true;
    } catch (err) {
      console.error('Failed to initialize during request:', err);
    }
  }
}

// Global middleware to ensure services are ready
app.use(async (req, res, next) => {
  await ensureInitialized();
  next();
});

// Setup standard Dashboard API Routes
setupApiRoutes(app);

// Webhook endpoint for Telegram
app.post('/api/telegram-webhook', async (req, res) => {
  if (botInstance) {
    await botInstance.handleUpdate(req.body, res);
  } else {
    res.status(200).send('Bot not initialized');
  }
});

// Setup webhook URL dynamically (Visit this once after deployment)
app.get('/api/setup-webhook', async (req, res) => {
  if (!botInstance) return res.status(400).send('Bot not initialized');
  
  const host = req.headers.host;
  const webhookUrl = `https://${host}/api/telegram-webhook`;
  
  try {
    await botInstance.telegram.setWebhook(webhookUrl);
    res.send(`Webhook successfully set to: ${webhookUrl}`);
  } catch (error) {
    res.status(500).send(`Failed to set webhook: ${error.message}`);
  }
});

// Cron job endpoint (Pinged every 15 minutes by cron-job.org)
app.get('/api/cron', async (req, res) => {
  if (botInstance) {
    const result = await triggerWarAlerts(false);
    res.json(result);
  } else {
    res.status(400).json({ success: false, error: 'Bot not initialized' });
  }
});

export default app;
