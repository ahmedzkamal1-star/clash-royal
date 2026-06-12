import dotenv from 'dotenv';
import axios from 'axios';
import app from '../api/index.js';

dotenv.config();

async function main() {
  console.log('--- CLAN WAR REMINDER SYSTEM STARTING (LOCAL DEV) ---');
  
  try {
    // Log External IP for Clash Royale API Whitelisting (Optional, proxy is used now)
    try {
      const { data } = await axios.get('https://api.ipify.org?format=json');
      console.log(`\n======================================================`);
      console.log(`🌍 PUBLIC IP ADDRESS: ${data.ip}`);
      console.log(`⚠️ (Not required if using RoyaleAPI proxy)`);
      console.log(`======================================================\n`);
    } catch (e) {
      console.log('Could not fetch public IP address.');
    }

    const port = process.env.PORT || 3000;
    app.listen(port, () => {
      console.log(`Local Web Server listening on port ${port}`);
      console.log(`Dashboard available at http://localhost:${port}/`);
      console.log(`Cron endpoint test available at http://localhost:${port}/api/cron`);
    });
    
  } catch (error) {
    console.error('Fatal error during application startup:', error);
    process.exit(1);
  }
}

main();
