import { getSetting, getAllPlayers, addStrikeToPlayer, getAllUserPreferences } from '../db/index.js';
import { getUnifiedActiveWar } from '../coc/api.js';
import { getRelativeTimeStr } from './index.js';

let botInstance = null;
const sentAlerts = new Set(); // Tracks unique key: warEndTime_thresholdHour

export function setBotInstance(bot) {
  botInstance = bot;
}

/**
 * Triggers war alerts for players with remaining attacks (unused decks)
 * @param {boolean} forced - If true, ignores time thresholds and alerts immediately
 */
export async function triggerWarAlerts(forced = false) {
  if (!botInstance) {
    return { success: false, error: 'Telegram Bot is not running.' };
  }

  try {
    const war = await getUnifiedActiveWar();
    
    if (!war || !war.inWar) {
      return { success: true, message: 'No active war to alert for.' };
    }

    const endTime = new Date(war.endTime);
    const now = new Date();
    const diffMs = endTime - now;
    
    if (diffMs <= 0) {
      return { success: true, message: 'War day has already ended.' };
    }

    const remainingHours = diffMs / (1000 * 60 * 60);
    const relativeTime = getRelativeTimeStr(war.endTime);

    // Get configuration settings
    const warningHoursSetting = await getSetting('warning_hours');
    const warningHours = warningHoursSetting
      ? warningHoursSetting.split(',').map(h => parseFloat(h.trim())).filter(h => !isNaN(h))
      : [12, 8, 4, 2];
    
    const groupChatId = await getSetting('group_chat_id');
    const prefs = await getAllUserPreferences();

    // Determine if we should alert
    let shouldAlert = forced;
    let activeThreshold = null;

    if (!forced) {
      // Find if we crossed any warning hour threshold
      for (const threshold of warningHours) {
        if (remainingHours <= threshold && remainingHours > (threshold - 1.0)) {
          const alertKey = `${war.endTime}_${threshold}`;
          if (!sentAlerts.has(alertKey)) {
            shouldAlert = true;
            activeThreshold = threshold;
            sentAlerts.add(alertKey);
            break;
          }
        }
      }
    }

    if (!shouldAlert) {
      return { 
        success: true, 
        message: `No alert threshold met. Current remaining hours in day: ${remainingHours.toFixed(2)}h.` 
      };
    }

    // Fetch registered users to match
    const dbPlayers = await getAllPlayers();
    const playerMap = new Map();
    dbPlayers.forEach(p => {
      playerMap.set(p.player_tag, p);
    });

    const playersWithAttacks = [];

    // Filter members who haven't completed 4 decks today
    war.clan.members.forEach(member => {
      const decksUsedToday = member.decksUsedToday || 0;
      const attacksRemaining = 4 - decksUsedToday;
      
      if (attacksRemaining > 0) {
        const registered = playerMap.get(member.tag);
        playersWithAttacks.push({
          tag: member.tag,
          name: member.name,
          attacksRemaining,
          registered: !!registered,
          telegramId: registered ? registered.telegram_id : null,
          telegramUsername: registered ? registered.telegram_username : null,
          telegramName: registered ? registered.telegram_name : null
        });
      }
    });

    if (playersWithAttacks.length === 0) {
      // Send a celebratory message to the group if all attacks are done!
      if (groupChatId) {
        const text = `🎉 **كفو يا أبطال كلاش رويال!**\nلقد أكمل الجميع جميع هجمات الحرب (4/4) لهذا اليوم! صدارة إن شاء الله! ⚔️🛡️🔥👑`;
        await botInstance.telegram.sendMessage(groupChatId, text, { parse_mode: 'Markdown' });
      }
      return { success: true, message: 'All players completed their war decks today. No warnings needed.' };
    }

    // Send Direct Messages to registered players
    let dmCount = 0;
    for (const player of playersWithAttacks) {
      if (player.registered && player.telegramId) {
        // Evaluate preference
        const idStr = String(player.telegramId);
        const prefHours = (prefs[idStr] && prefs[idStr].reminder_hours !== undefined) 
                          ? prefs[idStr].reminder_hours 
                          : 4;
        
        // Skip if user disabled alerts (0) or if this threshold is not their chosen one
        if (prefHours === 0) continue;
        if (!forced && activeThreshold !== prefHours) continue;

        try {
          const dmText = `⚠️ **تنبيه هام من الكلان!** ⚔️\n\nبطلنا **${player.telegramName}** (${player.name})، يتبقى لديك **${player.attacksRemaining}** هجمات (Decks) في حرب الكلان اليوم!\n⏰ ينتهي وقت الحرب اليومي خلال: **${relativeTime}**.\n\nالرجاء لعب هجماتك المتبقية سريعاً! 🛡️👑`;
          await botInstance.telegram.sendMessage(player.telegramId, dmText, { parse_mode: 'Markdown' });
          dmCount++;
        } catch (e) {
          console.warn(`Failed to send DM to player ${player.name} (${player.telegramId}):`, e.message);
        }
      }
    }

    // Send Group Alert mapping all players
    if (groupChatId) {
      let groupText = `⚠️ **تذكير الحرب اليومي عاجل!** ⚔️\n`;
      groupText += `ينتهي اليوم الحربي خلال: **${relativeTime}** ⏱️\n\n`;
      groupText += `👑 **الرجاء من الأعضاء لعب هجماتهم المتبقية (Decks) سريعاً:**\n`;

      const registeredAlerts = [];
      const unregisteredAlerts = [];

      playersWithAttacks.forEach(p => {
        if (p.registered) {
          const tagRef = p.telegramUsername 
            ? `@${p.telegramUsername}` 
            : `[${p.telegramName}](tg://user?id=${p.telegramId})`;
          registeredAlerts.push(`• ${tagRef} (${p.name}) ➡️ متبقي: ${p.attacksRemaining} هجمات`);
        } else {
          unregisteredAlerts.push(`• 👤 ${p.name} ➡️ متبقي: ${p.attacksRemaining} هجمات *(غير مسجل بالبوت)*`);
        }
      });

      if (registeredAlerts.length > 0) {
        groupText += `\n**الأعضاء المسجلين:**\n` + registeredAlerts.join('\n') + `\n`;
      }

      if (unregisteredAlerts.length > 0) {
        groupText += `\n**الأعضاء غير المسجلين:**\n` + unregisteredAlerts.join('\n') + `\n`;
        groupText += `\n💡 *طريقة التسجيل للظهور بالتاغات:*\nافتح محادثة البوت واضغط على **📝 ربط الحساب** واكتب تاغ حسابك.`;
      }

      groupText += `\n\nشدوا الهمة لنفوز بالسباق! 🔥🏆⚔️`;
      
      await botInstance.telegram.sendMessage(groupChatId, groupText, { parse_mode: 'Markdown' });
    }

    return { 
      success: true, 
      message: `Alerts dispatched. Sent ${dmCount} direct messages and 1 group alert.`,
      playersAlertedCount: playersWithAttacks.length
    };
  } catch (error) {
    console.error('Error in triggerWarAlerts:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Triggers individual PMs for missing attacks
 */
export async function triggerMissingAlerts() {
  if (!botInstance) return { success: false, error: 'Telegram Bot is not running.' };

  try {
    const war = await getUnifiedActiveWar();
    if (!war || !war.inWar) return { success: false, error: 'No active war.' };

    const dbPlayers = await getAllPlayers();
    const playerMap = new Map();
    dbPlayers.forEach(p => playerMap.set(p.player_tag, p));

    let count = 0;
    const relativeTime = getRelativeTimeStr(war.endTime);

    for (const member of war.clan.members) {
      const decksUsedToday = member.decksUsedToday || 0;
      const attacksRemaining = 4 - decksUsedToday;
      
      if (attacksRemaining > 0) {
        const registered = playerMap.get(member.tag);
        if (registered && registered.telegram_id) {
          try {
            const message = `⚠️ مرحباً **${member.name}**!\n\nلديك **${attacksRemaining}** هجمات حرب متبقية لليوم.\nالوقت المتبقي: ${relativeTime}\n\nنرجو منك إكمال الهجمات في أقرب وقت لدعم الكلان! ⚔️🛡️`;
            await botInstance.telegram.sendMessage(registered.telegram_id, message, { parse_mode: 'Markdown' });
            count++;
          } catch (e) {
            console.error(`Failed to message ${registered.telegram_id}:`, e.message);
          }
        }
      }
    }

    return { success: true, message: `Sent ${count} individual alerts` };
  } catch (error) {
    console.error('Error in triggerMissingAlerts:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Triggers a PM to a single player by telegramId
 */
export async function triggerPlayerAlert(telegramId) {
  if (!botInstance) return { success: false, error: 'Telegram Bot is not running.' };

  try {
    const war = await getUnifiedActiveWar();
    if (!war || !war.inWar) return { success: false, error: 'No active war.' };

    const dbPlayers = await getAllPlayers();
    const player = dbPlayers.find(p => p.telegram_id === telegramId);
    if (!player) return { success: false, error: 'Player not found in database.' };

    const member = war.clan.members.find(m => m.tag === player.player_tag);
    if (!member) return { success: false, error: 'Player not found in war roster.' };

    const decksUsedToday = member.decksUsedToday || 0;
    const attacksRemaining = 4 - decksUsedToday;
    
    if (attacksRemaining === 0) {
      return { success: false, error: 'Player already completed all attacks.' };
    }

    const relativeTime = getRelativeTimeStr(war.endTime);
    const message = `⚠️ تنبيه خاص لك يا **${member.name}**!\n\nالإدارة تذكرك بأن لديك **${attacksRemaining}** هجمات حرب متبقية لليوم.\nالوقت المتبقي لانتهاء اليوم: ${relativeTime}\n\nنعتمد عليك، لا تتأخر! 👑⚔️`;
    
    await botInstance.telegram.sendMessage(telegramId, message, { parse_mode: 'Markdown' });

    return { success: true, message: `Sent alert to ${member.name}` };
  } catch (error) {
    console.error('Error in triggerPlayerAlert:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Evaluates all clan members and adds strikes to those who missed attacks.
 * Should be triggered at the end of the war day.
 */
export async function evaluateStrikes() {
  if (!botInstance) return { success: false, error: 'Telegram Bot is not running.' };

  try {
    const war = await getUnifiedActiveWar();
    if (!war || !war.inWar) return { success: false, error: 'No active war.' };

    let groupChatId = await getSetting('group_chat_id');
    const warnedPlayers = [];

    for (const member of war.clan.members) {
      const decksUsedToday = member.decksUsedToday || 0;
      const attacksRemaining = 4 - decksUsedToday;
      
      if (attacksRemaining > 0) {
         const strikes = await addStrikeToPlayer(member.tag, member.name);
         if (strikes >= 3) {
            warnedPlayers.push({ name: member.name, tag: member.tag, strikes: strikes });
         }
      }
    }

    if (warnedPlayers.length > 0 && groupChatId) {
      let msg = `🚨 **تحذير للقادة! (نظام الإنذارات الآلي)** 🚨\n\nاللاعبون التاليون وصلوا لـ 3 إنذارات أو أكثر لعدم إكمال هجماتهم:\n`;
      warnedPlayers.forEach(p => {
         msg += `❌ **${p.name}** (${p.tag}) - لديه ${p.strikes} إنذارات!\n`;
      });
      msg += `\nيرجى اتخاذ الإجراء المناسب.`;
      await botInstance.telegram.sendMessage(groupChatId, msg);
    }

    return { 
      success: true, 
      message: `Strikes evaluated successfully. Added strikes to inactive players. Warning sent for ${warnedPlayers.length} players.` 
    };
  } catch (error) {
    console.error('Error in evaluateStrikes:', error.message);
    return { success: false, error: error.message };
  }
}

export function startScheduler(bot) {
  // In serverless architecture (Vercel), we don't use setInterval.
  // Instead, the Vercel cron or an external ping (cron-job.org) will call the /api/cron endpoint
  // which invokes triggerWarAlerts directly.
  setBotInstance(bot);
  console.log('Scheduler initialized in Serverless mode (waiting for /api/cron pings).');
}
