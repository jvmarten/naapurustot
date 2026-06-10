import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { useRef } from 'react';
import { useFocusTrap } from '../hooks/useFocusTrap';

function Trapped() {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref);
  return (
    <div ref={ref} role="dialog" aria-modal="true">
      <button>first</button>
      <button>middle</button>
      <button>last</button>
    </div>
  );
}

const tab = (shiftKey = false) =>
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true }));

describe('useFocusTrap (PO-3)', () => {
  it('moves focus into the container on mount', () => {
    const { getByText } = render(<Trapped />);
    expect(document.activeElement).toBe(getByText('first'));
  });

  it('wraps Tab from the last element back to the first', () => {
    const { getByText } = render(<Trapped />);
    getByText('last').focus();
    tab();
    expect(document.activeElement).toBe(getByText('first'));
  });

  it('wraps Shift+Tab from the first element to the last', () => {
    const { getByText } = render(<Trapped />);
    getByText('first').focus();
    tab(true);
    expect(document.activeElement).toBe(getByText('last'));
  });

  it('leaves Tab between interior elements to the browser', () => {
    const { getByText } = render(<Trapped />);
    getByText('first').focus();
    tab(); // not on the last element → no forced wrap
    expect(document.activeElement).toBe(getByText('first'));
  });
});
