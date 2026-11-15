// History: 52-week heatmap of logged posts + post log with a goal filter.
import { getState, summaryFor, goalById, profileTz, profileToday, weekStart, removePost } from '../state.js';
import { addDays, weekStartOf, dateIn, formatDay, formatInstant, weekdayName, monthName } from '../core/time.js';
import { icon } from '../ui/icons.js';
import { esc, plural, busy } from '../ui/dom.js';
import { sheet } from '../ui/sheet.js';
import { toast } from '../ui/toast.js';

let filter = 'all';

export function render(root, { navigate }) {
  const s = getState();
  if (filter !== 'all' && !goalById(filter)) filter = 'all';
  const tz = profileTz();
  const posts = s.posts.filter((p) => filter === 'all' || p.goal_id === filter);

  root.innerHTML = `
    <div class="view">
      <div class="view-head">
        <h1>History</h1>
        ${
          s.goals.length > 1
            ? `<div class="field"><label class="visually-hidden" for="goal-filter">Filter by goal</label>
                <select class="select" id="goal-filter">
                  <option value="all">All goals</option>
                  ${s.goals.map((g) => `<option value="${g.id}" ${filter === g.id ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}
                </select></div>`
            : ''
        }
      </div>
      <section class="card" aria-labelledby="heat-title">
        <div class="card__head">
          <h2 class="card__title" id="heat-title">${plural(posts.length, 'post')} logged</h2>
          <span class="small muted">Last 12 months</span>
        </div>
        ${heatmap(posts, tz)}
      </section>
      <section class="card card--flush" aria-labelledby="log-title">
        <div class="card__head card__head--pad">
          <h2 class="card__title" id="log-title">Post log</h2>
        </div>
        ${posts.length ? table(posts, tz) : empty()}
      </section>
    </div>`;

  const scroller = root.querySelector('.heat-scroll');
  if (scroller) scroller.scrollLeft = scroller.scrollWidth; // show the most recent weeks first

  root.querySelector('#goal-filter')?.addEventListener('change', (e) => {
    filter = e.target.value;
    render(root, { navigate });
  });
  root.querySelectorAll('tr[data-post]').forEach((tr) => {
    const open = () => openPost(s.posts.find((p) => p.id === tr.dataset.post), tz);
    tr.addEventListener('click', (e) => {
      if (e.target.closest('a')) return;
      open();
    });
  });
  root.querySelectorAll('[data-open-post]').forEach((b) =>
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      openPost(s.posts.find((p) => p.id === b.dataset.openPost), tz);
    }),
  );
  root.querySelector('[data-log]')?.addEventListener('click', () => navigate('log'));
}

function missedDays() {
  const s = getState();
  const out = new Set();
  for (const g of s.goals) {
    if (filter !== 'all' && g.id !== filter) continue;
    if (g.mode !== 'days') continue;
    const sum = summaryFor(g);
    for (const u of sum?.units || []) if (u.state === 'missed') out.add(u.key);
  }
  return out;
}

function heatmap(posts, tz) {
  const ws = weekStart();
  const today = profileToday();
  const first = addDays(weekStartOf(today, ws), -52 * 7);
  const counts = new Map();
  for (const p of posts) {
    const d = dateIn(p.published_at, tz);
    counts.set(d, (counts.get(d) || 0) + 1);
  }
  const missed = missedDays();
  const level = (n) => (n <= 0 ? 0 : n === 1 ? 2 : n === 2 ? 3 : 4);

  const cells = [];
  const months = [];
  for (let w = 0; w < 53; w++) {
    const colStart = addDays(first, w * 7);
    let label = '';
    for (let i = 0; i < 7; i++) {
      const date = addDays(colStart, i);
      if (date.endsWith('-01') && date <= today) label = monthName(Number(date.slice(5, 7)));
    }
    if (w === 0 && !label) label = '';
    months.push(`<span>${label}</span>`);
    for (let i = 0; i < 7; i++) {
      const date = addDays(colStart, i);
      if (date > today) {
        cells.push('<span class="heat__cell is-empty" aria-hidden="true"></span>');
        continue;
      }
      const n = counts.get(date) || 0;
      const isMissed = missed.has(date);
      const text = `${weekdayName(date)} ${formatDay(date, { weekday: false, year: true })}: ${n ? plural(n, 'post') : 'no posts'}${isMissed ? ', missed posting day' : ''}`;
      cells.push(`<span class="heat__cell ${isMissed ? 'is-missed' : ''}" data-level="${level(n)}" role="img" aria-label="${esc(text)}" title="${esc(text)}"></span>`);
    }
  }

  return `
    <div class="heat-scroll" tabindex="0" aria-label="Posting activity, scrollable">
      <div class="heat__months" aria-hidden="true">${months.join('')}</div>
      <div class="heat" role="group" aria-label="Posts per day, last 12 months">${cells.join('')}</div>
    </div>
    <div class="legend">
      <span>Less</span>
      <span class="legend__scale" aria-hidden="true">${[0, 1, 2, 3, 4].map((l) => `<span class="heat__cell" data-level="${l}"></span>`).join('')}</span>
      <span>More</span>
      <span class="legend__scale" aria-hidden="true"><span class="heat__cell is-missed"></span></span>
      <span>Missed posting day</span>
    </div>`;
}

function authorChip(status) {
  return status === 'verified'
    ? `<span class="chip chip--complete">${icon('shield')}Verified</span>`
    : `<span class="chip chip--paused">${icon('info')}Unconfirmed</span>`;
}

function table(posts, tz) {
  return `
    <div class="table-wrap">
      <table class="table">
        <thead><tr><th scope="col">Published</th><th scope="col" class="hide-sm">Goal</th><th scope="col">Author</th><th scope="col">Post</th><th scope="col" class="hide-sm">Note</th></tr></thead>
        <tbody>
          ${posts
            .map((p) => {
              const g = p.goal_id ? goalById(p.goal_id) : null;
              return `<tr data-post="${p.id}">
                <td><button type="button" class="link-btn tabular" data-open-post="${p.id}">${esc(formatInstant(p.published_at, tz))}</button></td>
                <td class="hide-sm">${g ? esc(g.name) : '<span class="faint">No goal</span>'}</td>
                <td>${authorChip(p.author_status)}</td>
                <td><a class="link" href="${esc(p.url_canonical)}" target="_blank" rel="noopener noreferrer">Open${icon('external', { size: 'sm' })}<span class="visually-hidden"> on LinkedIn (opens in a new tab)</span></a></td>
                <td class="table__note hide-sm">${p.note ? esc(p.note) : '<span class="faint">—</span>'}</td>
              </tr>`;
            })
            .join('')}
        </tbody>
      </table>
    </div>`;
}

function empty() {
  return `<div class="empty">${icon('history')}<p>No posts logged yet. Your first one will show up here.</p>
    <button type="button" class="btn btn--primary" data-log>${icon('plus')}Log a post</button></div>`;
}

function openPost(post, tz) {
  if (!post) return;
  const g = post.goal_id ? goalById(post.goal_id) : null;
  sheet({
    title: 'Post details',
    body: (el, api) => {
      const show = () => {
        el.innerHTML = `
          <dl class="dl">
            <dt>Published</dt><dd>${esc(formatInstant(post.published_at, tz))}</dd>
            <dt>Logged</dt><dd>${esc(formatInstant(post.logged_at, tz))}</dd>
            <dt>Goal</dt><dd>${g ? esc(g.name) : 'No goal'}</dd>
            <dt>Author</dt><dd>${authorChip(post.author_status)}</dd>
            ${post.note ? `<dt>Note</dt><dd>${esc(post.note)}</dd>` : ''}
          </dl>
          <div class="sheet__foot">
            <button type="button" class="btn btn--danger" data-remove>${icon('trash')}Remove entry</button>
            <a class="btn btn--primary" href="${esc(post.url_canonical)}" target="_blank" rel="noopener noreferrer">Open post${icon('external')}</a>
          </div>`;
        el.querySelector('[data-remove]').addEventListener('click', confirm);
      };
      const confirm = () => {
        el.innerHTML = `
          <div class="notice notice--danger">${icon('alert')}<div>Remove this entry? Your streak is recalculated without it, and you can log the post again later if it's still within the grace period.</div></div>
          <div class="sheet__foot">
            <button type="button" class="btn" data-keep>Keep it</button>
            <button type="button" class="btn btn--danger-solid" data-yes>${icon('trash')}Remove</button>
          </div>`;
        el.querySelector('[data-keep]').addEventListener('click', show);
        el.querySelector('[data-yes]').addEventListener('click', async (e) => {
          const restore = busy(e.currentTarget, 'Removing…');
          const r = await removePost(post.id);
          if (!r.ok) {
            restore();
            toast(r.message);
            return;
          }
          api.close({ silent: true });
          toast('Entry removed');
        });
        el.querySelector('[data-keep]').focus();
      };
      show();
      return null;
    },
  });
}
