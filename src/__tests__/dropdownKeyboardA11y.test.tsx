import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CitySelector } from '../components/CitySelector';
import { UserMenu } from '../components/UserMenu';
import { t } from '../utils/i18n';
import type { ApiUser } from '../utils/api';

/**
 * UX AY-3: both header dropdowns were dismissable by document `mousedown` only —
 * no Escape, no announcement. The account menu holds sign-out, the GDPR export and
 * account deletion, so a keyboard or screen-reader user who opened either one had
 * no way to close it. ToolsDropdown already had the right pattern; these now match.
 */
const user: ApiUser = { id: 1, username: 'testuser', displayName: 'Testi', email: null } as unknown as ApiUser;

describe('CitySelector mobile popover (AY-3)', () => {
  function open() {
    render(<CitySelector value="helsinki_metro" onChange={vi.fn()} />);
    const trigger = screen.getByRole('button', { name: new RegExp(t('city.select')) });
    fireEvent.click(trigger);
    return trigger;
  }

  it('names the active region on the icon-only trigger', () => {
    render(<CitySelector value="helsinki_metro" onChange={vi.fn()} />);
    const trigger = screen.getByRole('button', { name: new RegExp(t('city.select')) });
    expect(trigger.getAttribute('aria-label')).toContain(t('city.helsinki_metro'));
  });

  it('announces expanded state', () => {
    const trigger = open();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(trigger).toHaveAttribute('aria-haspopup', 'listbox');
  });

  it('closes on Escape and returns focus to the trigger', () => {
    const trigger = open();
    expect(screen.getByPlaceholderText(t('city.filter_placeholder'))).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByPlaceholderText(t('city.filter_placeholder'))).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});

describe('UserMenu dropdown (AY-3)', () => {
  function open() {
    render(<UserMenu user={user} onLogout={vi.fn()} />);
    const trigger = screen.getByRole('button', { name: /Testi/ });
    fireEvent.click(trigger);
    return trigger;
  }

  it('announces that it opens a menu, and its state', () => {
    render(<UserMenu user={user} onLogout={vi.fn()} />);
    const trigger = screen.getByRole('button', { name: /Testi/ });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });

  it('closes on Escape and returns focus to the trigger', () => {
    const trigger = open();
    expect(screen.getByText(t('auth.logout'))).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByText(t('auth.logout'))).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
