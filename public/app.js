// API Client state
let apiToken = localStorage.getItem('dashboard_token') || '';
let playersData = []; // Cached player list
let countdownInterval = null;

// DOM Elements
const authScreen = document.getElementById('auth-screen');
const mainDashboard = document.getElementById('main-dashboard');
const authForm = document.getElementById('auth-form');
const adminPasswordInput = document.getElementById('admin-password');
const authError = document.getElementById('auth-error');

const clanNameDisplay = document.querySelector('.clan-name-display');
const clanName = document.getElementById('clan-name');
const clanTag = document.getElementById('clan-tag');
const clanLevel = document.getElementById('clan-level');
const clanMembers = document.getElementById('clan-members');
const clanTrophies = document.getElementById('clan-trophies');

const warInfoContainer = document.getElementById('war-info-container');
const btnManualAlert = document.getElementById('btn-manual-alert');
const logoutBtn = document.getElementById('logout-btn');

const playersTableBody = document.getElementById('players-table-body');
const playerSearch = document.getElementById('player-search');
const playerFilter = document.getElementById('player-filter');

const settingsForm = document.getElementById('settings-form');
const settingSaveStatus = document.getElementById('settings-save-status');

const toast = document.getElementById('toast');
const toastMessage = document.getElementById('toast-message');

// Check authentication on startup
const themeToggle = document.getElementById('theme-toggle');

// Initialize theme from localStorage
if (localStorage.getItem('theme') === 'light') {
  document.body.classList.add('light-mode');
  if (themeToggle) themeToggle.innerHTML = '<i class="fa-solid fa-sun"></i>';
}

document.addEventListener('DOMContentLoaded', () => {
  // Theme toggle listener
  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      document.body.classList.toggle('light-mode');
      if (document.body.classList.contains('light-mode')) {
        localStorage.setItem('theme', 'light');
        themeToggle.innerHTML = '<i class="fa-solid fa-sun"></i>';
      } else {
        localStorage.setItem('theme', 'dark');
        themeToggle.innerHTML = '<i class="fa-solid fa-moon"></i>';
      }
    });
  }

  if (apiToken) {
    verifyTokenAndLoad();
  } else {
    showAuthScreen();
  }
});

// Show/Hide Screens
function showAuthScreen() {
  authScreen.classList.remove('hide');
  mainDashboard.classList.add('hide');
}

function showDashboard() {
  authScreen.classList.add('hide');
  mainDashboard.classList.remove('hide');
}

// Token Verification
async function verifyTokenAndLoad() {
  try {
    const res = await fetch('/api/status', {
      headers: { 'Authorization': apiToken }
    });
    
    if (res.ok) {
      showDashboard();
      loadDashboardData();
    } else {
      localStorage.removeItem('dashboard_token');
      apiToken = '';
      showAuthScreen();
    }
  } catch (error) {
    showToast('خطأ في الاتصال بالخادم الرئيسي ❌');
    showAuthScreen();
  }
}

// Handle Login Form
authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const password = adminPasswordInput.value.trim();
  authError.classList.add('hide');

  try {
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    
    const data = await res.json();
    if (res.ok && data.success) {
      apiToken = password;
      localStorage.setItem('dashboard_token', password);
      showDashboard();
      loadDashboardData();
    } else {
      authError.textContent = data.error || 'كلمة مرور خاطئة!';
      authError.classList.remove('hide');
    }
  } catch (error) {
    authError.textContent = 'حدث خطأ بالشبكة أثناء محاولة الاتصال!';
    authError.classList.remove('hide');
  }
});

// Logout Button
logoutBtn.addEventListener('click', () => {
  localStorage.removeItem('dashboard_token');
  apiToken = '';
  showAuthScreen();
});

// Fetch all dashboard data
async function loadDashboardData() {
  loadClanProfile();
  loadWarInfo();
  loadPlayersList();
  loadSettings();
}

