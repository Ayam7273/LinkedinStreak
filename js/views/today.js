// Today: the streak numeral, secondary stats, this weekend, one action.
import { getState, subscribe, derived, consumeStamp } from '../state.js';
import { londonDate, weekdayName, formatDay, formatTime, daysBetween, nextRequiredDay, isRequiredDay, formatWeekendRange } from '../time.js';
import { stateMark } from '../ui/icons.js';
import { esc, reducedMotion } from '../ui/dom.js';

const STATUS = {
  complete: (d) => `Logged ${formatTime(d.post.logged_at || d.post.published_at)}`,
  open: () => 'Due today',
  grace: () => 'Log by 12:00',
  missed: () => 'Missed',
  upcoming: () => 'Upcoming',
  'before-start': () => 'Before start',
};

export function dayCell(d, { compact = false, interactive = false } = {}) {
  const name = weekdayName(d.date, true);
  const tag = interactive && d.state === 'complete' ? 'button' : 'div';
  const attrs = tag === 'button' ? ` type="button" data-post="${esc(d.post.id)}"` : '';
  const status = STATUS[d.state](d);
  return `<${tag} class="day day--${d.state}${compact ? ' day--compact' : ''}" data-day="${d.date}"${attrs}>
    <span class="day__name" aria-hidden="true">${name}</span>
    <span class="day__date" aria-hidden="true">${formatDay(d.date, { weekday: false })}</span>
    <span class="day__mark">${stateMark(d.state)}</span>
    ${compact ? '' : `<span class="day__status" aria-hidden="true">${esc(status)}</span>`}
    <span class="visually-hidden">${weekdayName(d.date)} ${formatDay(d.date, { weekday: false })}: ${esc(status)}</span>
  </${tag}>`;
}

function skeleton() {
  return `<div class="stack-lg" aria-busy="true" aria-label="Loading">
    <div><span class="label">Current streak</span><span class="skeleton skeleton--hero"></span></div>
    <div><span class="skeleton"></span><span class="skeleton skeleton--short"></span></div>
    <div><span class="skeleton"></span><span class="skeleton"></span><span class="skeleton skeleton--short"></span></div>
  </div>`;
}

function action(sum, settings, now) {
  const today = londonDate(now);
  const todayDay = sum.days.find((d) => d.date === today);
  const grace = sum.days.find((d) => d.state === 'grace');
  const start = settings?.start_date;

  if (start && today < start && !grace) {
    const n = daysBetween(today, start);
    return `<p class="quiet-line">Your streak starts ${weekdayName(start)} ${formatDay(start, { weekday: false })} · ${n === 1 ? 'tomorrow' : `${n} days`}</p>`;
  }

  if (grace && todayDay?.state === 'open') {
    return `<a class="btn btn--primary" href="#/log">Log a post</a>
      <p class="field__help">${weekdayName(grace.date)} can still be logged until 12:00.</p>`;
  }
  if (grace) {
    return `<a class="btn btn--primary" href="#/log">Log ${weekdayName(grace.date)}'s post</a>
      <p class="field__help">Logging for ${weekdayName(grace.date)} closes at 12:00 today.</p>`;
  }
  if (todayDay?.state === 'open') {
    return `<a class="btn btn--primary" href="#/log">Log today's post</a>`;
  }
  if (todayDay?.state === 'complete') {
    const next = nextRequiredDay(today);
    const when = daysBetween(today, next) === 1 ? 'tomorrow' : weekdayName(next);
    return `<p class="quiet-line">${weekdayName(today)} is done. See you ${when}.</p>`;
  }
  if (!isRequiredDay(today)) {
    const next = nextRequiredDay(today);
    const n = daysBetween(today, next);
    return `<p class="quiet-line">Next post due ${weekdayName(next)} · ${n === 1 ? 'tomorrow' : `${n} days`}</p>`;
  }
  return '';
}

function view(root) {
  const s = getState();
  if (s.status !== 'ready' || !s.settings) {
    root.innerHTML = s.status === 'error'
      ? `<p class="aside">Couldn't load your ledger. ${esc(s.error?.message || '')}</p>`
      : skeleton();
    return;
  }

  const now = Date.now();
  const sum = derived(now);
  const weekend = sum.weekends.find((w) => w.friday === sum.focus);
  const stamp = consumeStamp();
  const shownNumber = stamp && !reducedMotion() ? stamp.from : sum.current;

  const needsProfile = !s.settings.profile_slug;

  root.innerHTML = `
    <h1 class="visually-hidden">Today</h1>
    <section class="section" aria-labelledby="streak-label">
      <div class="hero">
        <span class="label" id="streak-label">Current streak</span>
        <span class="hero__num numeral" data-num aria-describedby="streak-caption">${shownNumber}</span>
        <span class="hero__mark" aria-hidden="true"><span class="hero__rule"></span></span>
        <p class="hero__caption aside" id="streak-caption">${sum.current === 1 ? 'day' : 'days'} in a row · best ${sum.best}</p>
      </div>
    </section>

    <section class="section split" aria-label="Totals">
      <div><span class="label">Full weekends</span><span class="stat__value numeral">${sum.fullWeekends}</span></div>
      <div><span class="label">Total posts</span><span class="stat__value numeral">${sum.totalPosts}</span></div>
    </section>

    <section class="section" aria-labelledby="weekend-label">
      <div class="section__head">
        <h2 class="label" id="weekend-label">This weekend</h2>
        <span class="aside meta">${formatWeekendRange(sum.focus)}</span>
      </div>
      <div class="weekend">${weekend.days.map((d) => dayCell(d)).join('')}</div>
    </section>

    <section class="section stack">
      ${needsProfile ? `<p class="note">Add your LinkedIn profile link in <a href="#/settings">Settings</a> so the app can tell your posts from anyone else's.</p>` : ''}
      ${action(sum, s.settings, now)}
    </section>`;

  if (stamp && !reducedMotion()) {
    const mark = root.querySelector(`[data-day="${stamp.day}"] .day__mark`);
    mark?.classList.add('is-stamping');
    const num = root.querySelector('[data-num]');
    setTimeout(() => {
      num.textContent = String(sum.current);
      num.classList.add('is-ticking');
    }, 260);
  }
}

export function mount(root) {
  view(root);
  return subscribe(() => view(root));
}
