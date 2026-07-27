import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Legend } from '../components/Legend';
import { t } from '../utils/i18n';

/**
 * The Legend is the app's main "what am I looking at" surface, so its conditional
 * captions are exactly where a wrong claim does damage. UX CF-1: the ▦ "fine-grained
 * grid" badge is driven by the layer manifest, so outside a regional grid's coverage
 * (air quality and transit reachability are Helsinki-bbox only) it asserted ~250 m
 * detail over what is really the postal choropleth. `gridActive={false}` must drop it.
 */
describe('Legend grid badge (CF-1)', () => {
  it('claims grid detail only while cells are actually on screen', () => {
    const { rerender } = render(<Legend layerId="air_quality" gridActive />);
    expect(screen.getByText(t('grid.scope_regional'))).toBeInTheDocument();

    rerender(<Legend layerId="air_quality" gridActive={false} />);
    expect(screen.queryByText(t('grid.scope_regional'))).toBeNull();
    expect(screen.queryByText(t('grid.scope_national'))).toBeNull();
  });

  it('labels a nationwide grid as nationwide', () => {
    render(<Legend layerId="light_pollution" gridActive />);
    expect(screen.getByText(t('grid.scope_national'))).toBeInTheDocument();
  });

  it('never shows a grid badge for a layer with no grid', () => {
    render(<Legend layerId="median_income" />);
    expect(screen.queryByText(t('grid.scope_regional'))).toBeNull();
    expect(screen.queryByText(t('grid.scope_national'))).toBeNull();
  });

  it('replaces the badge with an honest warning when the grid fetch failed', () => {
    render(<Legend layerId="air_quality" gridActive gridError />);
    expect(screen.getByText(t('grid.unavailable'))).toBeInTheDocument();
    expect(screen.queryByText(t('grid.scope_regional'))).toBeNull();
  });

  it('shows a spinner caption while the grid is still fetching', () => {
    render(<Legend layerId="air_quality" gridLoading />);
    expect(screen.getByText(t('grid.loading'))).toBeInTheDocument();
  });

  it('says so when an active filter cannot apply to grid cells', () => {
    render(<Legend layerId="air_quality" gridActive gridFilterInactive />);
    expect(screen.getByText(t('grid.filter_inactive'))).toBeInTheDocument();
  });

  it('does not show the filter note when the grid is inactive', () => {
    render(<Legend layerId="air_quality" gridActive={false} gridFilterInactive />);
    expect(screen.queryByText(t('grid.filter_inactive'))).toBeNull();
  });
});

describe('Legend other captions', () => {
  it('explains the hatched sub-region estimate fills when they are in use', () => {
    const { rerender } = render(<Legend layerId="property_price" />);
    const note = t('legend.subregion_estimate');
    expect(screen.queryByText(note)).toBeNull();
    rerender(<Legend layerId="property_price" subregionEstimate />);
    expect(screen.getByText(note)).toBeInTheDocument();
  });

  it('renders the layer label and both range ends', () => {
    render(<Legend layerId="median_income" />);
    expect(screen.getByText(t('layer.median_income'))).toBeInTheDocument();
  });

  it('stays mounted but hidden when a panel covers it', () => {
    const { container } = render(<Legend layerId="median_income" hidden />);
    // `hidden` is a mobile-only suppression: the element must still exist for md+.
    expect(container.querySelector('.hidden')).not.toBeNull();
  });
});
