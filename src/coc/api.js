import { getSetting } from '../db/index.js';

const BASE_URL = 'https://proxy.royaleapi.dev/v1';

// Helper to make API calls to Clash Royale API
async function royaleRequest(endpoint, method = 'GET', body = null) {
  const apiKey = await getSetting('coc_api_key');
  if (!apiKey) {
    throw new Error('Clash Royale API key is not configured.');
  }

  // URL encode '#' as '%23' in endpoints
  const url = `${BASE_URL}${endpoint.replace(/#/g, '%23')}`;
  
  const headers = {
    'Accept': 'application/json',
    'Authorization': `Bearer ${apiKey}`
  };

  const options = {
    method,
    headers,
    body: body ? JSON.stringify(body) : null
  };

  const response = await fetch(url, options);
  
  if (!response.ok) {
    let errorMsg = `HTTP Error ${response.status}`;
    try {
      const errJson = await response.json();
      if (errJson && errJson.message) {
        errorMsg = errJson.message;
      }
    } catch (e) {
      // Ignore JSON parsing errors for error responses
    }
    throw new Error(errorMsg);
  }

  return await response.json();
}

/**
 * Verifies if player exists and belongs to the configured clan
 * @param {string} playerTag 
 * @param {string} token (ignored in CR but kept for function signature compatibility)
 * @returns {Promise<boolean>}
 */
export async function verifyPlayerToken(playerTag, token = '') {
  try {
    const cleanTag = playerTag.toUpperCase().startsWith('#') ? playerTag.toUpperCase() : `#${playerTag.toUpperCase()}`;
    const player = await getPlayerInfo(cleanTag);
    const clanTagSetting = await getSetting('clan_tag');
    const cleanConfigClanTag = clanTagSetting.toUpperCase().startsWith('#') ? clanTagSetting.toUpperCase() : `#${clanTagSetting.toUpperCase()}`;
    
    return player.clan && player.clan.tag === cleanConfigClanTag;
  } catch (error) {
    console.error('Error verifying player clan status:', error.message);
    return false;
  }
}

/**
 * Verifies the player's official API token (found in game settings) to prove ownership.
 * @param {string} playerTag 
 * @param {string} apiToken
 * @returns {Promise<boolean>}
 */
export async function verifyPlayerApiToken(playerTag, apiToken) {
  try {
    const cleanTag = playerTag.toUpperCase().startsWith('#') ? playerTag.toUpperCase() : `#${playerTag.toUpperCase()}`;
    const response = await royaleRequest(`/players/${cleanTag}/verifytoken`, 'POST', { token: apiToken });
    return response.status === 'ok';
  } catch (error) {
    console.error('Error verifying API Token:', error.message);
    return false;
  }
}

/**
 * Gets detailed player information
 * @param {string} playerTag 
 */
export async function getPlayerInfo(playerTag) {
  const cleanTag = playerTag.toUpperCase().startsWith('#') ? playerTag.toUpperCase() : `#${playerTag.toUpperCase()}`;
  return await royaleRequest(`/players/${cleanTag}`);
}

/**
 * Gets clan information
 * @param {string} clanTag 
 */
export async function getClanInfo(clanTag) {
  const cleanTag = clanTag.toUpperCase().startsWith('#') ? clanTag.toUpperCase() : `#${clanTag.toUpperCase()}`;
  return await royaleRequest(`/clans/${cleanTag}`);
}

/**
 * Gets current river race details
 * @param {string} clanTag 
 */
export async function getCurrentRiverRace(clanTag) {
  const cleanTag = clanTag.toUpperCase().startsWith('#') ? clanTag.toUpperCase() : `#${clanTag.toUpperCase()}`;
  return await royaleRequest(`/clans/${cleanTag}/currentriverrace`);
}

/**
 * Aggregates war status for Clash Royale River Race
 * Returns a unified structure:
 * {
 *   inWar: boolean,
 *   type: 'riverRace',
 *   state: 'warDay' | 'trainingDay' | 'collectionDay' | 'notInWar',
 *   teamSize: number,
 *   startTime: string,
 *   endTime: string,
 *   clan: { tag, name, stars, attacks, destructionPercentage, members: [...] },
 *   opponent: { tag, name, stars, attacks, destructionPercentage, members: [...] }
 * }
 */