// Fetch Clan profile info
async function loadClanProfile() {
  try {
    const res = await fetch('/api/clan', {
      headers: { 'Authorization': apiToken }
    });
    if (!res.ok) throw new Error();
    const clan = await res.json();

    clanNameDisplay.textContent = clan.name;
    clanName.textContent = clan.name;
    clanTag.textContent = clan.tag;
    clanLevel.textContent = clan.clanLevel || '--';
    clanMembers.textContent = `${clan.members}/50`;
    clanTrophies.textContent = clan.clanScore || clan.clanWarTrophies || '--';
  } catch (err) {
    clanName.textContent = 'غير متصل';
    clanNameDisplay.textContent = 'خطأ في جلب ملف الكلان';
  }
}

// Fetch active war status
async function loadWarInfo() {
  if (countdownInterval) clearInterval(countdownInterval);
  
  try {
    const res = await fetch('/api/war', {
      headers: { 'Authorization': apiToken }
    });
    if (!res.ok) throw new Error();
    const war = await res.json();

    if (war.state === 'error') {
      warInfoContainer.innerHTML = `
        <div class="text-center py-4">
          <i class="fa-solid fa-triangle-exclamation text-warning" style="font-size: 2.5rem; margin-bottom:10px;"></i>
          <p>⚠️ ${war.reason || 'خطأ مؤقت في الاتصال بسيرفرات اللعبة'}</p>
        </div>
      `;
      return;
    }

    if (!war.inWar) {
      warInfoContainer.innerHTML = `
        <div class="text-center py-4">
          <i class="fa-solid fa-bed text-danger" style="font-size: 2.5rem; margin-bottom:10px;"></i>
          <p>💤 الكلان ليس في سباق حرب حالياً.</p>
        </div>
      `;
      return;
    }

    const typeStr = war.state === 'trainingDay' ? 'أيام تدريب (Practice)' : 'يوم حرب (Battle Day)';
    
    warInfoContainer.innerHTML = `
      <div class="war-stats-summary">
        <div class="war-score-panel">
          <div class="clan-score">
            <h4>${war.clan.name}</h4>
            <div class="score-stars" style="font-size: 1.3rem; margin-top:5px;">${war.clan.stars} 🏆 الشهرة</div>
            <div class="score-destruction" style="margin-top:5px;">الهجمات اليوم: ${war.clan.attacks}</div>
          </div>
          
          <div class="vs-divider">ضد</div>
          
          <div class="opponent-score">
            <h4>المتصدر حالياً</h4>
            <div class="score-stars" style="font-size: 1.3rem; margin-top:5px; color:var(--color-danger);">${war.opponent.stars} 🏆 الشهرة</div>
            <div class="score-destruction" style="margin-top:5px;">${war.opponent.name}</div>
          </div>
        </div>

        <div class="text-center">
          <span class="badge badge-gold">${typeStr}</span>
          <p style="margin-top:8px; font-size:0.85rem; color:var(--color-text-gray);">عدد الأعضاء المشاركين اليوم: ${war.clan.members.filter(m => m.decksUsedToday > 0).length}/${war.teamSize}</p>
        </div>

        <div class="war-time-panel">
          <div class="war-time-title">ينتهي اليوم الحربي الحالي خلال</div>
          <div id="war-timer" class="war-time-clock">--:--:--</div>
        </div>
      </div>
    `;
    startCountdown(war.endTime);
  } catch (err) {
    warInfoContainer.innerHTML = `<p class="text-danger text-center">خطأ في جلب بيانات سباق النهر.</p>`;
  }
}

// Countdown timer loop
function startCountdown(targetTimeStr) {
  const targetTime = new Date(targetTimeStr).getTime();
  
  function updateTimer() {
    const now = new Date().getTime();
    const diff = targetTime - now;
    const timerElem = document.getElementById('war-timer');
    
    if (!timerElem) {
      clearInterval(countdownInterval);
      return;
    }

    if (diff <= 0) {
      timerElem.textContent = 'منتهي';
      clearInterval(countdownInterval);
      loadWarInfo(); // Reload war status
      return;
    }

    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);

    const pad = (num) => String(num).padStart(2, '0');
    timerElem.textContent = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }
  
  updateTimer();
  countdownInterval = setInterval(updateTimer, 1000);
}

