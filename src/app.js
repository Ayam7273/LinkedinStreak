/* =============================================
   LinkedStreak — app.js
   All logic: streak tracking, post verification,
   UI updates, notifications, persistence.
   ============================================= */

// ---- STATE ----
const DEFAULT_STATE = {
  startDate: null,       // ISO date string of first Monday
  name: 'there',
  linkedinProfile: '',
  posts: {},             // { "2025-08-04": { url, loggedAt }, ... }
  streakBest: 0,
  notifPermission: false,
  setupDone: false,
};

let state = loadState();

// ---- UTILITIES ----

function loadState() {
  try {
    const raw = localStorage.getItem('linkedstreak_v1');
    return raw ? { ...DEFAULT_STATE, ...JSON.parse(raw) } : { ...DEFAULT_STATE };
  } catch { return { ...DEFAULT_STATE }; }
}

function saveState() {
  localStorage.setItem('linkedstreak_v1', JSON.stringify(state));
}

function toISO(d) {
  // Returns YYYY-MM-DD for a Date object
  return d.toISOString().split('T')[0];
}

function parseISO(s) {
  // Parse YYYY-MM-DD safely (no timezone shift)
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function formatDate(d) {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function nextMonthFirstMonday() {
  const now = new Date();
  const firstOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const dow = firstOfNextMonth.getDay(); // 0=Sun, 1=Mon...
  const daysToMonday = (dow === 0) ? 1 : (dow === 1) ? 0 : 8 - dow;
  return new Date(firstOfNextMonth.getFullYear(), firstOfNextMonth.getMonth(), firstOfNextMonth.getDate() + daysToMonday);
}

function getScheduledDates(startDate) {
  // Returns all 26 posting dates (13 weeks × 2)
  const start = parseISO(startDate);
  const dates = [];
  for (let week = 0; week < 13; week++) {
    // Monday: start + 7*week days
    const mon = new Date(start);
    mon.setDate(start.getDate() + week * 7);
    dates.push(toISO(mon));
    // Thursday: start + 7*week + 3 days
    const thu = new Date(mon);
    thu.setDate(mon.getDate() + 3);
    dates.push(toISO(thu));
  }
  return dates;
}

function getWeeks(startDate) {
  // Returns array of 13 weeks, each with { monday, thursday }
  const start = parseISO(startDate);
  const weeks = [];
  for (let w = 0; w < 13; w++) {
    const mon = new Date(start);
    mon.setDate(start.getDate() + w * 7);
    const thu = new Date(mon);
    thu.setDate(mon.getDate() + 3);
    weeks.push({ monday: toISO(mon), thursday: toISO(thu) });
  }
  return weeks;
}

function getTodayISO() {
  return toISO(new Date());
}

function isPostingDay(dateISO) {
  const scheduled = state.startDate ? getScheduledDates(state.startDate) : [];
  return scheduled.includes(dateISO);
}

function isPostDone(dateISO) {
  return !!(state.posts[dateISO]);
}

function getDayStatus(dateISO) {
  // 'done' | 'missed' | 'today' | 'upcoming' | 'future'
  const today = getTodayISO();
  if (isPostDone(dateISO)) return 'done';
  if (dateISO < today) return 'missed';
  if (dateISO === today) return 'today';
  const startDate = state.startDate;
  if (!startDate || dateISO < startDate) return 'future';
  return 'upcoming';
}

// ---- STREAK CALCULATION ----

function calculateStreak() {
  if (!state.startDate) return { current: 0, best: state.streakBest || 0 };
  const today = getTodayISO();
  const weeks = getWeeks(state.startDate);
  let currentStreak = 0;
  let best = state.streakBest || 0;
  let counting = true;

  // Walk weeks in reverse from the most recent completed week
  for (let i = weeks.length - 1; i >= 0; i--) {
    const w = weeks[i];
    // Only count weeks that have fully passed or are current
    const monStatus = getDayStatus(w.monday);
    const thuStatus = getDayStatus(w.thursday);
    // Future week — skip
    if (monStatus === 'future' && thuStatus === 'future') continue;
    // Count this week as a streak week if at least the due days are done
    const monDue = w.monday <= today;
    const thuDue = w.thursday <= today;
    const monOk = monDue ? isPostDone(w.monday) : true;
    const thuOk = thuDue ? isPostDone(w.thursday) : true;
    if (monOk && thuOk && counting) {
      currentStreak++;
    } else {
      counting = false;
    }
  }
  if (currentStreak > best) best = currentStreak;
  return { current: currentStreak, best };
}

function getTotalDone() {
  if (!state.startDate) return 0;
  const scheduled = getScheduledDates(state.startDate);
  return scheduled.filter(d => isPostDone(d)).length;
}

function getThisWeekDates() {
  if (!state.startDate) return { monday: null, thursday: null };
  const today = new Date();
  const todayISO = getTodayISO();
  const weeks = getWeeks(state.startDate);
  // Find the week that contains today
  for (const w of weeks) {
    const monDate = parseISO(w.monday);
    const thuDate = parseISO(w.thursday);
    const weekEnd = new Date(monDate);
    weekEnd.setDate(monDate.getDate() + 6);
    if (today >= monDate && today <= weekEnd) return w;
    // Also handle: we're before the streak starts
  }
  // If today is before start, return week 1
  if (todayISO < state.startDate) return weeks[0];
  // If today is after end, return last week
  return weeks[weeks.length - 1];
}

// ---- UI RENDERING ----

function renderStreakRing(current) {
  const max = 13;
  const fraction = Math.min(current / max, 1);
  const circumference = 2 * Math.PI * 78; // r=78
  const offset = circumference * (1 - fraction);
  const ring = document.getElementById('ring-fill');
  if (ring) ring.style.strokeDashoffset = offset;

  document.getElementById('streak-number').textContent = current;

  // Flame animation
  const flame = document.getElementById('streak-flame');
  if (current === 0) { flame.textContent = '💤'; }
  else if (current < 4) { flame.textContent = '🔥'; }
  else if (current < 8) { flame.textContent = '🔥'; flame.style.fontSize = '1.8rem'; }
  else { flame.textContent = '🏆'; }
}

function renderStats() {
  const done = getTotalDone();
  const left = 26 - done;
  const pct = Math.round((done / 26) * 100);
  const { current, best } = calculateStreak();

  document.getElementById('total-posts').textContent = done;
  document.getElementById('posts-left').textContent = left;
  document.getElementById('completion-pct').textContent = pct + '%';

  renderStreakRing(current);
  state.streakBest = Math.max(best, state.streakBest || 0);
  saveState();

  // Milestone badges
  const badge = document.getElementById('milestone-badge');
  const milestones = [
    { posts: 2,  label: '🌱 First week done!' },
    { posts: 6,  label: '⚡ 3 weeks strong!' },
    { posts: 13, label: '🔥 Halfway there!' },
    { posts: 20, label: '🚀 Almost done!' },
    { posts: 26, label: '🏆 Streak complete!' },
  ];
  const reached = milestones.filter(m => done >= m.posts).pop();
  if (reached && done > 0) {
    badge.style.display = 'block';
    badge.textContent = reached.label;
  } else {
    badge.style.display = 'none';
  }
}

function renderWeekCard() {
  if (!state.startDate) {
    document.getElementById('week-range').textContent = 'Set your start date in settings';
    renderDayRow('monday', null, 'Not started');
    renderDayRow('thursday', null, 'Not started');
    return;
  }
  const week = getThisWeekDates();
  if (!week.monday) return;

  const monDate = parseISO(week.monday);
  const thuDate = parseISO(week.thursday);
  document.getElementById('week-range').textContent =
    formatDate(monDate) + ' — ' + formatDate(thuDate);
  document.getElementById('date-monday').textContent = formatDate(monDate);
  document.getElementById('date-thursday').textContent = formatDate(thuDate);

  renderDayRow('monday', week.monday, null);
  renderDayRow('thursday', week.thursday, null);
}

function renderDayRow(dayKey, dateISO, overrideText) {
  const dot = document.getElementById(`dot-${dayKey}`);
  const actions = document.getElementById(`actions-${dayKey}`);
  const row = document.getElementById(`day-${dayKey}`);

  // Clear classes
  row.classList.remove('done', 'missed', 'today');
  actions.innerHTML = '';

  if (!dateISO || overrideText) {
    return;
  }

  const status = getDayStatus(dateISO);
  const today = getTodayISO();

  if (status === 'done') {
    row.classList.add('done');
    const post = state.posts[dateISO];
    actions.innerHTML = `<span class="btn btn-success">✓ Posted</span>`;
    if (post?.url) {
      actions.innerHTML += `<a href="${post.url}" target="_blank" rel="noopener" class="entry-link">View ↗</a>`;
    }
  } else if (status === 'missed') {
    row.classList.add('missed');
    actions.innerHTML = `<button class="btn btn-ghost btn-sm" onclick="openLogPanel('${dateISO}','${dayKey}')">Log late</button>`;
  } else if (status === 'today') {
    row.classList.add('today');
    actions.innerHTML = `<button class="btn btn-primary btn-sm" onclick="openLogPanel('${dateISO}','${dayKey}')">I posted 🔥</button>`;
  } else if (status === 'upcoming') {
    actions.innerHTML = `<span style="font-size:0.75rem;color:var(--text-3)">Upcoming</span>`;
  } else {
    actions.innerHTML = `<span style="font-size:0.75rem;color:var(--text-3)">Future</span>`;
  }
}

function renderTimeline() {
  const container = document.getElementById('timeline');
  container.innerHTML = '';
  if (!state.startDate) {
    container.innerHTML = '<p style="color:var(--text-3);font-size:0.8rem;grid-column:1/-1">Set your start date to see the timeline</p>';
    return;
  }
  const today = getTodayISO();
  const weeks = getWeeks(state.startDate);
  weeks.forEach((w, i) => {
    const block = document.createElement('div');
    block.className = 'week-block';
    const monStatus = getDayStatus(w.monday);
    const thuStatus = getDayStatus(w.thursday);
    const isCurrent = w.monday <= today && parseISO(w.monday).setDate(parseISO(w.monday).getDate() + 6) >= new Date(today).setHours(0,0,0,0) || (today >= w.monday && today <= w.thursday);
    block.innerHTML = `
      <div class="week-pip ${monStatus === 'future' ? 'future' : monStatus}" title="Monday ${w.monday}"></div>
      <div class="week-pip ${thuStatus === 'future' ? 'future' : thuStatus}" title="Thursday ${w.thursday}"></div>
      <div class="week-label ${isCurrent ? 'current' : ''}">W${i+1}</div>
    `;
    container.appendChild(block);
  });
}

function renderHistory() {
  const container = document.getElementById('post-history');
  const entries = Object.entries(state.posts).sort((a,b) => b[0].localeCompare(a[0]));
  if (entries.length === 0) {
    container.className = 'post-history-empty';
    container.innerHTML = `
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      <p>No posts logged yet. Start your streak!</p>`;
    return;
  }
  container.className = '';
  container.innerHTML = entries.map(([date, post]) => {
    const d = parseISO(date);
    const dayName = d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });
    const loggedAt = post.loggedAt ? new Date(post.loggedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
    return `
    <div class="post-entry">
      <div class="entry-icon">✓</div>
      <div class="entry-info">
        <div class="entry-day">${dayName}</div>
        ${post.url ? `<div class="entry-url">${post.url.replace('https://','')}</div>` : ''}
        <div class="entry-date">Logged ${loggedAt}</div>
      </div>
      ${post.url ? `<a href="${post.url}" target="_blank" rel="noopener" class="entry-link">↗</a>` : ''}
    </div>`;
  }).join('');
}

function renderAll() {
  renderStats();
  renderWeekCard();
  renderTimeline();
  renderHistory();
}

// ---- LOG PANEL ----

let currentLogDate = null;
let currentLogDay = null;

function openLogPanel(dateISO, dayKey) {
  currentLogDate = dateISO;
  currentLogDay = dayKey;
  document.getElementById('post-url-input').value = '';
  document.getElementById('log-error').style.display = 'none';
  document.getElementById('log-panel').style.display = 'flex';
  setTimeout(() => document.getElementById('post-url-input').focus(), 100);
}

function closeLogPanel() {
  document.getElementById('log-panel').style.display = 'none';
  currentLogDate = null;
  currentLogDay = null;
}

function validateLinkedInURL(url) {
  // Accept linkedin.com/posts/ or linkedin.com/feed/update/ or just linkedin.com
  if (!url) return { valid: false, msg: 'Please paste your LinkedIn post URL.' };
  try {
    const u = new URL(url);
    if (!u.hostname.includes('linkedin.com')) {
      return { valid: false, msg: 'URL must be from linkedin.com' };
    }
    // Valid LinkedIn post patterns
    if (
      u.pathname.includes('/posts/') ||
      u.pathname.includes('/feed/update/') ||
      u.pathname.includes('/pulse/') ||
      u.pathname.startsWith('/in/')
    ) {
      return { valid: true };
    }
    // Lenient: any linkedin.com URL is accepted with a warning
    return { valid: true };
  } catch {
    return { valid: false, msg: 'That doesn\'t look like a valid URL. Try: https://www.linkedin.com/posts/...' };
  }
}

document.getElementById('log-submit').addEventListener('click', () => {
  const url = document.getElementById('post-url-input').value.trim();
  const { valid, msg } = validateLinkedInURL(url);
  const errEl = document.getElementById('log-error');
  if (!valid) {
    errEl.style.display = 'block';
    errEl.textContent = msg;
    return;
  }
  errEl.style.display = 'none';
  // Save the post
  state.posts[currentLogDate] = { url, loggedAt: new Date().toISOString() };
  saveState();
  closeLogPanel();
  renderAll();
  showCelebration(currentLogDate);
});

document.getElementById('log-cancel').addEventListener('click', closeLogPanel);

// Close panel when clicking backdrop
document.getElementById('log-panel').addEventListener('click', (e) => {
  if (e.target === document.getElementById('log-panel')) closeLogPanel();
});

// ---- CELEBRATION ----

function showCelebration(dateISO) {
  const { current } = calculateStreak();
  const done = getTotalDone();
  let emoji = '🎉';
  let msg = 'Post logged!';
  let sub = 'Keep the streak alive 🔥';

  if (done === 1)  { emoji = '🌱'; msg = 'First post logged!'; sub = `${25} more to go. You started!`; }
  else if (done === 13) { emoji = '🔥'; msg = 'Halfway there!'; sub = '13 posts down, 13 to go!'; }
  else if (done === 26) { emoji = '🏆'; msg = 'Challenge complete!!'; sub = `All 26 posts done. Legend!`; }
  else if (current >= 4) { emoji = '⚡'; msg = `${current}-week streak!`; sub = 'You're on fire!'; }

  document.getElementById('celebrate-emoji').textContent = emoji;
  document.getElementById('celebrate-msg').textContent = msg;
  document.getElementById('celebrate-sub').textContent = sub;

  const el = document.getElementById('celebrate');
  el.style.display = 'flex';
  setTimeout(() => { el.style.display = 'none'; }, 2500);
}

document.getElementById('celebrate').addEventListener('click', () => {
  document.getElementById('celebrate').style.display = 'none';
});

// ---- SETTINGS ----

document.getElementById('settings-btn').addEventListener('click', () => {
  const modal = document.getElementById('settings-modal');
  document.getElementById('start-date-input').value = state.startDate || toISO(nextMonthFirstMonday());
  document.getElementById('linkedin-profile-input').value = state.linkedinProfile || '';
  document.getElementById('name-input').value = state.name === 'there' ? '' : state.name;
  modal.style.display = 'flex';
});

document.getElementById('settings-close').addEventListener('click', () => {
  document.getElementById('settings-modal').style.display = 'none';
});

document.getElementById('settings-modal').addEventListener('click', (e) => {
  if (e.target === document.getElementById('settings-modal')) {
    document.getElementById('settings-modal').style.display = 'none';
  }
});

document.getElementById('save-settings').addEventListener('click', () => {
  const startVal = document.getElementById('start-date-input').value;
  const profileVal = document.getElementById('linkedin-profile-input').value.trim();
  const nameVal = document.getElementById('name-input').value.trim();

  if (startVal) {
    // Validate it's a Monday
    const d = parseISO(startVal);
    if (d.getDay() !== 1) {
      alert('Start date must be a Monday! The app schedules posts on Mondays and Thursdays.');
      return;
    }
    state.startDate = startVal;
  }
  if (profileVal) state.linkedinProfile = profileVal;
  if (nameVal) state.name = nameVal;
  state.setupDone = true;
  saveState();
  document.getElementById('settings-modal').style.display = 'none';
  renderAll();
});

document.getElementById('reset-btn').addEventListener('click', () => {
  if (confirm('Reset all streak data? This cannot be undone.')) {
    localStorage.removeItem('linkedstreak_v1');
    state = { ...DEFAULT_STATE };
    document.getElementById('settings-modal').style.display = 'none';
    renderAll();
  }
});

// ---- NOTIFICATIONS ----

document.getElementById('notif-btn').addEventListener('click', async () => {
  await requestNotifications();
});

async function requestNotifications() {
  if (!('Notification' in window)) {
    alert('Your browser does not support notifications.');
    return;
  }
  const perm = await Notification.requestPermission();
  state.notifPermission = perm === 'granted';
  saveState();
  if (perm === 'granted') {
    new Notification('LinkedStreak 🔥', {
      body: 'Notifications enabled! You\'ll be reminded to post on Mondays and Thursdays.',
      icon: 'icons/icon-192.png',
    });
    document.getElementById('notif-btn').style.color = 'var(--success)';
    scheduleNotificationCheck();
  }
}

function scheduleNotificationCheck() {
  // Check every hour if a reminder should fire
  checkAndFireNotification();
  setInterval(checkAndFireNotification, 60 * 60 * 1000);
}

function checkAndFireNotification() {
  if (!state.notifPermission || !state.startDate) return;
  const now = new Date();
  const todayISO = getTodayISO();
  const h = now.getHours();
  // Fire between 9-10am on posting days that haven't been logged yet
  if (h === 9 && isPostingDay(todayISO) && !isPostDone(todayISO)) {
    new Notification('Time to post on LinkedIn! 🔥', {
      body: `Today is a posting day${state.name !== 'there' ? ', ' + state.name : ''}! Keep your streak alive.`,
      icon: 'icons/icon-192.png',
    });
  }
  // Evening reminder at 7pm if still not posted
  if (h === 19 && isPostingDay(todayISO) && !isPostDone(todayISO)) {
    new Notification('Don\'t break your streak! ⏰', {
      body: 'You haven\'t logged today\'s LinkedIn post yet. You still have time!',
      icon: 'icons/icon-192.png',
      tag: 'evening-reminder',
    });
  }
}

// ---- SERVICE WORKER REGISTRATION ----

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js')
      .then(reg => console.log('SW registered:', reg.scope))
      .catch(err => console.warn('SW registration failed:', err));
  });
}

