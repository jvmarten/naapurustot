import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { t } from '../utils/i18n';
import type { ApiUser } from '../utils/api';

/**
 * UserMenu covers sign-out, the GDPR export and account deletion — the highest-stakes
 * controls in the app — plus the cloud-sync health row. These tests exercise the states
 * that only appear on a failure path, including UX CF-3: "delete account" must
 * acknowledge the deletion (and the local wipe its copy promises) before the menu
 * closes, instead of just vanishing while every favorite and note is still on screen.
 */
const mockSyncStatus = vi.fn(() => 'idle' as 'idle' | 'syncing' | 'error');
const mockSessionExpired = vi.fn(() => false);
const retryAllSyncs = vi.fn();

vi.mock('../utils/syncStatus', () => ({
  useSyncStatus: () => mockSyncStatus(),
  useSessionExpired: () => mockSessionExpired(),
  retryAllSyncs: () => retryAllSyncs(),
}));

import { UserMenu } from '../components/UserMenu';

const user = { id: 1, username: 'testuser', displayName: 'Testi', email: null } as unknown as ApiUser;

function openMenu(props: Partial<React.ComponentProps<typeof UserMenu>> = {}) {
  render(<UserMenu user={user} onLogout={vi.fn()} {...props} />);
  const trigger = screen.getByRole('button', { name: /Testi/ });
  fireEvent.click(trigger);
  return trigger;
}

describe('UserMenu sync status row', () => {
  beforeEach(() => {
    mockSyncStatus.mockReturnValue('idle');
    mockSessionExpired.mockReturnValue(false);
    retryAllSyncs.mockClear();
  });

  it('stays quiet when sync is idle', () => {
    openMenu();
    expect(screen.queryByText(t('sync.saving'))).toBeNull();
    expect(screen.queryByText(t('sync.error'))).toBeNull();
  });

  it('shows a saving row while syncing', () => {
    mockSyncStatus.mockReturnValue('syncing');
    openMenu();
    expect(screen.getByText(t('sync.saving'))).toBeInTheDocument();
  });

  it('offers a retry for a transient sync error', () => {
    mockSyncStatus.mockReturnValue('error');
    openMenu();
    expect(screen.getByText(t('sync.error'))).toBeInTheDocument();
    fireEvent.click(screen.getByText(t('error.retry')));
    expect(retryAllSyncs).toHaveBeenCalled();
  });

  it('offers re-login (not retry) for an expired session', () => {
    mockSyncStatus.mockReturnValue('error');
    mockSessionExpired.mockReturnValue(true);
    const onReLogin = vi.fn();
    openMenu({ onReLogin });
    expect(screen.getByText(t('sync.session_expired'))).toBeInTheDocument();
    expect(screen.queryByText(t('error.retry'))).toBeNull();
    fireEvent.click(screen.getByText(t('auth.login')));
    expect(onReLogin).toHaveBeenCalled();
  });
});

describe('UserMenu favorites section', () => {
  beforeEach(() => {
    mockSyncStatus.mockReturnValue('idle');
    mockSessionExpired.mockReturnValue(false);
  });

  it('renders the empty state with no favorites', () => {
    openMenu();
    expect(screen.getByText(t('favorites.empty'))).toBeInTheDocument();
  });

  it('lists favorites and wires both row actions', () => {
    const onToggleFavorite = vi.fn();
    const onSelectFavorite = vi.fn();
    openMenu({
      favorites: [{ pno: '00100', name: 'Kluuvi' }, { pno: '00500', name: 'Sörnäinen' }],
      onToggleFavorite,
      onSelectFavorite,
    });

    expect(screen.getByText('Kluuvi')).toBeInTheDocument();
    expect(screen.getByText('Sörnäinen')).toBeInTheDocument();

    // The star un-favorites without navigating…
    fireEvent.click(screen.getAllByLabelText(t('favorites.remove'))[0]);
    expect(onToggleFavorite).toHaveBeenCalledWith('00100');
    expect(onSelectFavorite).not.toHaveBeenCalled();

    // …and the name navigates and closes the menu.
    fireEvent.click(screen.getByText('Sörnäinen'));
    expect(onSelectFavorite).toHaveBeenCalledWith('00500');
    expect(screen.queryByText(t('auth.logout'))).toBeNull();
  });
});

describe('UserMenu GDPR export and delete (CF-3)', () => {
  beforeEach(() => {
    mockSyncStatus.mockReturnValue('idle');
    mockSessionExpired.mockReturnValue(false);
    // jsdom has no object-URL plumbing; the export path only needs it not to throw.
    URL.createObjectURL = vi.fn(() => 'blob:mock');
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => vi.restoreAllMocks());

  it('surfaces an export failure instead of silently doing nothing', async () => {
    const onExportData = vi.fn().mockResolvedValue({ error: 'Export failed' });
    openMenu({ onExportData });
    fireEvent.click(screen.getByText(t('account.export')));
    await waitFor(() => expect(screen.getByText('Export failed')).toBeInTheDocument());
  });

  it('downloads the payload on a successful export', async () => {
    const onExportData = vi.fn().mockResolvedValue({ data: { favorites: [] } });
    openMenu({ onExportData });
    fireEvent.click(screen.getByText(t('account.export')));
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
  });

  it('requires confirmation, and cancelling backs out', () => {
    const onDeleteAccount = vi.fn();
    openMenu({ onDeleteAccount });
    fireEvent.click(screen.getByText(t('account.delete')));
    expect(screen.getByText(t('account.delete_confirm'))).toBeInTheDocument();
    fireEvent.click(screen.getByText(t('account.delete_cancel')));
    expect(screen.queryByText(t('account.delete_confirm'))).toBeNull();
    expect(onDeleteAccount).not.toHaveBeenCalled();
  });

  it('keeps the menu open and shows the error when deletion fails', async () => {
    const onDeleteAccount = vi.fn().mockResolvedValue('Server error');
    openMenu({ onDeleteAccount });
    fireEvent.click(screen.getByText(t('account.delete')));
    fireEvent.click(screen.getByText(t('account.delete_yes')));
    await waitFor(() => expect(screen.getByText('Server error')).toBeInTheDocument());
    expect(screen.queryByText(t('account.deleted'))).toBeNull();
  });

  it('CF-3: confirms the deletion before closing', async () => {
    const onDeleteAccount = vi.fn().mockResolvedValue(null);
    openMenu({ onDeleteAccount });
    fireEvent.click(screen.getByText(t('account.delete')));
    fireEvent.click(screen.getByText(t('account.delete_yes')));
    await waitFor(() => expect(screen.getByText(t('account.deleted'))).toBeInTheDocument());
    expect(onDeleteAccount).toHaveBeenCalled();
  });
});

describe('UserMenu logout', () => {
  beforeEach(() => {
    mockSyncStatus.mockReturnValue('idle');
    mockSessionExpired.mockReturnValue(false);
  });

  it('closes the menu and signs out', () => {
    const onLogout = vi.fn();
    openMenu({ onLogout });
    fireEvent.click(screen.getByText(t('auth.logout')));
    expect(onLogout).toHaveBeenCalled();
    expect(screen.queryByText(t('auth.logout'))).toBeNull();
  });
});