export async function getUnifiedActiveWar() {
  const clanTag = await getSetting('clan_tag');
  if (!clanTag) {
    return { inWar: false, state: 'notInWar', reason: 'Clan tag not configured' };
  }

  const cleanClanTag = clanTag.toUpperCase().startsWith('#') ? clanTag.toUpperCase() : `#${clanTag.toUpperCase()}`;

  try {
    // 1. Fetch current river race
    const race = await getCurrentRiverRace(cleanClanTag);
    
    // active if state is not notInWar and not training (we only alert on war days)
    const inWar = race.state && race.state !== 'notInWar' && race.state !== 'training';
    
    // 2. Fetch clan profile to get the complete member list (includes players with 0 decks used today)
    const clanDetails = await getClanInfo(cleanClanTag);
    const membersList = clanDetails.memberList || [];

    // Map existing river race participants by tag
    const participantMap = new Map();
    if (race.clan && race.clan.participants) {
      race.clan.participants.forEach(p => {
        participantMap.set(p.tag, p);
      });
    }

    // 3. Compute global deck reset time (next 10:00 AM UTC)
    const now = new Date();
    const resetTime = new Date();
    resetTime.setUTCHours(10, 0, 0, 0);
    if (now > resetTime) {
      resetTime.setUTCDate(resetTime.getUTCDate() + 1);
    }
    const endTimeStr = resetTime.toISOString();

    // 4. Normalize members to standard structure
    const normalizedMembers = membersList.map(m => {
      const part = participantMap.get(m.tag);
      const decksUsedToday = part ? part.decksUsedToday : 0;
      const fame = part ? part.fame : 0;
      
      // Simulate attacks array for backward compatibility
      const attacks = [];
      for (let i = 0; i < decksUsedToday; i++) {
        attacks.push({});
      }

      return {
        tag: m.tag,
        name: m.name,
        role: m.role || 'member',
        trophies: m.trophies || 0,
        donations: m.donations || 0,
        fame: fame,
        townhallLevel: m.expLevel, // expLevel represents player level in CR
        mapPosition: m.clanRank,
        attacks: attacks, // length represents decksUsedToday
        decksUsedToday: decksUsedToday
      };
    });

    const totalAttacksDone = normalizedMembers.reduce((sum, m) => sum + m.decksUsedToday, 0);

    // Find the highest score (fame) among opponent clans
    let highestOpponentFame = 0;
    let topOpponentName = 'الخصوم';
    if (race.clans) {
      const opponents = race.clans.filter(c => c.tag !== cleanClanTag);
      opponents.forEach(opp => {
        if (opp.fame > highestOpponentFame) {
          highestOpponentFame = opp.fame;
          topOpponentName = opp.name;
        }
      });
    }

    let allClans = [];
    if (race.clans) {
      allClans = race.clans.map(c => ({
        tag: c.tag,
        name: c.name,
        fame: c.fame || 0, // Today's fame (distance moved today)
        periodPoints: c.periodPoints || c.fame || 0 // Total medals for the week
      }));
    }

    return {
      inWar: inWar,
      type: 'riverRace',
      state: race.state,
      periodIndex: race.periodIndex,
      teamSize: membersList.length,
      startTime: now.toISOString(),
      endTime: endTimeStr,
      clans: allClans,
      clan: {
        tag: cleanClanTag,
        name: clanDetails.name,
        stars: race.clan ? race.clan.fame : 0, // Fame maps to stars/points
        destructionPercentage: 0,
        attacks: totalAttacksDone,
        members: normalizedMembers
      },
      opponent: {
        tag: '#OPPONENTS',
        name: topOpponentName,
        stars: highestOpponentFame,
        destructionPercentage: 0,
        attacks: 0
      }
    };
  } catch (error) {
    console.error('Error in getUnifiedActiveWar:', error.message);
    return {
      inWar: false,
      state: 'error',
      reason: error.message || 'خطأ في جلب بيانات الحرب من كلاش رويال'
    };
  }
}