// ---- INSTALL PROMPT ----

let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  // Show a subtle install banner after 3 seconds if not setup
  setTimeout(() => {
    if (!state.setupDone) showInstallHint();
  }, 3000);
});

function showInstallHint() {
  const banner = document.createElement('div');
  banner.className = 'notif-banner';
  banner.style.marginBottom = '0';
  banner.innerHTML = `
    <p><strong>Install LinkedStreak</strong><br>Add it to your home screen for the best experience — works offline too.</p>
    <button class="btn btn-primary btn-sm" id="install-btn">Install</button>
  `;
  document.querySelector('.main').insertBefore(banner, document.querySelector('.main').firstChild);
  document.getElementById('install-btn').addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;
    if (outcome === 'accepted') banner.remove();
    deferredInstallPrompt = null;
  });
}

// ---- FIRST-TIME SETUP ----

function checkFirstRun() {
  if (!state.startDate) {
    // Default start date to next month's first Monday
    state.startDate = toISO(nextMonthFirstMonday());
    saveState();
    // Open settings on first load after a brief delay
    setTimeout(() => {
      document.getElementById('settings-btn').click();
    }, 800);
  }
  if (state.notifPermission) {
    document.getElementById('notif-btn').style.color = 'var(--success)';
    scheduleNotificationCheck();
  }
}

// ---- INIT ----

function init() {
  // Inject SVG gradient defs into the document
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  defs.innerHTML = `
    <defs>
      <linearGradient id="ringGradient" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="#0077B5"/>
        <stop offset="100%" stop-color="#00A8E8"/>
      </linearGradient>
    </defs>`;
  defs.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
  document.body.appendChild(defs);

  checkFirstRun();
  renderAll();
}

document.addEventListener('DOMContentLoaded', init);
