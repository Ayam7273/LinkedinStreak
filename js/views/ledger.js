// Ledger: every weekend since the start date, newest first.
import { getState, subscribe, derived, deletePost } from '../state.js';
import { formatWeekendRange, formatDay, formatInstant, weekdayName, londonDate, weekendFriday } from '../time.js';
import { dayCell } from './today.js';
import { sheet } from '../ui/sheet.js';
import { toast } from '../ui/toast.js';
import { icon, stateMark } from '../ui/icons.js';
import { esc } from '../ui/dom.js';

function legend() {
  const items = [
    ['complete', 'Logged'],
    ['open', 'Due'],
    ['grace', 'Grace'],
    ['missed', 'Missed'],
    ['upcoming', 'Upcoming'],
  ];
  return `<div class="ledger-legend" aria-hidden="true">${items
    .map(([st, t]) => `<span class="legend legend--${st}">${stateMark(st)}${t}</span>`)
    .join('')}</div>`;
}

function openDetail(post) {
  sheet({
    title: `${weekdayName(post.required_day)} ${formatDay(post.required_day, { weekday: false, year: true })}`,
    body(el, api) {
      const draw = (confirming = false) => {
        el.innerHTML = `
          <div class="stack">
            <dl class="dl">
              <dt>Published</dt><dd>${esc(formatInstant(post.published_at))}</dd>
              <dt>Logged</dt><dd>${esc(formatInstant(post.logged_at))}</dd>
              <dt>Author</dt><dd>${post.author_status === 'verified' ? 'Verified' : '<span class="aside">Unconfirmed</span>'}</dd>
              ${post.note ? `<dt>Note</dt><dd class="aside">${esc(post.note)}</dd>` : ''}
            </dl>
            <a class="btn btn--block" href="${esc(post.url_canonical)}" target="_blank" rel="noopener noreferrer">Open on LinkedIn ${icon('external', { size: 'sm' })}</a>
            ${confirming
              ? `<div class="note stack-sm" role="alert">
                   <p>Remove this entry? If the grace window for this day has closed, it will count as missed.</p>
                   <div class="row">
                     <button type="button" class="btn" data-cancel>Keep it</button>
                     <button type="button" class="btn btn--danger" data-confirm>Remove</button>
                   </div>
                 </div>`
              : '<button type="button" class="btn btn--text" data-remove>Remove entry</button>'}
          </div>`;
        el.querySelector('[data-remove]')?.addEventListener('click', () => {
          draw(true);
          el.querySelector('[data-cancel]').focus();
        });
        el.querySelector('[data-cancel]')?.addEventListener('click', () => draw(false));
        el.querySelector('[data-confirm]')?.addEventListener('click', async (e) => {
          e.currentTarget.disabled = true;
          e.currentTarget.textContent = 'Removing…';
          try {
            await deletePost(post.id);
            api.close();
            toast('Entry removed.');
          } catch (err) {
            draw(true);
            el.insertAdjacentHTML('beforeend', `<p class="field__error">${esc(err.message || 'Could not remove it.')}</p>`);
          }
        });
      };
      draw();
    },
  });
}

function view(root) {
  const s = getState();
  if (s.status !== 'ready' || !s.settings) {
    root.innerHTML = `<h1 class="view-title">Ledger</h1><div aria-busy="true"><span class="skeleton"></span><span class="skeleton"></span><span class="skeleton"></span><span class="skeleton skeleton--short"></span></div>`;
    return;
  }
  const sum = derived();
  const start = s.settings.start_date;
  const firstFriday = start ? weekendFriday(start) : sum.focus;
  const today = londonDate(Date.now());
  const thisYear = today.slice(0, 4);

  const rows = sum.weekends
    .filter((w) => w.friday >= firstFriday && w.days.some((d) => d.state !== 'before-start'))
    .reverse();

  const rate = sum.completionRate === null ? '—' : `${Math.round(sum.completionRate * 100)}%`;

  root.innerHTML = `
    <h1 class="view-title">Ledger</h1>
    <section class="section">
      <div class="ledger-summary">
        <div><span class="label">Started</span><span class="stat__value">${start ? formatDay(start, { weekday: false, year: start.slice(0, 4) !== thisYear }) : '—'}</span></div>
        <div><span class="label">Longest</span><span class="stat__value numeral">${sum.best}</span></div>
        <div><span class="label">Rate</span><span class="stat__value numeral">${rate}</span></div>
      </div>
    </section>
    <section class="section stack" aria-label="Weekends">
      ${legend()}
      ${rows.length
        ? `<ol>${rows
            .map((w) => {
              const yr = w.friday.slice(0, 4);
              const label = formatWeekendRange(w.friday) + (yr !== thisYear ? ` ${yr}` : '');
              const current = w.friday === sum.focus;
              return `<li class="ledger-row${current ? ' ledger-row--current' : ''}">
                <span class="ledger-row__label">${esc(label)}${current ? '<span class="visually-hidden"> (this weekend)</span>' : ''}</span>
                <div class="weekend">${w.days.map((d) => dayCell(d, { compact: true, interactive: true })).join('')}</div>
              </li>`;
            })
            .join('')}</ol>`
        : `<p class="aside">Nothing yet. The first required day is ${start ? `${weekdayName(start)} ${formatDay(start, { weekday: false })}` : 'this Friday'}.</p>`}
    </section>`;

  root.querySelectorAll('[data-post]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const post = getState().posts.find((p) => p.id === btn.dataset.post);
      if (post) openDetail(post);
    });
  });
}

export function mount(root) {
  view(root);
  return subscribe(() => view(root));
}
