// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { I18nProvider, useI18n } from './i18n.js';

function LanguageProbe() {
  const { t, lang, dir, setLang } = useI18n();
  return (
    <div>
      <span data-testid="lang">{lang}</span>
      <span data-testid="dir">{dir}</span>
      <span data-testid="dashboard">{t('dashboard')}</span>
      <span data-testid="missing">{t('not_a_real_key')}</span>
      <button onClick={() => setLang(lang === 'en' ? 'ar' : 'en')}>Toggle language</button>
    </div>
  );
}

describe('I18nProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.dir = '';
    document.documentElement.lang = '';
  });

  it('defaults to English, sets ltr, and translates known keys', () => {
    render(<I18nProvider><LanguageProbe /></I18nProvider>);

    expect(screen.getByTestId('lang')).toHaveTextContent('en');
    expect(screen.getByTestId('dir')).toHaveTextContent('ltr');
    expect(screen.getByTestId('dashboard')).toHaveTextContent('Dashboard');
    expect(screen.getByTestId('missing')).toHaveTextContent('not_a_real_key');
    expect(document.documentElement.dir).toBe('ltr');
    expect(document.documentElement.lang).toBe('en');
  });

  it('switches to Arabic with rtl direction and persists the choice', async () => {
    const user = userEvent.setup();
    render(<I18nProvider><LanguageProbe /></I18nProvider>);

    await user.click(screen.getByRole('button', { name: 'Toggle language' }));

    expect(screen.getByTestId('lang')).toHaveTextContent('ar');
    expect(screen.getByTestId('dir')).toHaveTextContent('rtl');
    expect(screen.getByTestId('dashboard')).toHaveTextContent('لوحة التحكم');
    expect(document.documentElement.dir).toBe('rtl');
    expect(document.documentElement.lang).toBe('ar');
    expect(localStorage.getItem('saha-lang')).toBe('ar');
  });

  it('restores a saved Arabic preference and can switch back to ltr', async () => {
    localStorage.setItem('saha-lang', 'ar');
    const user = userEvent.setup();
    render(<I18nProvider><LanguageProbe /></I18nProvider>);

    expect(document.documentElement.dir).toBe('rtl');
    expect(screen.getByTestId('dashboard')).toHaveTextContent('لوحة التحكم');

    await user.click(screen.getByRole('button', { name: 'Toggle language' }));

    expect(document.documentElement.dir).toBe('ltr');
    expect(screen.getByTestId('dashboard')).toHaveTextContent('Dashboard');
    expect(localStorage.getItem('saha-lang')).toBe('en');
  });
});
