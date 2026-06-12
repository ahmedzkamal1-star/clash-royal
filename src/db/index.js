import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_KEY in environment variables.');
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Memory cache for settings to avoid querying Supabase on every call
let cachedSettings = null;

// Initialize Database Connection
export async function initDb() {
  try {
    // Test connection by fetching a setting
    const { data, error } = await supabase.from('settings').select('*').limit(1);
    
    if (error) throw error;
    
    // Pre-load settings
    await loadSettings();
    console.log('Database connected successfully (Supabase mode).');
  } catch (error) {
    console.error('Failed to initialize Supabase database:', error.message);
    throw error;
  }
}

// Load settings into memory cache
async function loadSettings() {
  const { data, error } = await supabase.from('settings').select('key, value');
  if (error) {
    console.error('Error loading settings from Supabase:', error.message);
    return;
  }
  
  cachedSettings = {};
  data.forEach(item => {
    cachedSettings[item.key] = item.value;
  });
  
  // Fallback to env variables if not in db
  if (!cachedSettings.clan_tag) cachedSettings.clan_tag = process.env.CLAN_TAG || '';
  if (!cachedSettings.coc_api_key) cachedSettings.coc_api_key = process.env.COC_API_KEY || '';
  if (!cachedSettings.telegram_token) cachedSettings.telegram_token = process.env.TELEGRAM_BOT_TOKEN || '';
  if (!cachedSettings.dashboard_password) cachedSettings.dashboard_password = process.env.DASHBOARD_ADMIN_PASSWORD || 'admin12345';
}

// Settings CRUD operations
export async function getSetting(key) {
  if (!cachedSettings) await loadSettings();
  return cachedSettings[key] !== undefined ? String(cachedSettings[key]) : null;
}

export async function getAllSettings() {
  if (!cachedSettings) await loadSettings();
  return { ...cachedSettings };
}

export async function updateSetting(key, value) {
  const strValue = String(value);
  
  // Update Supabase
  const { error } = await supabase
    .from('settings')
    .upsert({ key: key, value: strValue }, { onConflict: 'key' });
    
  if (error) {
    console.error(`Error updating setting ${key} in Supabase:`, error.message);
    throw error;
  }

  // Update memory cache
  if (!cachedSettings) cachedSettings = {};
  cachedSettings[key] = strValue;
}

// Users (Members) CRUD operations
export async function registerPlayer(telegramId, telegramUsername, telegramName, playerTag, playerName, verified = 1) {
  const cleanTag = playerTag.toUpperCase().startsWith('#') ? playerTag.toUpperCase() : `#${playerTag.toUpperCase()}`;
  
  const { error } = await supabase
    .from('users')
    .upsert({
      telegram_id: String(telegramId),
      telegram_username: telegramUsername || '',
      telegram_name: telegramName || '',
      player_tag: cleanTag,
      player_name: playerName,
      verified: verified ? 1 : 0
    }, { onConflict: 'telegram_id' });

  if (error) {
    console.error('Error registering player to Supabase:', error.message);
    throw error;
  }
}

export async function getPlayerByTelegramId(telegramId) {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('telegram_id', String(telegramId))
    .single();

  if (error && error.code !== 'PGRST116') { // PGRST116 is "No rows found"
    console.error('Error fetching player by Telegram ID:', error.message);
    return null;
  }

  return data || null;
}

export async function getPlayerByTag(playerTag) {
  const cleanTag = playerTag.toUpperCase().startsWith('#') ? playerTag.toUpperCase() : `#${playerTag.toUpperCase()}`;
  
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('player_tag', cleanTag)
    .single();

  if (error && error.code !== 'PGRST116') {
    console.error('Error fetching player by Tag:', error.message);
    return null;
  }

  return data || null;
}

export async function getPlayerByPlayerTag(tag) {
  const { data, error } = await supabase
    .from('players')
    .select('*')
    .eq('player_tag', tag)
    .single();

  if (error && error.code !== 'PGRST116') {
    console.error('Error fetching player by tag:', error.message);
  }
  return data || null;
}

// ----- STRIKES MANAGEMENT -----
export async function getAllStrikes() {
  const data = await getSetting('member_strikes');
  if (!data) return {};
  try {
    return JSON.parse(data);
  } catch (e) {
    return {};
  }
}

export async function updateStrikesData(strikesObj) {
  await updateSetting('member_strikes', JSON.stringify(strikesObj));
}

export async function addStrikeToPlayer(tag, name) {
  const strikes = await getAllStrikes();
  if (!strikes[tag]) {
    strikes[tag] = { name: name, count: 0, last_updated: new Date().toISOString() };
  }
  strikes[tag].count += 1;
  strikes[tag].name = name; // Update name just in case
  strikes[tag].last_updated = new Date().toISOString();
  await updateStrikesData(strikes);
  return strikes[tag].count;
}

export async function resetStrikeForPlayer(tag) {
  const strikes = await getAllStrikes();
  if (strikes[tag]) {
    delete strikes[tag];
    await updateStrikesData(strikes);
  }
}

export async function resetAllStrikes() {
  await updateStrikesData({});
}

export async function getAllPlayers() {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .order('registered_at', { ascending: false });

  if (error) {
    console.error('Error fetching all players from Supabase:', error.message);
    return [];
  }

  return data || [];
}

export async function deletePlayerMapping(telegramId) {
  const { error } = await supabase
    .from('users')
    .delete()
    .eq('telegram_id', String(telegramId));

  if (error) {
    console.error('Error deleting player from Supabase:', error.message);
    throw error;
  }
}

// ----- USER PREFERENCES MANAGEMENT -----
export async function getAllUserPreferences() {
  const data = await getSetting('user_preferences');
  if (!data) return {};
  try {
    return JSON.parse(data);
  } catch (e) {
    return {};
  }
}

export async function updateUserPreferencesData(prefsObj) {
  await updateSetting('user_preferences', JSON.stringify(prefsObj));
}

export async function getUserPreference(telegramId, key, defaultValue = null) {
  const prefs = await getAllUserPreferences();
  const idStr = String(telegramId);
  if (prefs[idStr] && prefs[idStr][key] !== undefined) {
    return prefs[idStr][key];
  }
  return defaultValue;
}

export async function setUserPreference(telegramId, key, value) {
  const prefs = await getAllUserPreferences();
  const idStr = String(telegramId);
  if (!prefs[idStr]) {
    prefs[idStr] = {};
  }
  prefs[idStr][key] = value;
  await updateUserPreferencesData(prefs);
}
