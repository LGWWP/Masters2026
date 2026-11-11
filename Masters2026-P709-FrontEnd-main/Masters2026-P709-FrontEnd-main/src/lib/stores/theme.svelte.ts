// Theme store: 'light' | 'dark' | 'auto' (follows the OS/browser preference).
// The resolved theme is written to <html data-theme="..."> and styled in app.css.
// Do NOT destructure `theme` — read `theme.mode` directly to keep reactivity.

export type ThemeMode = 'light' | 'dark' | 'auto';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'theme-mode';
const DEFAULT_MODE: ThemeMode = 'dark';

const media =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: light)')
    : null;

function readStoredMode(): ThemeMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'light' || v === 'dark' || v === 'auto') return v;
  } catch {
    // localStorage can be unavailable (privacy mode / embedded webview)
  }
  return DEFAULT_MODE;
}

export const theme = $state<{ mode: ThemeMode; systemLight: boolean }>({
  mode: readStoredMode(),
  systemLight: media?.matches ?? false
});

export function resolvedTheme(): ResolvedTheme {
  if (theme.mode === 'auto') return theme.systemLight ? 'light' : 'dark';
  return theme.mode;
}

function apply(): void {
  document.documentElement.dataset.theme = resolvedTheme();
}

export function setThemeMode(mode: ThemeMode): void {
  theme.mode = mode;
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // non-fatal: the choice just won't persist
  }
  apply();
}

// Call once before mounting the app.
export function initTheme(): void {
  apply();
  media?.addEventListener('change', (e) => {
    theme.systemLight = e.matches;
    apply();
  });
}

// Light-level colors must be hex (callers append alpha like `${color}66`),
// so they live here instead of in CSS variables.
const LEVEL_COLORS: Record<ResolvedTheme, [off: string, low: string, mid: string, high: string]> = {
  dark: ['#aac4ff', '#7c3aed', '#f59e0b', '#ffe066'],
  light: ['#64748b', '#7c3aed', '#d97706', '#eab308']
};

export function levelColor(level: number): string {
  const [off, low, mid, high] = LEVEL_COLORS[resolvedTheme()];
  if (level < 1) return off;
  if (level < 30) return low;
  if (level < 70) return mid;
  return high;
}
