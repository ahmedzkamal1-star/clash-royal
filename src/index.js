import dotenv from 'dotenv';
import axios from 'axios';
import { initDb } from './db/index.js';
import { initBot } from './bot/index.js';
import { startScheduler } from './bot/scheduler.js';
import { startServer } from './server/index.js';

dotenv.config();

async function main() {
  console.log('--- CLAN WAR REMINDER SYSTEM STARTING ---');
  
  try {
    // Log External IP for Clash Royale API Whitelisting
    try {
      const { data } = await axios.get('https://api.ipify.org?format=json');
      console.log(`\n======================================================`);
      console.log(`🌍 PUBLIC IP ADDRESS: ${data.ip}`);
      console.log(`⚠️ Copy this IP and paste it in Clash Royale Dev Portal`);
      console.log(`======================================================\n`);
    } catch (e) {
      console.log('Could not fetch public IP address.');
    }

    // 1. Initialize Database
    await initDb();
    
    // 2. Start Express Web Server (Always start it so user can configure the app)
    startServer();
    
    // 3. Initialize Telegram Bot
    const bot = await initBot();
    
    // 4. Start Scheduler if Bot is running
    if (bot) {
      startScheduler(bot);
    } else {
      console.warn('War alert scheduler not started on boot. Bot credentials missing.');
      console.info('Please visit the Web Dashboard to configure the bot token, clan tag, and Clash API key.');
    }
    
  } catch (error) {
    console.error('Fatal error during application startup:', error);
    process.exit(1);
  }
}

main();
