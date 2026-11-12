import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LanguageProvider, LanguageToggle } from './LanguageContext.js';

const html = document.documentElement;

afterEach(() => {
  html.lang = 'en';
  html.dir = '';
});

describe('LanguageToggle', () => {
  it('offers English, Roman Urdu and Urdu', () => {
    render(
      <LanguageProvider>
        <LanguageToggle />
      </LanguageProvider>
    );
    expect(screen.getByRole('button', { name: 'English' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Roman Urdu' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'اردو' })).toBeInTheDocument();
  });

  it('turns the document right-to-left for Urdu, and back again', () => {
    render(
      <LanguageProvider>
        <LanguageToggle />
        <p>Release phone</p>
      </LanguageProvider>
    );
    expect(html.dir).toBe('ltr');

    fireEvent.click(screen.getByRole('button', { name: 'اردو' }));
    expect(html.lang).toBe('ur');
    expect(html.dir).toBe('rtl');
    expect(screen.getByText('فون آزاد کریں')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Roman Urdu' }));
    expect(html.lang).toBe('ur-Latn');
    expect(html.dir).toBe('ltr');
    expect(screen.getByText('Phone azaad karein')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'English' }));
    expect(html.lang).toBe('en');
    expect(html.dir).toBe('ltr');
    expect(screen.getByText('Release phone')).toBeInTheDocument();
  });

  it('remembers the choice for each user separately', () => {
    const first = render(
      <LanguageProvider userId="owner">
        <LanguageToggle />
      </LanguageProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'اردو' }));
    first.unmount();

    // Someone else signs in on the same browser and picks English.
    const second = render(
      <LanguageProvider userId="staff">
        <LanguageToggle />
      </LanguageProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'English' }));
    second.unmount();

    render(
      <LanguageProvider userId="owner">
        <LanguageToggle />
      </LanguageProvider>
    );
    expect(html.lang).toBe('ur');
    expect(screen.getByRole('button', { name: 'اردو' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('ignores a stored value it does not know', () => {
    localStorage.setItem('almas_language', 'klingon');
    render(
      <LanguageProvider>
        <LanguageToggle />
      </LanguageProvider>
    );
    expect(html.lang).toBe('en');
  });
});