// Fetch players list
async function loadPlayersList() {
  try {
    const res = await fetch('/api/players', {
      headers: { 'Authorization': apiToken }
    });
    if (!res.ok) throw new Error();
    playersData = await res.json();
    renderPlayersTable();
  } catch (err) {
    playersTableBody.innerHTML = `
      <tr>
        <td colspan="6" class="text-center text-danger">خطأ في جلب قائمة اللاعبين. يرجى مراجعة الـ API Key في الإعدادات.</td>
      </tr>
    `;
  }
}

// Render dynamic players table with search & filter
function renderPlayersTable() {
  const searchQuery = playerSearch.value.trim().toLowerCase();
  const activeFilter = playerFilter.value;

  // Filter cached data
  const filtered = playersData.filter(player => {
    // 1. Search Query filter
    const matchesSearch = player.name.toLowerCase().includes(searchQuery) || 
                          player.tag.toLowerCase().includes(searchQuery) ||
                          (player.telegramName && player.telegramName.toLowerCase().includes(searchQuery));
    
    if (!matchesSearch) return false;

    // 2. Dropdown Filter
    if (activeFilter === 'unregistered') return !player.registered;
    if (activeFilter === 'registered') return player.registered;
    if (activeFilter === 'missing-attacks') return player.inWar && player.attacksRemaining > 0;

    return true;
  });

  // Check if empty
  if (filtered.length === 0) {
    playersTableBody.innerHTML = `
      <tr>
        <td colspan="6" class="text-center">لا توجد نتائج تطابق خيارات الفلترة المحددة.</td>
      </tr>
    `;
    return;
  }

  // Populate rows
  playersTableBody.innerHTML = filtered.map(p => {
    let attackBadge = '';
    if (p.inWar) {
      if (p.attacksRemaining === 0) {
        attackBadge = `<span class="badge badge-green">مكتمل (4/4)</span>`;
      } else if (p.attacksRemaining === 4) {
        attackBadge = `<span class="badge badge-red">لم يهجم بعد (0/4)</span>`;
      } else {
        attackBadge = `<span class="badge badge-orange">متبقي ${p.attacksRemaining} هجمات (${p.attacksDone}/4)</span>`;
      }
    } else {
      attackBadge = `<span class="badge badge-gray">غير مشارك بالحرب</span>`;
    }

    let telegramCol = '';
    let actionCol = '';

    if (p.registered) {
      const tgRef = p.telegramUsername 
        ? `<a href="https://t.me/${p.telegramUsername}" target="_blank" class="text-success"><i class="fa-brands fa-telegram"></i> @${p.telegramUsername}</a>`
        : `<span class="text-success"><i class="fa-solid fa-user-check"></i> ${p.telegramName}</span>`;
      
      telegramCol = `
        <div style="font-weight:700;">${tgRef}</div>
        <div style="font-size:0.75rem; color:var(--color-text-gray);">ID: ${p.telegramId}</div>
      `;
      
      let alertBtn = '';
      if (p.inWar && p.attacksRemaining > 0) {
        alertBtn = `
          <button class="btn btn-gold" style="padding: 5px 10px; font-size: 0.8rem; margin-left: 5px;" onclick="alertPlayer('${p.telegramId}', '${p.name}')" title="تنبيه فردي">
            <i class="fa-solid fa-bell"></i>
          </button>
        `;
      }

      actionCol = `
        <div style="display:flex; justify-content:center; gap:5px;">
          ${alertBtn}
          <button class="btn btn-dark" style="padding: 5px 10px; font-size: 0.8rem;" onclick="unlinkPlayer('${p.telegramId}', '${p.name}')" title="إلغاء ربط الحساب">
            <i class="fa-solid fa-link-slash text-danger"></i>
          </button>
        </div>
      `;
    } else {
      telegramCol = `<span class="badge badge-red"><i class="fa-solid fa-circle-exclamation"></i> غير مربوط</span>`;
      actionCol = `<button class="btn btn-dark" disabled title="لا يمكن إلغاء ربط حساب غير مسجل" style="padding: 5px 10px; font-size: 0.8rem;"><i class="fa-solid fa-link-slash text-danger" style="opacity:0.3"></i></button>`;
    }

    const roleTranslate = {
      'leader': 'قائد',
      'coLeader': 'مساعد قائد',
      'elder': 'عضو مميز',
      'member': 'عضو'
    };

    return `
      <tr>
        <td class="text-center">${p.mapPosition || '--'}</td>
        <td>
          <div style="font-weight:700;">${p.name}</div>
          <div class="tag-display" style="font-size:0.7rem; margin:0;">${p.tag}</div>
        </td>
        <td class="text-center">${roleTranslate[p.role] || p.role || 'عضو'}</td>
        <td class="text-center" style="color:var(--gold-primary); font-weight:bold;">🏆 ${p.trophies || 0}</td>
        <td class="text-center text-success">${p.donations || 0}</td>
        <td>${attackBadge}</td>
        <td>${telegramCol}</td>
        <td class="text-center">${actionCol}</td>
      </tr>
    `;
  }).join('');
}

