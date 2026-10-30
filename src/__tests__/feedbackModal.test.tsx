import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { t } from '../utils/i18n';

const sendFeedback = vi.fn();
vi.mock('../utils/api', () => ({
  api: { sendFeedback: (body: unknown) => sendFeedback(body) },
}));

// .env carries a real site key, so stand in for the widget: it solves at once.
vi.mock('../components/Turnstile', () => ({
  Turnstile: ({ onToken }: { onToken: (t: string) => void }) => { useEffect(() => onToken('tok'), [onToken]); return null; },
}));

import { FeedbackModal } from '../components/FeedbackModal';

describe('FeedbackModal', () => {
  beforeEach(() => sendFeedback.mockReset());

  const fill = (text: string) =>
    fireEvent.change(screen.getByLabelText(t('feedback.message')), { target: { value: text } });

  it('sends the message with the page link and the reply address, then thanks', async () => {
    sendFeedback.mockResolvedValue({ data: { ok: true } });
    render(<FeedbackModal onClose={vi.fn()} />);
    fill('The employment layer looks off');
    fireEvent.change(screen.getByLabelText(t('feedback.email')), { target: { value: 'me@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: t('feedback.send') }));

    await waitFor(() => expect(screen.getByText(t('feedback.sent'))).toBeTruthy());
    expect(sendFeedback).toHaveBeenCalledWith(expect.objectContaining({
      message: 'The employment layer looks off',
      email: 'me@example.com',
      page: window.location.href,
      turnstileToken: 'tok',
    }));
  });

  it('leaves the page out when unticked, and the address out when blank', async () => {
    sendFeedback.mockResolvedValue({ data: { ok: true } });
    render(<FeedbackModal onClose={vi.fn()} />);
    fill('hi');
    fireEvent.click(screen.getByLabelText(t('feedback.include_page')));
    fireEvent.click(screen.getByRole('button', { name: t('feedback.send') }));
    await waitFor(() => expect(sendFeedback).toHaveBeenCalled());
    expect(sendFeedback.mock.calls[0][0]).toMatchObject({ page: undefined, email: undefined });
  });

  it('on failure, keeps the message and names the address to write to instead', async () => {
    sendFeedback.mockResolvedValue({ error: 'Down' });
    render(<FeedbackModal onClose={vi.fn()} />);
    fill('hello');
    fireEvent.click(screen.getByRole('button', { name: t('feedback.send') }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('info@naapurustot.fi');
    expect((screen.getByLabelText(t('feedback.message')) as HTMLTextAreaElement).value).toBe('hello');
  });

  it('cannot be sent empty, and Escape closes it', () => {
    const onClose = vi.fn();
    render(<FeedbackModal onClose={onClose} />);
    expect((screen.getByRole('button', { name: t('feedback.send') }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
