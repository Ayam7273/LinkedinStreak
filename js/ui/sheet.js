// Bottom sheet: focus trap, Esc, scrim tap and swipe-down to close.

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

let openSheet = null;

export function isSheetOpen() {
  return !!openSheet;
}

export function closeSheet() {
  openSheet?.close();
}

/**
 * openSheetWith({ title, body: (panelBody, api) => cleanup?, onClose, label })
 * Returns { close, el, setTitle }.
 */
export function sheet({ title, body, onClose, initialFocus }) {
  openSheet?.close({ silent: true });

  const previouslyFocused = document.activeElement;
  const root = document.createElement('div');
  root.className = 'sheet';
  root.innerHTML = `
    <div class="sheet__scrim" data-close></div>
    <section class="sheet__panel" role="dialog" aria-modal="true" aria-labelledby="sheet-title" tabindex="-1">
      <span class="sheet__grip" aria-hidden="true"></span>
      <header class="sheet__head">
        <h2 class="sheet__title" id="sheet-title"></h2>
        <button type="button" class="btn btn--icon" data-close aria-label="Close">
          <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
        </button>
      </header>
      <div class="sheet__body"></div>
    </section>`;
  const panel = root.querySelector('.sheet__panel');
  const titleEl = root.querySelector('.sheet__title');
  const bodyEl = root.querySelector('.sheet__body');
  titleEl.textContent = title || '';

  // Make the rest of the app inert while open.
  const app = document.getElementById('app');
  app?.setAttribute('inert', '');
  document.body.appendChild(root);

  let cleanup = null;
  let closed = false;

  const api = {
    el: bodyEl,
    setTitle: (t) => (titleEl.textContent = t),
    close: ({ silent = false } = {}) => {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKey, true);
      root.classList.remove('is-open');
      app?.removeAttribute('inert');
      const finish = () => root.remove();
      const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduce) finish();
      else setTimeout(finish, 300);
      if (typeof cleanup === 'function') cleanup();
      if (openSheet === api) openSheet = null;
      if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus?.();
      if (!silent) onClose?.();
    },
  };

  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) api.close();
  });

  function onKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      api.close();
      return;
    }
    if (e.key !== 'Tab') return;
    const items = [...panel.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
  document.addEventListener('keydown', onKey, true);

  // Swipe down to close (from the grip/header, or anywhere when scrolled to top).
  let startY = null;
  let dy = 0;
  panel.addEventListener(
    'touchstart',
    (e) => {
      if (panel.scrollTop > 0) return;
      if (e.target.closest('input, textarea, select')) return;
      startY = e.touches[0].clientY;
      dy = 0;
    },
    { passive: true },
  );
  panel.addEventListener(
    'touchmove',
    (e) => {
      if (startY === null) return;
      dy = Math.max(0, e.touches[0].clientY - startY);
      if (dy > 4) {
        root.classList.add('is-dragging');
        panel.style.setProperty('--sheet-drag', `${dy}px`);
      }
    },
    { passive: true },
  );
  panel.addEventListener('touchend', () => {
    if (startY === null) return;
    root.classList.remove('is-dragging');
    panel.style.removeProperty('--sheet-drag');
    if (dy > 90) api.close();
    startY = null;
  });

  cleanup = body?.(bodyEl, api) || null;
  openSheet = api;

  requestAnimationFrame(() => {
    root.classList.add('is-open');
    const target = (initialFocus && bodyEl.querySelector(initialFocus)) || panel;
    target.focus({ preventScroll: true });
  });

  return api;
}
