import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { t } from '../utils/i18n';
import type { ApiUser } from '../utils/api';

/**
 * The password-reset surfaces: the "forgot password" branch of AuthModal, the
 * /uusi-salasana landing page, and the recovery-email editor in UserMenu.
 *
 * The load-bearing property under test is that NOTHING here reveals whether an
 * address belongs to an account. The server answers /auth/forgot-password
 * identically for a real address, an unknown one and a malformed one; if the UI
 * branched on the response it would hand back the account-enumeration oracle the
 * server refuses to be.
 */

const forgotPassword = vi.fn();
const resetPassword = vi.fn();
const updateEmail = vi.fn();

vi.mock('../utils/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      forgotPassword: (...args: unknown[]) => forgotPassword(...args),
      resetPassword: (...args: unknown[]) => resetPassword(...args),
    },
  };
});

vi.mock('../utils/syncStatus', () => ({
  useSyncStatus: () => 'idle',
  useSessionExpired: () => false,
  retryAllSyncs: vi.fn(),
}));

// Turnstile mounts a Cloudflare script; the signup tab isn't under test here.
vi.mock('../components/Turnstile', () => ({
  Turnstile: () => null,
}));

import { AuthModal } from '../components/AuthModal';
import { ResetPasswordPage } from '../pages/ResetPasswordPage';
import { UserMenu } from '../components/UserMenu';

function renderModal() {
  return render(
    <AuthModal onClose={vi.fn()} onLogin={vi.fn()} onSignup={vi.fn()} />,
  );
}

/** Point window.location.search at a reset link's query string. */
function setSearch(search: string): void {
  Object.defineProperty(window, 'location', {
    value: { ...window.location, search, pathname: '/uusi-salasana' },
    writable: true,
  });
}

describe('AuthModal — forgot password', () => {
  beforeEach(() => {
    forgotPassword.mockReset();
    forgotPassword.mockResolvedValue({ data: { ok: true } });
  });

  it('offers the reset link on the login tab only', () => {
    renderModal();
    expect(screen.getByText(t('auth.forgot_link'))).toBeInTheDocument();

    // Signup has no password to have forgotten yet.
    fireEvent.click(screen.getByRole('button', { name: t('auth.signup') }));
    expect(screen.queryByText(t('auth.forgot_link'))).toBeNull();
  });

  it('sends the request with the current UI language and confirms generically', async () => {
    renderModal();
    fireEvent.click(screen.getByText(t('auth.forgot_link')));

    fireEvent.change(screen.getByLabelText(t('auth.email')), {
      target: { value: 'someone@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: t('auth.forgot_submit') }));

    await waitFor(() => expect(forgotPassword).toHaveBeenCalledTimes(1));
    expect(forgotPassword).toHaveBeenCalledWith('someone@example.com', 'fi');
    expect(await screen.findByText(t('auth.forgot_sent'))).toBeInTheDocument();
  });

  it('shows the SAME confirmation regardless of whether the address is registered', async () => {
    // The client cannot tell the two cases apart — the server returns an identical
    // 200 {ok:true} for both — and this asserts the UI never invents a difference.
    const seen: string[] = [];
    for (const address of ['real@example.com', 'nobody@example.com']) {
      const { unmount } = renderModal();
      fireEvent.click(screen.getByText(t('auth.forgot_link')));
      fireEvent.change(screen.getByLabelText(t('auth.email')), { target: { value: address } });
      fireEvent.click(screen.getByRole('button', { name: t('auth.forgot_submit') }));
      seen.push((await screen.findByText(t('auth.forgot_sent'))).textContent ?? '');
      unmount();
    }
    expect(seen[0]).toBe(seen[1]);
  });

  it('surfaces a transport failure rather than claiming a mail was sent', async () => {
    forgotPassword.mockResolvedValue({ error: 'network down' });
    renderModal();
    fireEvent.click(screen.getByText(t('auth.forgot_link')));
    fireEvent.change(screen.getByLabelText(t('auth.email')), { target: { value: 'a@b.fi' } });
    fireEvent.click(screen.getByRole('button', { name: t('auth.forgot_submit') }));

    expect(await screen.findByText('network down')).toBeInTheDocument();
    expect(screen.queryByText(t('auth.forgot_sent'))).toBeNull();
  });

  it('returns to the login form from the reset view', () => {
    renderModal();
    fireEvent.click(screen.getByText(t('auth.forgot_link')));
    expect(screen.getByRole('button', { name: t('auth.forgot_submit') })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: t('auth.forgot_back') }));
    // Assert on the username field rather than a button named "log in" — both the
    // tab and the submit carry that label, so the query would be ambiguous.
    expect(screen.getByPlaceholderText(t('auth.username_placeholder'))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('auth.forgot_submit') })).toBeNull();
  });
});

