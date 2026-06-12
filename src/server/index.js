import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { 
  getAllSettings, 
  updateSetting, 
  getAllPlayers, 
  deletePlayerMapping,
  getSetting
} from '../db/index.js';
import { getClanInfo, getUnifiedActiveWar } from '../coc/api.js';
import { triggerWarAlerts } from '../bot/scheduler.js';
import { restartBot } from '../bot/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function setupApiRoutes(app) {
  // Authentication Middleware
  async function checkAuth(req, res, next) {
    const password = req.headers['authorization'] || req.query.token;
    const dbPassword = await getSetting('dashboard_password');
    
    if (password === dbPassword) {
      next();
    } else {
      res.status(401).json({ error: 'Unauthorized: Invalid dashboard password' });
    }
  }

  // Auth check endpoint
  app.post('/api/auth', async (req, res) => {
    const { password } = req.body;
    const dbPassword = await getSetting('dashboard_password');
    if (password === dbPassword) {
      res.json({ success: true });
    } else {
      res.status(401).json({ success: false, error: 'Invalid password' });
    }
  });

  // Get status of API and configs
  app.get('/api/status', async (req, res) => {
    try {
      const settings = await getAllSettings();
      const hasToken = !!settings.telegram_token;
      const hasApiKey = !!settings.coc_api_key;
      const hasClan = !!settings.clan_tag;
      
      res.json({
        botRunning: true,
        configured: hasToken && hasApiKey && hasClan,
        hasToken,
        hasApiKey,
        hasClan
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get clan details
  app.get('/api/clan', checkAuth, async (req, res) => {
    try {
      const clanTag = await getSetting('clan_tag');
      if (!clanTag) {
        return res.status(400).json({ error: 'Clan tag is not configured.' });
      }
      const clan = await getClanInfo(clanTag);
      res.json(clan);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get current war details
  app.get('/api/war', checkAuth, async (req, res) => {
    try {
      const war = await getUnifiedActiveWar();
      res.json(war);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get all registered players
  app.get('/api/players', checkAuth, async (req, res) => {
    try {
      const dbPlayers = await getAllPlayers();
      const war = await getUnifiedActiveWar();
      
      // Map database players
      const playerMap = new Map();
      dbPlayers.forEach(p => {
        playerMap.set(p.player_tag, p);
      });

      // Combine database with active war members
      let list = [];
      if (war && war.inWar && war.clan && war.clan.members) {
        // Find who is in war, their attack status, and if they are registered
        list = war.clan.members.map(member => {
          const registered = playerMap.get(member.tag);
          const maxAttacks = war.type === 'cwl' ? 1 : 2;
          const attacksDone = member.attacks ? member.attacks.length : 0;
          
          return {
            tag: member.tag,
            name: member.name,
            townhallLevel: member.townhallLevel,
            mapPosition: member.mapPosition,
            attacksDone,
            attacksRemaining: maxAttacks - attacksDone,
            inWar: true,
            registered: !!registered,
            telegramName: registered ? registered.telegram_name : null,
            telegramUsername: registered ? registered.telegram_username : null,
            telegramId: registered ? registered.telegram_id : null
          };
        });

        // Add registered players who are NOT in the current war
        const warTags = new Set(war.clan.members.map(m => m.tag));
        dbPlayers.forEach(p => {
          if (!warTags.has(p.player_tag)) {
            list.push({
              tag: p.player_tag,
              name: p.player_name,
              townhallLevel: null,
              mapPosition: null,
              attacksDone: 0,
              attacksRemaining: 0,
              inWar: false,
              registered: true,
              telegramName: p.telegram_name,
              telegramUsername: p.telegram_username,
              telegramId: p.telegram_id
            });
          }
        });
      } else {
        // No active war: just list database players
        list = dbPlayers.map(p => ({
          tag: p.player_tag,
          name: p.player_name,
          townhallLevel: null,
          mapPosition: null,
          attacksDone: 0,
          attacksRemaining: 0,
          inWar: false,
          registered: true,
          telegramName: p.telegram_name,
          telegramUsername: p.telegram_username,
          telegramId: p.telegram_id
        }));
      }

      res.json(list);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Delete a registered user mapping
  app.delete('/api/players/:telegramId', checkAuth, async (req, res) => {
    try {
      const { telegramId } = req.params;
      await deletePlayerMapping(telegramId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get current settings
  app.get('/api/settings', checkAuth, async (req, res) => {
    try {
      const settings = await getAllSettings();
      // Don't leak full token/keys in response, mask them
      const masked = { ...settings };
      if (masked.telegram_token) {
        masked.telegram_token = masked.telegram_token.substring(0, 6) + '...' + masked.telegram_token.substring(masked.telegram_token.length - 4);
      }
      if (masked.coc_api_key) {
        masked.coc_api_key = masked.coc_api_key.substring(0, 10) + '...';
      }
      res.json(masked);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Update settings
  app.post('/api/settings', checkAuth, async (req, res) => {
    try {
      const updates = req.body;
      
      for (const [key, value] of Object.entries(updates)) {
        // If updating masked value, check if it changed
        if (value.includes('...')) {
          continue; // Skip writing masked key back
        }
        await updateSetting(key, value);
      }
      
      res.json({ success: true });
      
      // Asynchronously restart bot to apply new configurations
      setTimeout(() => {
        restartBot().catch(err => console.error('Failed to restart bot on settings change:', err.message));
      }, 1000);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Trigger manual reminder
  app.post('/api/manual-trigger', checkAuth, async (req, res) => {
    try {
      const result = await triggerWarAlerts(true); // true means forced trigger
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
}
