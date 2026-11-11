// Quiet toasts in an aria-live region.

let region;

function ensureRegion() {
  if (region) return region;
  region = document.getElementById('toasts');
  if (!region) {
    region = document.createElement('div');
    region.id = 'toasts';
    region.className = 'toasts';
    region.setAttribute('role', 'status');
    region.setAttribute('aria-live', 'polite');
    document.body.appendChild(region);
  }
  return region;
}

/**
 * toast('Logged. 13 days.')
 * toast('Update available', { action: { label: 'Reload', onClick }, duration: 0 })
 */
export function toast(message, { action = null, duration = 4000 } = {}) {
  const root = ensureRegion();
  const el = document.createElement('div');
  el.className = 'toast';
  const text = document.createElement('span');
  text.textContent = message;
  el.appendChild(text);

  let timer;
  const dismiss = () => {
    clearTimeout(timer);
    el.remove();
  };

  if (action) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn toast__action';
    btn.textContent = action.label;
    btn.addEventListener('click', () => {
      dismiss();
      action.onClick?.();
    });
    el.appendChild(btn);
  }

  root.appendChild(el);
  if (duration > 0) timer = setTimeout(dismiss, duration);
  return dismiss;
}
