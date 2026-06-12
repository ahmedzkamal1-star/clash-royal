import { Telegraf, Markup } from 'telegraf';
import { 
  initDb, 
  getSetting, 
  registerPlayer, 
  getPlayerByTelegramId, 
  deletePlayerMapping,
  updateSetting
} from '../db/index.js';
import { 
  getPlayerInfo, 
  getClanInfo, 
  getUnifiedActiveWar,
  verifyPlayerApiToken
} from '../coc/api.js';
import { startScheduler } from './scheduler.js';

let bot = null;
const registrationSessions = new Map();

// Helper to restart bot dynamically
export async function restartBot() {
  if (bot) {
    try {
      await bot.stop();
      console.log('Existing Telegram bot stopped.');
    } catch (e) {
      console.warn('Warning when stopping bot:', e.message);
    }
    bot = null;
  }
  
  const newBot = await initBot();
  if (newBot) {
    startScheduler(newBot);
  }
}

// Helper to format remaining time (until next 10:00 AM UTC reset)
export function getRelativeTimeStr(endTimeStr) {
  const diffMs = new Date(endTimeStr) - new Date();
  if (diffMs <= 0) return 'منتهية';
  
  const diffHrs = Math.floor(diffMs / (1000 * 60 * 60));
  const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  
  let timeStr = '';
  if (diffHrs > 0) timeStr += `${diffHrs} ساعة و `;
  timeStr += `${diffMins} دقيقة`;
  return timeStr;
}

// Generate the standard keyboard
function getMainMenu() {
  return Markup.keyboard([
    ['⚔️ سباق الحرب (River Race)', '👤 حسابي'],
    ['🛡️ معلومات الكلان', '📝 ربط الحساب']
  ]).resize();
}

