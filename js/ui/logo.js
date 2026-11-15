// Single source for rendering the logo. Swap the file here and it changes everywhere.
// The file is the artwork imported by scripts/import-logo.mjs, untouched: never recolour, redraw or stretch it.

export const LOGO_SRC = '/assets/logo.svg';
export const LOGO_MARK_SRC = '/assets/logo-mark.svg';

/**
 * logo({ size: 'md' | 'lg', mark: false, decorative: false }) -> <img> markup.
 * Square, so width = height and the aspect ratio never changes.
 */
export function logo({ size = 'md', mark = false, decorative = false } = {}) {
  const px = size === 'lg' ? 52 : 32;
  const cls = size === 'lg' ? 'logo logo--lg' : 'logo';
  const alt = decorative ? '' : 'LinkedInStreak';
  return `<img class="${cls}" src="${mark ? LOGO_MARK_SRC : LOGO_SRC}" width="${px}" height="${px}" alt="${alt}" decoding="async">`;
}

/** Logo plus the product name, for app bars and nav. */
export function brand({ href = '/app.html#/today', size = 'md' } = {}) {
  return `<a class="brand" href="${href}" aria-label="LinkedInStreak home">${logo({ size, decorative: true })}<span>LinkedInStreak</span></a>`;
}

/** Fill any [data-logo] / [data-brand] placeholders on static pages. */
export function mountLogos(root = document) {
  root.querySelectorAll('[data-logo]').forEach((el) => {
    el.outerHTML = logo({ size: el.dataset.logo || 'md', decorative: el.hasAttribute('data-decorative') });
  });
  root.querySelectorAll('[data-brand]').forEach((el) => {
    el.outerHTML = brand({ href: el.dataset.brand || '/' });
  });
}

if (typeof document !== 'undefined' && document.querySelector('[data-logo], [data-brand]')) {
  mountLogos();
}