describe('ResetPasswordPage', () => {
  beforeEach(() => {
    resetPassword.mockReset();
    resetPassword.mockResolvedValue({ data: { ok: true } });
  });

  function renderPage() {
    return render(
      <MemoryRouter>
        <ResetPasswordPage />
      </MemoryRouter>,
    );
  }

  it('explains the problem instead of showing a doomed form when the token is missing', () => {
    setSearch('');
    renderPage();
    expect(screen.getByText(t('reset.no_token'))).toBeInTheDocument();
    expect(screen.queryByLabelText(t('reset.new_password'))).toBeNull();
  });

  it('submits the token from the URL and reports the revoked sessions on success', async () => {
    setSearch('?token=abc123&lang=fi');
    renderPage();

    fireEvent.change(screen.getByLabelText(t('reset.new_password')), {
      target: { value: 'a-long-enough-password' },
    });
    fireEvent.change(screen.getByLabelText(t('auth.confirm_password')), {
      target: { value: 'a-long-enough-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: t('reset.submit') }));

    await waitFor(() => expect(resetPassword).toHaveBeenCalledWith('abc123', 'a-long-enough-password'));
    expect(await screen.findByText(t('reset.success'))).toBeInTheDocument();
    // The reset bumped token_version server-side, so other devices are signed out —
    // saying so here is the only place the user learns why.
    expect(screen.getByText(t('reset.success_sessions'))).toBeInTheDocument();
  });

  it('strips the token from the address bar once captured', async () => {
    const replaceState = vi.spyOn(window.history, 'replaceState').mockImplementation(() => {});
    setSearch('?token=secret-token-value&lang=fi');
    renderPage();

    await waitFor(() => expect(replaceState).toHaveBeenCalled());
    const url = replaceState.mock.calls[0][2] as string;
    expect(url).not.toContain('secret-token-value');
    replaceState.mockRestore();
  });

  it('rejects a mismatched confirmation without calling the API', () => {
    setSearch('?token=abc123');
    renderPage();

    fireEvent.change(screen.getByLabelText(t('reset.new_password')), {
      target: { value: 'a-long-enough-password' },
    });
    fireEvent.change(screen.getByLabelText(t('auth.confirm_password')), {
      target: { value: 'a-different-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: t('reset.submit') }));

    expect(screen.getByText(t('auth.passwords_no_match'))).toBeInTheDocument();
    expect(resetPassword).not.toHaveBeenCalled();
  });

  it('shows the server error for an expired or already-used link', async () => {
    resetPassword.mockResolvedValue({ error: t('auth.error.reset_link_invalid') });
    setSearch('?token=abc123');
    renderPage();

    fireEvent.change(screen.getByLabelText(t('reset.new_password')), { target: { value: 'a-long-enough-password' } });
    fireEvent.change(screen.getByLabelText(t('auth.confirm_password')), { target: { value: 'a-long-enough-password' } });
    fireEvent.click(screen.getByRole('button', { name: t('reset.submit') }));

    expect(await screen.findByText(t('auth.error.reset_link_invalid'))).toBeInTheDocument();
    expect(screen.queryByText(t('reset.success'))).toBeNull();
  });
});

describe('UserMenu — recovery email', () => {
  const withEmail = { id: 1, username: 'testuser', displayName: 'Testi', email: 'a@b.fi' } as unknown as ApiUser;
  const noEmail = { id: 1, username: 'testuser', displayName: 'Testi', email: null } as unknown as ApiUser;

  beforeEach(() => {
    updateEmail.mockReset();
    updateEmail.mockResolvedValue(null);
  });

  function openMenu(user: ApiUser) {
    render(<UserMenu user={user} onLogout={vi.fn()} onUpdateEmail={updateEmail} />);
    fireEvent.click(screen.getByRole('button', { name: /Testi/ }));
  }

  it('warns when the account has no recovery address', () => {
    openMenu(noEmail);
    // Without this, an account created without an email looks perfectly healthy
    // right up until the day its password is forgotten.
    expect(screen.getByText(t('account.email_missing'))).toBeInTheDocument();
    expect(screen.getByText(t('account.email_add'))).toBeInTheDocument();
  });

  it('shows the current address and offers a change instead', () => {
    openMenu(withEmail);
    expect(screen.getByText('a@b.fi')).toBeInTheDocument();
    expect(screen.getByText(t('account.email_change'))).toBeInTheDocument();
    expect(screen.queryByText(t('account.email_missing'))).toBeNull();
  });

  it('requires the current password before saving', async () => {
    openMenu(noEmail);
    fireEvent.click(screen.getByText(t('account.email_add')));

    fireEvent.change(screen.getByLabelText(t('account.email_label')), {
      target: { value: 'new@example.com' },
    });
    // The email alone must not enable the save: re-authentication is what stops a
    // stolen session repointing the reset channel.
    expect(screen.getByRole('button', { name: t('account.email_save') })).toBeDisabled();

    fireEvent.change(screen.getByLabelText(t('account.email_password')), {
      target: { value: 'current-password' },
    });
    expect(screen.getByRole('button', { name: t('account.email_save') })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: t('account.email_save') }));
    await waitFor(() => expect(updateEmail).toHaveBeenCalledWith('new@example.com', 'current-password'));
    expect(await screen.findByText(t('account.email_saved'))).toBeInTheDocument();
  });

  it('keeps the form open and shows the error when the password is wrong', async () => {
    updateEmail.mockResolvedValue(t('auth.error.password_incorrect'));
    openMenu(noEmail);
    fireEvent.click(screen.getByText(t('account.email_add')));
    fireEvent.change(screen.getByLabelText(t('account.email_label')), { target: { value: 'new@example.com' } });
    fireEvent.change(screen.getByLabelText(t('account.email_password')), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: t('account.email_save') }));

    expect(await screen.findByText(t('auth.error.password_incorrect'))).toBeInTheDocument();
    expect(screen.getByLabelText(t('account.email_label'))).toBeInTheDocument();
    expect(screen.queryByText(t('account.email_saved'))).toBeNull();
  });

  it('is absent entirely when no backend handler is wired in', () => {
    render(<UserMenu user={noEmail} onLogout={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Testi/ }));
    expect(screen.queryByText(t('account.email_missing'))).toBeNull();
  });
});