export async function initBot() {
  const token = await getSetting('telegram_token');
  if (!token) {
    console.warn('Telegram Bot Token not set in database. Bot will not start.');
    return null;
  }

  bot = new Telegraf(token);

  // Error handling
  bot.catch((err, ctx) => {
    console.error(`Telegraf error for update type "${ctx.updateType}":`, err);
  });

  // Start Command
  bot.start(async (ctx) => {
    const chatType = ctx.chat.type;
    
    // If added to a group
    if (chatType === 'group' || chatType === 'supergroup') {
      await updateSetting('group_chat_id', ctx.chat.id);
      return ctx.reply(`مرحباً بكم يا أبطال كلاش رويال! ⚔️👑\nلقد تم تفعيل البوت في هذه المجموعة بنجاح.\nسأقوم بإرسال تنبيهات هجمات الحرب (Decks) هنا تلقائياً.`);
    }

    const name = ctx.from.first_name || 'بطل';
    await ctx.reply(
      `أهلاً بك يا ${name} في بوت تنبيه حرب كلاش رويال! 👑⚔️\n\nهذا البوت يساعد الكلان في تذكير الأعضاء بلعب هجمات الحرب الأربعة يومياً.\n\nاستخدم الأزرار بالأسفل للتحكم:`,
      getMainMenu()
    );
  });

  // Help command
  bot.help((ctx) => {
    ctx.reply(
      `أوكرام البوت المتوفرة:\n` +
      `📝 /register - لربط حساب اللعبة الخاص بك بالتاج\n` +
      `👤 /mywar - لمعرفة هجماتك (Decks) المتبقية اليوم\n` +
      `⚔️ /war - لعرض حالة سباق النهر الحالي\n` +
      `🛡️ /clan - لعرض معلومات الكلان\n` +
      `❌ /cancel - لإلغاء التسجيل الجاري\n` +
      `🗑️ /unregister - لإلغاء ربط حسابك الحالي`,
      getMainMenu()
    );
  });

  // Cancel Command
  bot.command('cancel', (ctx) => {
    const telegramId = ctx.from.id;
    if (registrationSessions.has(telegramId)) {
      registrationSessions.delete(telegramId);
      ctx.reply('تم إلغاء عملية التسجيل. ❌', getMainMenu());
    } else {
      ctx.reply('لا توجد عملية تسجيل نشطة لإلغائها.', getMainMenu());
    }
  });

  // Unregister Command
  bot.command('unregister', async (ctx) => {
    const telegramId = ctx.from.id;
    const player = await getPlayerByTelegramId(telegramId);
    if (!player) {
      return ctx.reply('حسابك غير مربوط بأي لاعب كلاش رويال حالياً.', getMainMenu());
    }
    await deletePlayerMapping(telegramId);
    ctx.reply(`تم إلغاء ربط الحساب **${player.player_name}** بنجاح. 🗑️`, getMainMenu());
  });

  // Handler for /register
  bot.command('register', async (ctx) => {
    await startRegistration(ctx);
  });

  // Helper to start registration
  async function startRegistration(ctx) {
    if (ctx.chat.type !== 'private') {
      return ctx.reply('الرجاء إتمام عملية ربط الحساب في المحادثة الخاصة مع البوت وليس في المجموعة! ⚠️');
    }

    const telegramId = ctx.from.id;
    const existing = await getPlayerByTelegramId(telegramId);
    
    if (existing) {
      return ctx.reply(
        `حسابك مربوط بالفعل باللاعب: **${existing.player_name}** (${existing.player_tag}) ✅\n\nإذا كنت ترغب في تغيير الحساب، اكتب /unregister أولاً.`,
        getMainMenu()
      );
    }

    registrationSessions.set(telegramId, { step: 'awaiting_tag' });
    ctx.reply(
      `📝 رجاءً أرسل الـ **Player Tag** الخاص بك من ملفك باللعبة.\n*(مثال: #ABC12345 أو ABC12345)*\n\nيمكنك كتابة /cancel لإلغاء العملية.`,
      Markup.keyboard([['❌ إلغاء التسجيل']]).resize()
    );
  }

  // Handle text messages (Menu Buttons & Registration Flow)
  bot.on('text', async (ctx) => {
    const text = ctx.message.text.trim();
    const telegramId = ctx.from.id;
    const username = ctx.from.username || '';
    const telegramName = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ');

    // Handle cancel button from keyboard
    if (text === '❌ إلغاء التسجيل') {
      if (registrationSessions.has(telegramId)) {
        registrationSessions.delete(telegramId);
        return ctx.reply('تم إلغاء عملية التسجيل. ❌', getMainMenu());
      }
    }

    // 1. Check if user is in registration session (Single step tag validation)
    if (registrationSessions.has(telegramId)) {
      const session = registrationSessions.get(telegramId);

      if (session.step === 'awaiting_tag') {
        let tag = text.toUpperCase();
        if (!tag.startsWith('#')) tag = '#' + tag;

        ctx.reply('جاري البحث عن اللاعب والتحقق من عضويته بالكلان... 🔍');

        try {
          const player = await getPlayerInfo(tag);
          const clanTagSetting = await getSetting('clan_tag');
          const cleanConfigClanTag = clanTagSetting.toUpperCase().startsWith('#') ? clanTagSetting.toUpperCase() : `#${clanTagSetting.toUpperCase()}`;
          
          if (!player.clan || player.clan.tag !== cleanConfigClanTag) {
            return ctx.reply(
              `عذراً! اللاعب **${player.name}** ليس عضواً في الكلان الخاص بنا حالياً. ❌\n` +
              `البوت مخصص فقط لأعضاء الكلان. يرجى التأكد والرد بالـ Tag الصحيح أو إرسال /cancel للإلغاء.`
            );
          }

          await registerPlayer(telegramId, username, telegramName, tag, player.name, 1);
          registrationSessions.delete(telegramId);
          
          return ctx.reply(
            `تم التحقق والربط بنجاح! 🎉\n` +
            `اللاعب المربوط: **${player.name}** (${tag}) ✅\n\n` +
            `ستصلك الآن تنبيهات الهجمات المتبقية يومياً قبل انتهاء وقت الحرب! ⚔️`,
            getMainMenu()
          );

        } catch (error) {
          console.error(error);
          return ctx.reply('لم نتمكن من العثور على هذا اللاعب! ❌\nيرجى التأكد من كتابة الـ Tag بشكل صحيح وإرساله مجدداً:');
        }
      }
    }

    // 2. Handle Menu Buttons
    switch (text) {
      case '🛡️ معلومات الكلان':
        await handleClanInfo(ctx);
        break;

      case '⚔️ سباق الحرب (River Race)':
      case '⚔️ حالة الحرب':
        await handleWarInfo(ctx);
        break;

      case '👤 حسابي':
        await handleMyWar(ctx);
        break;

      case '📝 ربط الحساب':
        await startRegistration(ctx);
        break;

      default:
        if (ctx.chat.type === 'private') {
          ctx.reply('اختر أحد الخيارات من القائمة بالأسفل، أو اكتب /help لمشاهدة جميع الأوامر.', getMainMenu());
        }
        break;
    }
  });

  // In Serverless mode, we DO NOT call bot.launch() here.
  // We return the bot instance so the Express app can use bot.handleUpdate() via webhookCallback.
  console.log('Telegram Bot configured successfully for Serverless Webhooks!');
  return bot;
}

// Handler functions
async function handleClanInfo(ctx) {
  const telegramId = ctx.from.id;
  const player = await getPlayerByTelegramId(telegramId);
  if (!player) {
    return ctx.reply('🔒 عذراً، هذا الأمر مخصص لأعضاء الكلان فقط.\nيرجى التسجيل عبر الضغط على **📝 ربط الحساب** للتمكن من رؤية بيانات الكلان.');
  }

  ctx.reply('جاري جلب معلومات الكلان... 🔍');
  try {
    const clanTag = await getSetting('clan_tag');
    if (!clanTag) {
      return ctx.reply('لم يتم إعداد تاغ الكلان بعد في الإعدادات.');
    }
    const clan = await getClanInfo(clanTag);
    
    let text = `🛡️ **${clan.name}** (${clan.tag})\n`;
    text += `• الأعضاء: ${clan.members}/50 👥\n`;
    text += `• كؤوس الكلان: ${clan.clanScore} 🏆\n`;
    text += `• كؤوس الحرب (War Trophies): ${clan.clanWarTrophies} 👑\n`;
    text += `• نوع الكلان: ${clan.type === 'inviteOnly' ? 'بالدعوة' : clan.type === 'closed' ? 'مغلق' : 'مفتوح'}\n\n`;
    if (clan.description) {
      text += `📝 *الوصف:*\n${clan.description}`;
    }
    
    ctx.reply(text);
  } catch (error) {
    ctx.reply(`خطأ أثناء جلب البيانات: ${error.message}`);
  }
}