// Unlink event
window.unlinkPlayer = async function(telegramId, playerName) {
  if (!confirm(`هل أنت متأكد من إلغاء ربط لاعب كلاش رويال (${playerName}) بحساب التلجرام هذا؟`)) return;

  try {
    const res = await fetch(`/api/players/${telegramId}`, {
      method: 'DELETE',
      headers: { 'Authorization': apiToken }
    });
    
    if (res.ok) {
      showToast('تم إلغاء ربط الحساب بنجاح ✅');
      loadPlayersList();
    } else {
      showToast('خطأ في إلغاء الربط', true);
    }
  } catch (err) {
    showToast('خطأ في الاتصال بالخادم', true);
  }
};

window.alertPlayer = async function(telegramId, playerName) {
  if (!confirm(`هل تريد إرسال تنبيه خاص للاعب (${playerName}) لإنهاء هجماته؟`)) return;

  try {
    const res = await fetch(`/api/alert-player`, {
      method: 'POST',
      headers: { 
        'Authorization': apiToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ telegramId })
    });
    
    if (res.ok) {
      showToast('تم إرسال التنبيه بنجاح 🔔');
    } else {
      showToast('خطأ في إرسال التنبيه', true);
    }
  } catch (err) {
    showToast('خطأ في الاتصال بالخادم', true);
  }
};

// Search & Filter event listeners
playerSearch.addEventListener('input', renderPlayersTable);
playerFilter.addEventListener('change', renderPlayersTable);

// Load Settings Panel data
async function loadSettings() {
  try {
    const res = await fetch('/api/settings', {
      headers: { 'Authorization': apiToken }
    });
    if (!res.ok) throw new Error();
    const settings = await res.json();

    document.getElementById('setting-clan-tag').value = settings.clan_tag || '';
    document.getElementById('setting-coc-api-key').value = settings.coc_api_key || '';
    document.getElementById('setting-telegram-token').value = settings.telegram_token || '';
    document.getElementById('setting-group-chat-id').value = settings.group_chat_id || '';
    document.getElementById('setting-warning-hours').value = settings.warning_hours || '12, 6, 2, 1';
  } catch (err) {
    showToast('فشل في تحميل الإعدادات ❌');
  }
}

