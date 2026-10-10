import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ComparisonScopeToggle } from '../components/ComparisonScopeToggle';
import { t, setLang } from '../utils/i18n';

/**
 * The comparison-scope toggle in the multi-region view: 'region' then means every
 * region on the map together, so the wording is plural ("these regions") while the
 * toggle behaves exactly as in a single-region view. Real t() (Finnish by default,
 * en/sv preloaded by setup.ts), so the assertions pin the strings a user sees.
 */

describe('ComparisonScopeToggle', () => {
  afterEach(() => {
    act(() => { void setLang('fi'); });
  });

  it('single region: singular label and hints', () => {
    const { rerender } = render(<ComparisonScopeToggle scope="region" onChange={vi.fn()} disabled={false} />);
    const btn = screen.getByRole('button');
    expect(btn).toHaveTextContent(t('scope.region'));
    expect(btn.getAttribute('title')).toBe(t('scope.active_hint'));

    rerender(<ComparisonScopeToggle scope="all" onChange={vi.fn()} disabled={false} />);
    expect(btn).toHaveTextContent(t('scope.all'));
    expect(btn.getAttribute('title')).toBe(t('scope.national_hint'));
  });

  it('several regions: plural label and hints, distinct from the single-region strings', () => {
    const { rerender } = render(<ComparisonScopeToggle scope="region" onChange={vi.fn()} disabled={false} multi />);
    const btn = screen.getByRole('button');
    expect(t('scope.region_multi')).not.toBe(t('scope.region'));
    expect(btn).toHaveTextContent(t('scope.region_multi'));
    expect(btn.getAttribute('title')).toBe(t('scope.region_multi'));

    rerender(<ComparisonScopeToggle scope="all" onChange={vi.fn()} disabled={false} multi />);
    // "Whole of Finland" is the same whatever is on the map.
    expect(btn).toHaveTextContent(t('scope.all'));
    expect(btn.getAttribute('title')).toBe(t('scope.national_hint_multi'));
    expect(t('scope.national_hint_multi')).not.toBe(t('scope.national_hint'));
  });

  it('several regions: still toggles between the two scopes', () => {
    const onChange = vi.fn();
    const { rerender } = render(<ComparisonScopeToggle scope="all" onChange={onChange} disabled={false} multi />);
    fireEvent.click(screen.getByRole('button'));
    expect(onChange).toHaveBeenLastCalledWith('region');

    rerender(<ComparisonScopeToggle scope="region" onChange={onChange} disabled={false} multi />);
    fireEvent.click(screen.getByRole('button'));
    expect(onChange).toHaveBeenLastCalledWith('all');
  });

  it('several regions: the plural wording resolves in English and Swedish too', () => {
    act(() => { void setLang('en'); });
    const { unmount } = render(<ComparisonScopeToggle scope="region" onChange={vi.fn()} disabled={false} multi />);
    expect(screen.getByRole('button')).toHaveTextContent('Within these regions');
    unmount();

    act(() => { void setLang('sv'); });
    render(<ComparisonScopeToggle scope="region" onChange={vi.fn()} disabled={false} multi />);
    expect(screen.getByRole('button')).toHaveTextContent('Inom dessa områden');
  });
});