async function handleWarInfo(ctx) {
  const telegramId = ctx.from.id;
  const player = await getPlayerByTelegramId(telegramId);
  if (!player) {
    return ctx.reply('🔒 عذراً، هذا الأمر مخصص لأعضاء الكلان فقط.\nيرجى التسجيل عبر الضغط على **📝 ربط الحساب** للتمكن من رؤية بيانات الحرب.');
  }

  ctx.reply('جاري جلب تفاصيل سباق النهر الحالي... 🔍');
  try {
    const war = await getUnifiedActiveWar();
    
    if (!war.inWar) {
      if (war.state === 'notInWar') {
        return ctx.reply('💤 الكلان ليس في سباق حرب حالياً.');
      }
      return ctx.reply(`لا يمكن عرض الحرب حالياً: ${war.message || 'لا توجد حرب نشطة'}`);
    }

    let stateStr = '';
    if (war.state === 'trainingDay') {
      const dayNum = (war.periodIndex % 7) + 1;
      stateStr = `أيام تدريب (اليوم ${dayNum})`;
    } else {
      const dayNum = (war.periodIndex % 7) - 2;
      stateStr = `يوم حرب (اليوم ${dayNum})`;
    }
    
    let text = `⚔️ حالة الحرب: **${stateStr}**\n\n`;

    const rankPrefixes = ['🥇 الأول', '🥈 الثاني', '🥉 الثالث', '🏅 الرابع', '🎖️ الخامس'];
    if (war.clans && war.clans.length > 0) {
      war.clans.forEach((c, i) => {
        const isUs = c.tag === war.clan.tag ? ' (نحن 🛡️)' : '';
        const prefix = rankPrefixes[i] || `${i + 1}-`;
        text += `${prefix} كلان **${c.name}**${isUs}\n└ نقاط القبيلة: ${c.fame} 🏆\n`;
      });
    }

    let topFame = -1;
    let topPlayer = 'لا أحد';
    war.clan.members.forEach(m => {
       if (m.fame > topFame) {
          topFame = m.fame;
          topPlayer = m.name;
       }
    });

    const played = war.clan.attacks;
    const remaining = (war.teamSize * 4) - played;

    text += `\n⚔️ عدد الهجمات الحالية: ${played}\n`;
    text += `⏳ الهجمات المتبقية: ${remaining}\n`;
    text += `⏱️ تنتهي الجولة اليومية خلال: **${getRelativeTimeStr(war.endTime)}**\n`;
    text += `👑 متصدر الحرب في الكلان: **${topPlayer}** (${topFame} 🏆)\n`;
    
    return ctx.reply(text);
  } catch (error) {
    ctx.reply(`حدث خطأ أثناء جلب تفاصيل الحرب: ${error.message}`);
  }
}

async function handleMyWar(ctx) {
  const telegramId = ctx.from.id;
  const player = await getPlayerByTelegramId(telegramId);
  
  if (!player) {
    return ctx.reply('حساب التلجرام الخاص بك غير مربوط بأي لاعب كلاش رويال حالياً. يرجى الضغط على **📝 ربط الحساب** للبدء.');
  }

  ctx.reply(`جاري البحث عن هجماتك المتبقية للاعب **${player.player_name}**... 🔍`);
  
  try {
    const war = await getUnifiedActiveWar();
    
    if (!war.inWar) {
      return ctx.reply('💤 الكلان ليس في حرب نشطة حالياً.');
    }

    const member = war.clan.members.find(m => m.tag === player.player_tag);
    const decksUsedToday = member ? member.decksUsedToday : 0;
    const remaining = 4 - decksUsedToday;

    if (remaining === 0) {
      ctx.reply(`✅ كفو يا **${player.player_name}**! لقد لعبت جميع هجماتك اليومية الأربعة (4/4). جزاك الله خيراً! 🔥👑`);
    } else {
      ctx.reply(`⚠️ انتبه يا **${player.player_name}**! لديك **${remaining}** هجمات (Decks) متبقية اليوم.\nينتهي اليوم الحربي خلال: **${getRelativeTimeStr(war.endTime)}**.\nالرجاء الهجوم ونصرة الكلان! ⚔️🛡️`);
    }
  } catch (error) {
    ctx.reply(`حدث خطأ أثناء فحص هجماتك: ${error.message}`);
  }
}
