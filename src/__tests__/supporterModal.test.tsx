import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { t } from '../utils/i18n';
import type { ApiUser } from '../utils/api';

/**
 * SupporterModal is the client half of the supporter (paid) tier: it renders the pitch,
 * the "already a supporter" state, the "activating after checkout" state, and redirects
 * the browser to Stripe-hosted Checkout / the customer portal. The entitlement itself is
 * server-derived — these tests only cover the modal's states and that it calls the API
 * and redirects, never that it grants anything.
 */
const startCheckout = vi.fn();
const openBillingPortal = vi.fn();

vi.mock('../utils/api', () => ({
  api: {
    startCheckout: () => startCheckout(),
    openBillingPortal: () => openBillingPortal(),
  },
}));

import { SupporterModal } from '../components/SupporterModal';

const freeUser = { id: 'u1', username: 'tester', displayName: 'Testi', email: null, trustLevel: 0, createdAt: 'x', supporter: false } as ApiUser;
const proUser = { ...freeUser, supporter: true, supporterUntil: '2035-03-01T00:00:00Z' } as ApiUser;

// Replace window.location with a plain object so a redirect just sets .href (jsdom would
// otherwise log "Not implemented: navigation").
const realLocation = window.location;
beforeEach(() => {
  startCheckout.mockReset();
  openBillingPortal.mockReset();
  // @ts-expect-error override for the test
  delete window.location;
  // @ts-expect-error minimal stub
  window.location = { href: '', search: '', pathname: '/', hash: '' };
});
afterEach(() => {
  // @ts-expect-error restore
  window.location = realLocation;
});

describe('SupporterModal — pitch (not a supporter)', () => {
  it('shows the price, benefits and a subscribe button', () => {
    render(<SupporterModal user={freeUser} onClose={vi.fn()} onRefresh={vi.fn()} onNeedLogin={vi.fn()} />);
    expect(screen.getByText(t('supporter.price'))).toBeInTheDocument();
    expect(screen.getByText(t('supporter.benefit.fund'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('supporter.cta.subscribe') })).toBeInTheDocument();
  });

  it('redirects to Stripe Checkout on subscribe', async () => {
    startCheckout.mockResolvedValue({ data: { url: 'https://checkout.stripe.test/abc' } });
    render(<SupporterModal user={freeUser} onClose={vi.fn()} onRefresh={vi.fn()} onNeedLogin={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: t('supporter.cta.subscribe') }));
    await waitFor(() => expect(window.location.href).toBe('https://checkout.stripe.test/abc'));
    expect(startCheckout).toHaveBeenCalledTimes(1);
  });

  it('surfaces a checkout error instead of redirecting', async () => {
    startCheckout.mockResolvedValue({ error: t('supporter.error.unavailable') });
    render(<SupporterModal user={freeUser} onClose={vi.fn()} onRefresh={vi.fn()} onNeedLogin={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: t('supporter.cta.subscribe') }));
    expect(await screen.findByText(t('supporter.error.unavailable'))).toBeInTheDocument();
    expect(window.location.href).toBe('');
  });
});

describe('SupporterModal — already a supporter', () => {
  it('shows the active status, renewal date and a manage button that opens the portal', async () => {
    openBillingPortal.mockResolvedValue({ data: { url: 'https://billing.stripe.test/portal' } });
    render(<SupporterModal user={proUser} onClose={vi.fn()} onRefresh={vi.fn()} onNeedLogin={vi.fn()} />);
    expect(screen.getByText(t('supporter.status.active'))).toBeInTheDocument();
    // "Renews <date>" — the label is present (date is locale-formatted).
    expect(screen.getByText(new RegExp(t('supporter.status.renews')))).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: t('supporter.cta.manage') }));
    await waitFor(() => expect(window.location.href).toBe('https://billing.stripe.test/portal'));
  });
});

describe('SupporterModal — needs an account', () => {
  it('prompts to sign in when there is no user', () => {
    const onNeedLogin = vi.fn();
    render(<SupporterModal user={null} onClose={vi.fn()} onRefresh={vi.fn()} onNeedLogin={onNeedLogin} />);
    expect(screen.getByText(t('supporter.need_account'))).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: t('supporter.cta.login') }));
    expect(onNeedLogin).toHaveBeenCalled();
    expect(startCheckout).not.toHaveBeenCalled();
  });
});

describe('SupporterModal — activating after checkout', () => {
  it('shows the activating notice and a refresh button', () => {
    const onRefresh = vi.fn();
    render(<SupporterModal user={freeUser} justSubscribed onClose={vi.fn()} onRefresh={onRefresh} onNeedLogin={vi.fn()} />);
    expect(screen.getByText(t('supporter.status.activating'))).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: t('supporter.status.refresh') }));
    expect(onRefresh).toHaveBeenCalled();
  });

  it('still shows the supporter state (not activating) once the entitlement has landed', () => {
    render(<SupporterModal user={proUser} justSubscribed onClose={vi.fn()} onRefresh={vi.fn()} onNeedLogin={vi.fn()} />);
    expect(screen.getByText(t('supporter.status.active'))).toBeInTheDocument();
    expect(screen.queryByText(t('supporter.status.activating'))).toBeNull();
  });
});

describe('SupporterModal — close', () => {
  it('calls onClose from the close button', () => {
    const onClose = vi.fn();
    render(<SupporterModal user={freeUser} onClose={onClose} onRefresh={vi.fn()} onNeedLogin={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: t('aria.close') }));
    expect(onClose).toHaveBeenCalled();
  });
});
