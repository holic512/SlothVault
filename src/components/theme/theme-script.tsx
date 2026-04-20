const script = `
(() => {
  try {
    const theme = localStorage.getItem('theme-storage');
    const locale = localStorage.getItem('locale-storage');
    const html = document.documentElement;
    const parsedTheme = theme ? JSON.parse(theme) : null;
    const state = parsedTheme?.state || {};
    const mode = state.theme || 'dark';
    const palette = state.palette || 'purple';
    html.classList.toggle('dark', mode === 'dark');
    ['purple','cyan','emerald','rose'].forEach((name) => html.classList.remove('theme-' + name));
    html.classList.add('theme-' + palette);
    if (locale) {
      const parsedLocale = JSON.parse(locale);
      if (parsedLocale?.state?.locale) {
        html.lang = parsedLocale.state.locale;
      }
    }
  } catch (error) {
    console.warn('theme bootstrap failed', error);
  }
})();
`

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: script }} />
}
