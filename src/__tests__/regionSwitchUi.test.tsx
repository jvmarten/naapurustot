import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { RegionSwitchPrompt, RegionChips } from '../components/RegionSwitch';
import { CitySelector } from '../components/CitySelector';
import { TooltipOverlay } from '../components/TooltipOverlay';
import { setTooltipData, type TooltipData } from '../utils/tooltipStore';
import { getLayerById } from '../utils/colorScales';
import { REGION_IDS } from '../utils/regions';
import { t, setLang } from '../utils/i18n';
import type { NeighborhoodProperties } from '../utils/metrics';

/**
 * Region switching + multi-region view, UI side. Uses the real t() (Finnish by
 * default, en/sv preloaded by setup.ts), like dropdownKeyboardA11y.test.tsx, so the
 * assertions pin the strings a user actually sees and the {city} substitution.
 */

const name = (id: string) => t('city.' + id);
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ─── RegionSwitchPrompt ────────────────────────────────────────────────────────

describe('RegionSwitchPrompt', () => {
  function renderPrompt(overrides: Partial<Parameters<typeof RegionSwitchPrompt>[0]> = {}) {
    const props = {
      region: 'lahti',
      shownCount: 1,
      onSwitch: vi.fn(),
      onAdd: vi.fn(),
      onClose: vi.fn(),
      ...overrides,
    };
    const utils = render(<RegionSwitchPrompt {...props} />);
    return { ...utils, props };
  }

  it('shows the tapped region by its localized name, not its id', () => {
    renderPrompt({ region: 'lahti' });
    expect(name('lahti')).not.toBe('city.lahti'); // the key resolves in fi.json
    expect(screen.getByText(name('lahti'))).toBeInTheDocument();
    expect(screen.queryByText('lahti')).toBeNull();
  });

  it('is a group labelled by the region name (not a dialog)', () => {
    renderPrompt({ region: 'turku' });
    const group = screen.getByRole('group', { name: name('turku') });
    expect(group).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    // The labelling element really is the name span, so a new tap re-labels it.
    const labelId = group.getAttribute('aria-labelledby');
    expect(labelId).toBeTruthy();
    expect(document.getElementById(labelId!)?.textContent).toBe(name('turku'));
  });

  it('follows a new region when re-rendered for a different tap', () => {
    const { rerender, props } = renderPrompt({ region: 'lahti' });
    rerender(<RegionSwitchPrompt {...props} region="tampere" />);
    expect(screen.getByRole('group', { name: name('tampere') })).toBeInTheDocument();
    expect(screen.queryByText(name('lahti'))).toBeNull();
  });

  it('does not take focus from the map when it appears', () => {
    const map = document.createElement('button');
    map.textContent = 'map';
    document.body.appendChild(map);
    map.focus();
    try {
      renderPrompt();
      expect(document.activeElement).toBe(map);
    } finally {
      map.remove();
    }
  });

  it('switch button calls onSwitch only', () => {
    const { props } = renderPrompt();
    const btn = screen.getByRole('button', { name: t('region_switch.switch') });
    expect(btn).toHaveAttribute('type', 'button');
    fireEvent.click(btn);
    expect(props.onSwitch).toHaveBeenCalledTimes(1);
    expect(props.onAdd).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it('offers "show both" when exactly one region is on the map, and it calls onAdd', () => {
    const { props } = renderPrompt({ shownCount: 1 });
    expect(screen.queryByRole('button', { name: t('region_switch.add') })).toBeNull();
    const btn = screen.getByRole('button', { name: t('region_switch.show_both') });
    fireEvent.click(btn);
    expect(props.onAdd).toHaveBeenCalledTimes(1);
    expect(props.onSwitch).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it.each([2, 3, 5])('offers "add to map" when %i regions are already shown', (shownCount) => {
    const { props } = renderPrompt({ shownCount });
    expect(screen.queryByRole('button', { name: t('region_switch.show_both') })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: t('region_switch.add') }));
    expect(props.onAdd).toHaveBeenCalledTimes(1);
    expect(props.onSwitch).not.toHaveBeenCalled();
  });

  it('the two action labels are distinct strings (the count branch is visible)', () => {
    expect(t('region_switch.show_both')).not.toBe(t('region_switch.add'));
    expect(t('region_switch.show_both')).not.toBe('region_switch.show_both');
    expect(t('region_switch.add')).not.toBe('region_switch.add');
  });

  it('close button is labelled with aria.close and calls onClose only', () => {
    const { props } = renderPrompt();
    const close = screen.getByRole('button', { name: t('aria.close') });
    expect(close).toHaveAttribute('aria-label', t('aria.close'));
    fireEvent.click(close);
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(props.onSwitch).not.toHaveBeenCalled();
    expect(props.onAdd).not.toHaveBeenCalled();
  });

  it('renders exactly three buttons: close, switch, add/show-both', () => {
    renderPrompt();
    const group = screen.getByRole('group');
    expect(within(group).getAllByRole('button')).toHaveLength(3);
  });
});

// ─── RegionChips ───────────────────────────────────────────────────────────────

describe('RegionChips', () => {
  afterEach(() => {
    act(() => { void setLang('fi'); });
  });

  it('renders one chip per region, in order, each with its localized name', () => {
    const regions = ['lahti', 'turku', 'tampere'];
    const { container } = render(<RegionChips regions={regions} onRemove={vi.fn()} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(regions.length);
    const text = container.textContent ?? '';
    const positions = regions.map((r) => text.indexOf(name(r)));
    positions.forEach((p) => expect(p).toBeGreaterThanOrEqual(0));
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('labels each remove button with the {city}-substituted string', () => {
    render(<RegionChips regions={['lahti', 'oulu']} onRemove={vi.fn()} />);
    for (const r of ['lahti', 'oulu']) {
      const expected = t('region_switch.remove').replace('{city}', name(r));
      const btn = screen.getByRole('button', { name: expected });
      expect(btn.getAttribute('aria-label')).not.toContain('{city}');
      expect(btn.getAttribute('aria-label')).toContain(name(r));
    }
  });

  it('clicking a chip\'s remove button calls onRemove with that chip\'s id only', () => {
    const onRemove = vi.fn();
    render(<RegionChips regions={['lahti', 'turku', 'tampere']} onRemove={onRemove} />);
    fireEvent.click(screen.getByRole('button', { name: t('region_switch.remove').replace('{city}', name('turku')) }));
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledWith('turku');
  });

  it('renders nothing clickable for an empty list', () => {
    render(<RegionChips regions={[]} onRemove={vi.fn()} />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('substitutes the name in English too', () => {
    act(() => { void setLang('en'); });
    render(<RegionChips regions={['lahti']} onRemove={vi.fn()} />);
    const label = screen.getByRole('button').getAttribute('aria-label');
    expect(label).toBe(t('region_switch.remove').replace('{city}', t('city.lahti')));
    expect(label).toMatch(/^Remove .+ from the map$/);
    expect(label).not.toContain('{city}');
  });
});

// ─── CitySelector mobile popover: "+" add buttons ─────────────────────────────

describe('CitySelector mobile popover with region add', () => {
  const addLabel = () => t('region_switch.add');

  function openSelector(props: {
    value?: 'all' | (typeof REGION_IDS)[number];
    displayed?: readonly string[];
    onAdd?: (id: (typeof REGION_IDS)[number]) => void;
  } = {}) {
    const onChange = vi.fn();
    const value = props.value ?? 'helsinki_metro';
    render(<CitySelector value={value} onChange={onChange} displayed={props.displayed} onAdd={props.onAdd} />);
    const trigger = screen.getByRole('button', { name: new RegExp('^' + escapeRe(t('city.select')) + ':') });
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    return { onChange, trigger };
  }

  /** The "+" buttons: the only buttons whose accessible name starts with the add label. */
  const plusButtons = () =>
    screen.queryAllByRole('button', { name: new RegExp('^' + escapeRe(addLabel())) });

  /** The main (select) button of a popover row — its name is the region label. */
  const rowButton = (id: string) => screen.getByRole('button', { name: name(id) });

  it('gives a "+" to every region not on the map, and none to shown regions or "all"', () => {
    const displayed = ['helsinki_metro', 'lahti'];
    openSelector({ value: 'helsinki_metro', displayed, onAdd: vi.fn() });
    const plus = plusButtons();
    // Every region except the two displayed; "all" never gets one.
    expect(plus).toHaveLength(REGION_IDS.length - displayed.length);
    const labels = plus.map((b) => b.getAttribute('aria-label') ?? '');
    for (const id of displayed) {
      expect(labels.some((l) => l.endsWith(name(id)))).toBe(false);
    }
    expect(labels.some((l) => l.includes(t('city.all')))).toBe(false);
    expect(labels.some((l) => l.endsWith(name('turku')))).toBe(true);
    plus.forEach((b) => expect(b.textContent).toBe('+'));
  });

  it('"+" aria-label names both the action and the region', () => {
    openSelector({ onAdd: vi.fn(), displayed: ['helsinki_metro'] });
    const btn = screen.getByRole('button', { name: `${addLabel()}: ${name('turku')}` });
    const label = btn.getAttribute('aria-label') ?? '';
    expect(label).toContain(addLabel());
    expect(label).toContain(name('turku'));
  });

  it('clicking "+" calls onAdd(id), closes the popover and does not call onChange', () => {
    const onAdd = vi.fn();
    const { onChange, trigger } = openSelector({ onAdd, displayed: ['helsinki_metro'] });
    fireEvent.click(screen.getByRole('button', { name: `${addLabel()}: ${name('turku')}` }));
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd).toHaveBeenCalledWith('turku');
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByPlaceholderText(t('city.filter_placeholder'))).toBeNull();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('re-picking the primary while other regions are shown only closes the list (no collapse)', () => {
    const { onChange, trigger } = openSelector({ value: 'helsinki_metro', displayed: ['helsinki_metro', 'lahti'], onAdd: vi.fn() });
    fireEvent.click(rowButton('helsinki_metro'));
    expect(onChange).not.toHaveBeenCalled();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('re-picking the primary in a single-region view still re-centres (onChange)', () => {
    const { onChange } = openSelector({ value: 'helsinki_metro', displayed: ['helsinki_metro'], onAdd: vi.fn() });
    fireEvent.click(rowButton('helsinki_metro'));
    expect(onChange).toHaveBeenCalledWith('helsinki_metro');
  });

  it('marks every region on the map with aria-current, and only those', () => {
    openSelector({ value: 'helsinki_metro', displayed: ['helsinki_metro', 'lahti'], onAdd: vi.fn() });
    expect(rowButton('helsinki_metro')).toHaveAttribute('aria-current', 'true');
    expect(rowButton('lahti')).toHaveAttribute('aria-current', 'true');
    expect(rowButton('turku')).not.toHaveAttribute('aria-current');
  });

  it('clicking the row itself still switches (onChange) and never adds', () => {
    const onAdd = vi.fn();
    const { onChange } = openSelector({ onAdd, displayed: ['helsinki_metro'] });
    fireEvent.click(rowButton('turku'));
    expect(onChange).toHaveBeenCalledWith('turku');
    expect(onAdd).not.toHaveBeenCalled();
    expect(screen.queryByPlaceholderText(t('city.filter_placeholder'))).toBeNull();
  });

  it('styles the value and every displayed region as current, and nothing else', () => {
    const displayed = ['helsinki_metro', 'lahti', 'tampere'];
    openSelector({ value: 'helsinki_metro', displayed, onAdd: vi.fn() });
    for (const id of displayed) {
      expect(rowButton(id).className).toContain('bg-brand-500/15');
    }
    expect(rowButton('turku').className).not.toContain('bg-brand-500/15');
    expect(rowButton('oulu').className).not.toContain('bg-brand-500/15');
    expect(screen.getByRole('button', { name: t('city.all') }).className).not.toContain('bg-brand-500/15');
  });

  it('treats the value as shown even when displayed is omitted', () => {
    openSelector({ value: 'tampere', onAdd: vi.fn() });
    expect(rowButton('tampere').className).toContain('bg-brand-500/15');
    expect(screen.queryByRole('button', { name: `${addLabel()}: ${name('tampere')}` })).toBeNull();
    // Every other region is addable.
    expect(plusButtons()).toHaveLength(REGION_IDS.length - 1);
  });

  it('without onAdd there are no "+" buttons at all', () => {
    openSelector({ value: 'helsinki_metro', displayed: ['helsinki_metro', 'lahti'] });
    expect(plusButtons()).toHaveLength(0);
    expect(screen.queryAllByText('+')).toHaveLength(0);
    // Displayed regions are still marked current (the list is informative either way).
    expect(rowButton('lahti').className).toContain('bg-brand-500/15');
  });

  it('the filter narrows the "+" buttons along with the rows', () => {
    openSelector({ value: 'helsinki_metro', displayed: ['helsinki_metro'], onAdd: vi.fn() });
    fireEvent.change(screen.getByPlaceholderText(t('city.filter_placeholder')), {
      target: { value: name('lahti') },
    });
    const plus = plusButtons();
    expect(plus).toHaveLength(1);
    expect(plus[0].getAttribute('aria-label')).toBe(`${addLabel()}: ${name('lahti')}`);
  });

  it('a filtered-to-shown region shows its row but no "+"', () => {
    openSelector({ value: 'helsinki_metro', displayed: ['helsinki_metro', 'lahti'], onAdd: vi.fn() });
    fireEvent.change(screen.getByPlaceholderText(t('city.filter_placeholder')), {
      target: { value: name('lahti') },
    });
    expect(rowButton('lahti')).toBeInTheDocument();
    expect(plusButtons()).toHaveLength(0);
  });
});

// ─── TooltipOverlay: per-region "vs. avg" baseline ────────────────────────────

describe('TooltipOverlay per-region averages', () => {
  const layer = getLayerById('median_income');
  const prop = layer.property; // 'hr_mtu'
  const vsAvg = () => new RegExp(escapeRe(t('tooltip.vs_avg')));

  function hover(city: string | null, value: number | null, extra: Partial<TooltipData> = {}): TooltipData {
    return {
      props: { pno: '00100', nimi: 'Testialue', city, [prop]: value } as unknown as NeighborhoodProperties,
      x: 100,
      y: 100,
      ...extra,
    };
  }

  /** The comparison line's text, or null when the tooltip shows none. */
  const comparison = () => screen.queryByText(vsAvg())?.textContent ?? null;

  // Blended (union) average 30,000; each region's own average differs from it.
  const METRO = 30000;
  const REGION_AVGS = {
    helsinki_metro: { [prop]: 20000 },
    lahti: { [prop]: 40000 },
  };

  beforeEach(() => {
    setTooltipData(null);
  });

  it('compares an area with its own region, not the blend of the map', () => {
    // 30,000 vs the blend would be 0% (no comparison line); vs Lahti's 40,000 it is −25%.
    setTooltipData(hover('lahti', 30000));
    render(<TooltipOverlay hidden={false} effectiveLayer={layer} metroAverage={METRO} regionAverages={REGION_AVGS} />);
    expect(screen.getByText('Testialue')).toBeInTheDocument();
    expect(comparison()).toContain('-25%');
    expect(comparison()).toContain('▼');
  });

  it('switches baseline as the pointer moves to an area in another region', () => {
    setTooltipData(hover('lahti', 30000));
    render(<TooltipOverlay hidden={false} effectiveLayer={layer} metroAverage={METRO} regionAverages={REGION_AVGS} />);
    expect(comparison()).toContain('-25%');
    act(() => { setTooltipData(hover('helsinki_metro', 30000)); });
    // vs Helsinki's 20,000: +50%.
    expect(comparison()).toContain('+50%');
    expect(comparison()).toContain('▲');
  });

  it('without regionAverages the blended metroAverage is used (single-region behaviour)', () => {
    setTooltipData(hover('lahti', 36000));
    render(<TooltipOverlay hidden={false} effectiveLayer={layer} metroAverage={METRO} regionAverages={null} />);
    expect(comparison()).toContain('+20%');
  });

  it('falls back to metroAverage for a region missing from regionAverages', () => {
    setTooltipData(hover('turku', 36000));
    render(<TooltipOverlay hidden={false} effectiveLayer={layer} metroAverage={METRO} regionAverages={REGION_AVGS} />);
    expect(comparison()).toContain('+20%');
  });

  it('falls back to metroAverage when the region has no average for this property', () => {
    setTooltipData(hover('lahti', 36000));
    render(
      <TooltipOverlay
        hidden={false}
        effectiveLayer={layer}
        metroAverage={METRO}
        regionAverages={{ lahti: { some_other_prop: 1 } }}
      />,
    );
    expect(comparison()).toContain('+20%');
  });

  it('falls back to metroAverage for an area with no city', () => {
    setTooltipData(hover(null, 36000));
    render(<TooltipOverlay hidden={false} effectiveLayer={layer} metroAverage={METRO} regionAverages={REGION_AVGS} />);
    expect(comparison()).toContain('+20%');
  });

  it('a region average of 0 is kept (nullish fallback), so no comparison is drawn rather than the blend', () => {
    setTooltipData(hover('lahti', 36000));
    render(
      <TooltipOverlay hidden={false} effectiveLayer={layer} metroAverage={METRO} regionAverages={{ lahti: { [prop]: 0 } }} />,
    );
    // Tooltip suppresses a comparison against a zero baseline; +20% would mean the
    // blend leaked in over the region's own (zero) average.
    expect(comparison()).toBeNull();
  });

  it('suppresses the comparison over a grid cell even with region averages', () => {
    setTooltipData(hover('lahti', 30000, { gridValue: 12345 }));
    render(<TooltipOverlay hidden={false} effectiveLayer={layer} metroAverage={METRO} regionAverages={REGION_AVGS} />);
    expect(screen.getByText(t('tooltip.cell_value'))).toBeInTheDocument();
    expect(comparison()).toBeNull();
  });

  it('suppresses the comparison when showing the price fallback estimate', () => {
    setTooltipData(hover('lahti', null));
    render(
      <TooltipOverlay
        hidden={false}
        effectiveLayer={layer}
        metroAverage={METRO}
        priceFallbackValue={50000}
        regionAverages={REGION_AVGS}
      />,
    );
    expect(screen.getByText(t('data.subregion_estimate'))).toBeInTheDocument();
    expect(comparison()).toBeNull();
  });

  it('renders nothing while hidden (an area is selected)', () => {
    setTooltipData(hover('lahti', 30000));
    const { container } = render(
      <TooltipOverlay hidden effectiveLayer={layer} metroAverage={METRO} regionAverages={REGION_AVGS} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when the store is empty', () => {
    const { container } = render(
      <TooltipOverlay hidden={false} effectiveLayer={layer} metroAverage={METRO} regionAverages={REGION_AVGS} />,
    );
    expect(container.firstChild).toBeNull();
    act(() => { setTooltipData(hover('lahti', 30000)); });
    expect(screen.getByText('Testialue')).toBeInTheDocument();
    act(() => { setTooltipData(null); });
    expect(container.firstChild).toBeNull();
  });
});

// ─── Desktop add path: a button list, never options inside the switch select ────

describe('CitySelector desktop add path', () => {
  const select = () => screen.getByRole('combobox', { name: t('city.select') });

  it('the native switch select carries no add options, even with onAdd (arrow keys must never add)', () => {
    const onChange = vi.fn();
    const onAdd = vi.fn();
    render(<CitySelector value="helsinki_metro" onChange={onChange} displayed={['helsinki_metro']} onAdd={onAdd} />);
    expect(within(select()).queryByRole('group')).toBeNull();
    const values = within(select()).getAllByRole('option').map((o) => (o as HTMLOptionElement).value);
    expect(values.some((v) => v.startsWith('+'))).toBe(false);
    fireEvent.change(select(), { target: { value: 'turku' } });
    expect(onChange).toHaveBeenCalledWith('turku');
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('addOnly renders just an "add to map" button — no select', () => {
    render(<CitySelector addOnly value="helsinki_metro" onChange={vi.fn()} displayed={['helsinki_metro']} onAdd={vi.fn()} />);
    expect(screen.queryByRole('combobox', { name: t('city.select') })).toBeNull();
    expect(screen.getByRole('button', { name: `+ ${t('region_switch.add')}` })).toHaveAttribute('aria-expanded', 'false');
  });

  it('its list offers only regions not on the map, and a pick adds (never switches) and closes', () => {
    const onChange = vi.fn();
    const onAdd = vi.fn();
    render(<CitySelector addOnly value="helsinki_metro" onChange={onChange} displayed={['helsinki_metro', 'lahti']} onAdd={onAdd} />);
    const trigger = screen.getByRole('button', { name: `+ ${t('region_switch.add')}` });
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.queryByRole('button', { name: name('helsinki_metro') })).toBeNull();
    expect(screen.queryByRole('button', { name: name('lahti') })).toBeNull();
    expect(screen.queryByRole('button', { name: t('city.all') })).toBeNull();
    // No nested "+" buttons in the add list: the row itself is the add.
    expect(screen.queryAllByRole('button', { name: new RegExp('^' + escapeRe(t('region_switch.add')) + ':') })).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: name('turku') }));
    expect(onAdd).toHaveBeenCalledWith('turku');
    expect(onChange).not.toHaveBeenCalled();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });
});

// ─── Chip removal keeps keyboard focus ───────────────────────────────────────────

describe('RegionChips focus handoff', () => {
  it('removing a chip moves focus to the next chip\'s remove button', () => {
    const onRemove = vi.fn();
    render(<RegionChips regions={['lahti', 'turku']} onRemove={onRemove} />);
    const remove = (id: string) => screen.getByRole('button', { name: t('region_switch.remove').replace('{city}', name(id)) });
    remove('lahti').focus();
    fireEvent.click(remove('lahti'));
    expect(onRemove).toHaveBeenCalledWith('lahti');
    expect(document.activeElement).toBe(remove('turku'));
  });

  it('removing the last chip moves focus to the previous one', () => {
    render(<RegionChips regions={['lahti', 'turku']} onRemove={vi.fn()} />);
    const remove = (id: string) => screen.getByRole('button', { name: t('region_switch.remove').replace('{city}', name(id)) });
    fireEvent.click(remove('turku'));
    expect(document.activeElement).toBe(remove('lahti'));
  });
});
