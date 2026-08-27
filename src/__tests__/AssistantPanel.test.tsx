import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AssistantPanel } from '../components/AssistantPanel';
import { t } from '../utils/i18n';
import { api } from '../utils/api';

vi.mock('../utils/analytics', () => ({ trackEvent: vi.fn() }));

const assistMock = vi.spyOn(api, 'assist');

function renderPanel(props: Partial<React.ComponentProps<typeof AssistantPanel>> = {}) {
  const onApply = vi.fn();
  const onClose = vi.fn();
  render(<AssistantPanel lang="en" onApply={onApply} onClose={onClose} {...props} />);
  return { onApply, onClose };
}

beforeEach(() => {
  assistMock.mockReset();
});

describe('AssistantPanel', () => {
  it('renders the input, examples and submit button', () => {
    renderPanel();
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByRole('button', { name: t('assist.submit') })).toBeTruthy();
    expect(screen.getByRole('button', { name: t('assist.example_1') })).toBeTruthy();
  });

  it('fills the textarea when an example chip is clicked', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: t('assist.example_2') }));
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(textarea.value).toBe(t('assist.example_2'));
  });

  it('applies the proposed filters on a successful response', async () => {
    assistMock.mockResolvedValue({
      data: {
        title: 'Green & quiet',
        explanation: 'Filtered on high tree cover and low crime.',
        criteria: [
          { layerId: 'tree_canopy', min: 60, max: 100, mode: 'percentile' },
          { layerId: 'crime_rate', min: 0, max: 30, mode: 'percentile' },
        ],
        similarTo: null,
        unmatched: [],
      },
    });
    const { onApply, onClose } = renderPanel();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'green and quiet' } });
    fireEvent.click(screen.getByRole('button', { name: t('assist.submit') }));

    await waitFor(() => expect(onApply).toHaveBeenCalledTimes(1));
    expect(assistMock).toHaveBeenCalledWith('green and quiet', 'en', expect.any(Array));
    const [filters] = onApply.mock.calls[0];
    expect(filters.map((f: { layerId: string }) => f.layerId)).toEqual(['tree_canopy', 'crime_rate']);
    expect(screen.getByText('Filtered on high tree cover and low crime.')).toBeTruthy();

    // "View matches" closes the panel to reveal the results.
    fireEvent.click(screen.getByRole('button', { name: t('assist.view_results') }));
    expect(onClose).toHaveBeenCalled();
  });

  it('shows the no-match message and does not apply when nothing mapped', async () => {
    assistMock.mockResolvedValue({
      data: { title: 'x', explanation: '', criteria: [], similarTo: null, unmatched: ['close to my mother'] },
    });
    const { onApply } = renderPanel();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'near my mother' } });
    fireEvent.click(screen.getByRole('button', { name: t('assist.submit') }));

    await waitFor(() => expect(screen.getByText(t('assist.result_none'))).toBeTruthy());
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.getByText(/close to my mother/)).toBeTruthy();
  });

  it('surfaces an error from the backend', async () => {
    assistMock.mockResolvedValue({ error: 'The assistant is down' });
    const { onApply } = renderPanel();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'anything' } });
    fireEvent.click(screen.getByRole('button', { name: t('assist.submit') }));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('The assistant is down'));
    expect(onApply).not.toHaveBeenCalled();
  });

  it('closes on the close button', () => {
    const { onClose } = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: t('assist.close') }));
    expect(onClose).toHaveBeenCalled();
  });

  it('does not submit an empty query', () => {
    renderPanel();
    const submit = screen.getByRole('button', { name: t('assist.submit') }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.click(submit);
    expect(assistMock).not.toHaveBeenCalled();
  });
});
