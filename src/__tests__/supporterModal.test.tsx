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
const getLightningPlans = vi.fn();
const startLightningCheckout = vi.fn();

vi.mock('../utils/api', () => ({
  api: {
    startCheckout: () => startCheckout(),
    openBillingPortal: () => openBillingPortal(),
    getLightningPlans: () => getLightningPlans(),
    startLightningCheckout: (plan: 'month' | 'year') => startLightningCheckout(plan),
  },
}));

import { SupporterModal } from '../components/SupporterModal';

const freeUser = { id: 'u1', username: 'tester', displayName: 'Testi', email: null, trustLevel: 0, createdAt: 'x', supporter: false } as ApiUser;
// A Stripe subscriber auto-renews, so supporterRenews is true (drives "Renews" + the portal).
const proUser = { ...freeUser, supporter: true, supporterUntil: '2035-03-01T00:00:00Z', supporterRenews: true } as ApiUser;
// A prepaid Lightning supporter: entitled but does NOT auto-renew.
const lightningUser = { ...freeUser, supporter: true, supporterUntil: '2035-03-01T00:00:00Z', supporterRenews: false } as ApiUser;
const LN_PLANS = [
  { id: 'month' as const, windowDays: 30, amountEurCents: 999 },
  { id: 'year' as const, windowDays: 365, amountEurCents: 9900 },
];

// Replace window.location with a plain object so a redirect just sets .href (jsdom would
// otherwise log "Not implemented: navigation").
const realLocation = window.location;
beforeEach(() => {
  startCheckout.mockReset();
  openBillingPortal.mockReset();
  startLightningCheckout.mockReset();
  // Default: Lightning unconfigured, so no plan buttons render and the existing states
  // are unchanged. Individual tests override to exercise the Lightning path.
  getLightningPlans.mockReset();
  getLightningPlans.mockResolvedValue({ data: { configured: false, plans: [] } });
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

describe('SupporterModal — Bitcoin/Lightning', () => {
  it('renders a plan button per configured plan and redirects to the hosted invoice', async () => {
    getLightningPlans.mockResolvedValue({ data: { configured: true, plans: LN_PLANS } });
    startLightningCheckout.mockResolvedValue({ data: { url: 'https://pay.test/inv' } });
    render(<SupporterModal user={freeUser} onClose={vi.fn()} onRefresh={vi.fn()} onNeedLogin={vi.fn()} />);

    // The section appears once the async plans fetch resolves.
    expect(await screen.findByText(t('supporter.cta.lightning'))).toBeInTheDocument();
    const monthBtn = screen.getByRole('button', { name: new RegExp(t('supporter.plan.month')) });
    expect(screen.getByRole('button', { name: new RegExp(t('supporter.plan.year')) })).toBeInTheDocument();

    fireEvent.click(monthBtn);
    await waitFor(() => expect(window.location.href).toBe('https://pay.test/inv'));
    expect(startLightningCheckout).toHaveBeenCalledWith('month');
  });

  it('shows no Lightning buttons when the tier is unconfigured', async () => {
    render(<SupporterModal user={freeUser} onClose={vi.fn()} onRefresh={vi.fn()} onNeedLogin={vi.fn()} />);
    // Give the (unconfigured) plans fetch a chance to resolve, then assert nothing rendered.
    await waitFor(() => expect(getLightningPlans).toHaveBeenCalled());
    expect(screen.queryByText(t('supporter.cta.lightning'))).toBeNull();
    // The Stripe subscribe button is unaffected.
    expect(screen.getByRole('button', { name: t('supporter.cta.subscribe') })).toBeInTheDocument();
  });

  it('a prepaid Lightning supporter sees "PRO until" and no manage/portal button', () => {
    render(<SupporterModal user={lightningUser} onClose={vi.fn()} onRefresh={vi.fn()} onNeedLogin={vi.fn()} />);
    expect(screen.getByText(new RegExp(t('supporter.status.until')))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('supporter.cta.manage') })).toBeNull();
    expect(openBillingPortal).not.toHaveBeenCalled();
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
