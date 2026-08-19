import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { t } from '../utils/i18n';
import type { ApiUser } from '../utils/api';

/**
 * The UserMenu supporter row: a prompt to become a supporter for a free account, and
 * the highlighted "Supporter" badge (doubling as the manage entry point) for a paying
 * one. Both open the supporter modal via onOpenSupporter.
 */
vi.mock('../utils/syncStatus', () => ({
  useSyncStatus: () => 'idle',
  useSessionExpired: () => false,
  retryAllSyncs: () => {},
}));

import { UserMenu } from '../components/UserMenu';

const freeUser = { id: 'u1', username: 'tester', displayName: 'Testi', email: null, trustLevel: 0, createdAt: 'x', supporter: false } as ApiUser;
const proUser = { ...freeUser, supporter: true } as ApiUser;

function openMenu(props: Partial<React.ComponentProps<typeof UserMenu>> = {}, user: ApiUser = freeUser) {
  render(<UserMenu user={user} onLogout={vi.fn()} {...props} />);
  fireEvent.click(screen.getByRole('button', { name: /Testi/ }));
}

describe('UserMenu supporter row', () => {
  beforeEach(() => vi.clearAllMocks());

  it('is absent when onOpenSupporter is not provided', () => {
    openMenu();
    expect(screen.queryByText(t('supporter.cta.open'))).toBeNull();
    expect(screen.queryByText(t('supporter.badge'))).toBeNull();
  });

  it('prompts a free account to become a supporter', () => {
    const onOpenSupporter = vi.fn();
    openMenu({ onOpenSupporter });
    const btn = screen.getByText(t('supporter.cta.open'));
    fireEvent.click(btn);
    expect(onOpenSupporter).toHaveBeenCalled();
  });

  it('shows the supporter badge for a paying account', () => {
    const onOpenSupporter = vi.fn();
    openMenu({ onOpenSupporter }, proUser);
    expect(screen.queryByText(t('supporter.cta.open'))).toBeNull();
    const badge = screen.getByText(t('supporter.badge'));
    fireEvent.click(badge);
    expect(onOpenSupporter).toHaveBeenCalled();
  });
});
