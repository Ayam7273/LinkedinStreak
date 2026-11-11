// Stroke icons from Lucide (https://lucide.dev, ISC licence), inlined.
// Plus the app's own state marks (stamp, open frame, missed stroke).

const paths = {
  today:
    '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="m9 16 2 2 4-4"/>',
  ledger:
    '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
  settings:
    '<line x1="21" x2="14" y1="4" y2="4"/><line x1="10" x2="3" y1="4" y2="4"/><line x1="21" x2="12" y1="12" y2="12"/><line x1="8" x2="3" y1="12" y2="12"/><line x1="21" x2="16" y1="20" y2="20"/><line x1="12" x2="3" y1="20" y2="20"/><line x1="14" x2="14" y1="2" y2="6"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="16" x2="16" y1="18" y2="22"/>',
  close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  external: '<path d="M7 7h10v10"/><path d="M7 17 17 7"/>',
  paste:
    '<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>',
  share:
    '<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" x2="12" y1="2" y2="15"/>',
  addSquare: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M8 12h8"/><path d="M12 8v8"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  arrowRight: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
};

export function icon(name, { size = '', label = '', cls = '' } = {}) {
  const a11y = label ? `role="img" aria-label="${label}"` : 'aria-hidden="true" focusable="false"';
  const classes = ['icon', size && `icon--${size}`, cls].filter(Boolean).join(' ');
  return `<svg class="${classes}" viewBox="0 0 24 24" ${a11y}>${paths[name] || ''}</svg>`;
}

/** Ink stamp: filled disc, inner ring, drawn tick. */
export function stampMark() {
  return `<svg class="stamp" viewBox="0 0 40 40" aria-hidden="true" focusable="false">
    <circle class="stamp__disc" cx="20" cy="20" r="18"/>
    <circle class="stamp__ring" cx="20" cy="20" r="14.5" style="stroke: var(--paper)"/>
    <path class="stamp__tick" d="M13.5 20.5l4.5 4.5 8.5-9.5"/>
  </svg>`;
}

/** Mark for each day state. Every state also gets a text label elsewhere. */
export function stateMark(state) {
  switch (state) {
    case 'complete':
      return stampMark();
    case 'open':
      return `<svg class="stamp" viewBox="0 0 40 40" aria-hidden="true" focusable="false"><circle class="mark-open" cx="20" cy="20" r="17"/></svg>`;
    case 'grace':
      return `<svg class="stamp" viewBox="0 0 40 40" aria-hidden="true" focusable="false"><circle class="mark-grace" cx="20" cy="20" r="17"/></svg>`;
    case 'missed':
      return `<svg class="stamp" viewBox="0 0 40 40" aria-hidden="true" focusable="false"><path class="mark-missed" d="M10 30 30 10"/></svg>`;
    default:
      return `<svg class="stamp" viewBox="0 0 40 40" aria-hidden="true" focusable="false"><path class="mark-upcoming" d="M14 20h12"/></svg>`;
  }
}