// Save Settings Form
settingsForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  settingSaveStatus.textContent = 'جاري الحفظ... ⏳';
  settingSaveStatus.className = 'save-status';

  const updates = {
    clan_tag: document.getElementById('setting-clan-tag').value.trim(),
    coc_api_key: document.getElementById('setting-coc-api-key').value.trim(),
    telegram_token: document.getElementById('setting-telegram-token').value.trim(),
    group_chat_id: document.getElementById('setting-group-chat-id').value.trim(),
    warning_hours: document.getElementById('setting-warning-hours').value.trim()
  };

  const newPass = document.getElementById('setting-dashboard-password').value.trim();
  if (newPass) {
    updates.dashboard_password = newPass;
  }

  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': apiToken
      },
      body: JSON.stringify(updates)
    });

    if (res.ok) {
      settingSaveStatus.textContent = 'تم حفظ الإعدادات بنجاح! ✅ (سيعيد البوت التشغيل تلقائياً خلال ثانية)';
      settingSaveStatus.className = 'save-status text-success';
      if (newPass) {
        apiToken = newPass;
        localStorage.setItem('dashboard_token', newPass);
      }
      document.getElementById('setting-dashboard-password').value = '';
      setTimeout(() => {
        settingSaveStatus.textContent = '';
      }, 5000);
      loadDashboardData();
    } else {
      throw new Error();
    }
  } catch (err) {
    settingSaveStatus.textContent = 'فشل في حفظ الإعدادات ❌';
    settingSaveStatus.className = 'save-status text-danger';
  }
});

// Trigger Manual alert notifications
btnManualAlert.addEventListener('click', async () => {
  btnManualAlert.disabled = true;
  btnManualAlert.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> جاري الإرسال...';
  
  try {
    const res = await fetch('/api/manual-trigger', {
      method: 'POST',
      headers: { 'Authorization': apiToken }
    });
    
    const data = await res.json();
    
    if (res.ok && data.success) {
      if (data.playersAlertedCount > 0 || data.message.includes('complete')) {
        showToast(`تم إرسال التنبيهات بنجاح! 🔔 (${data.message})`);
      } else {
        showToast(`تم تشغيل التنبيه: ${data.message} ⚠️`);
      }
      loadPlayersList();
    } else {
      showToast(`فشل الإرسال: ${data.error || 'حدث خطأ غير معروف'}`);
    }
  } catch (err) {
    showToast('خطأ في الاتصال بالخادم ❌', true);
  } finally {
    btnManualAlert.disabled = false;
    btnManualAlert.innerHTML = '<i class="fa-solid fa-users"></i> تنبيه للجميع';
  }
});

// Trigger Missing alerts
const btnMissingAlert = document.getElementById('btn-missing-alert');
if (btnMissingAlert) {
  btnMissingAlert.addEventListener('click', async () => {
    if (!confirm('هل تريد إرسال تنبيهات خاصة للأعضاء الذين لم يكملوا هجماتهم فقط؟')) return;
    
    btnMissingAlert.disabled = true;
    btnMissingAlert.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> جاري الإرسال...';
    
    try {
      const res = await fetch('/api/alert-missing', {
        method: 'POST',
        headers: { 'Authorization': apiToken }
      });
      
      const data = await res.json();
      
      if (res.ok && data.success) {
        showToast(`تم إرسال التنبيهات الفردية بنجاح! 🔔 (${data.message})`);
      } else {
        showToast(`فشل في الإرسال: ${data.error || 'خطأ غير معروف'} ❌`, true);
      }
    } catch (err) {
      showToast('خطأ في الاتصال بالخادم ❌', true);
    } finally {
      btnMissingAlert.disabled = false;
      btnMissingAlert.innerHTML = '<i class="fa-solid fa-clock-rotate-left"></i> تنبيه المتأخرين';
    }
  });
}

// Toast system
function showToast(message, duration = 4000) {
  toastMessage.textContent = message;
  toast.classList.remove('hide');
  setTimeout(() => {
    toast.classList.add('hide');
  }, duration);
}

// Tab Switching logic
const tabBtns = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');

tabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const tabId = btn.getAttribute('data-tab');
    
    tabBtns.forEach(b => b.classList.remove('active'));
    tabContents.forEach(c => c.classList.remove('active'));
    
    btn.classList.add('active');
    document.getElementById(tabId).classList.add('active');
  });
});
