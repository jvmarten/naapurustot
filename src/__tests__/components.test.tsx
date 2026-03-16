import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Legend } from '../components/Legend';
import { Tooltip } from '../components/Tooltip';
import { LayerSelector } from '../components/LayerSelector';
import { LAYERS } from '../utils/colorScales';

// Mock i18n to return the key for predictable testing
vi.mock('../utils/i18n', () => ({
  t: (key: string) => key,
  setLang: vi.fn(),
  getLang: () => 'fi' as const,
}));

describe('Legend', () => {
  it('renders color swatches for each stop', () => {
    const { container } = render(<Legend layerId="quality_index" />);
    const layer = LAYERS.find((l) => l.id === 'quality_index')!;
    const swatches = container.querySelectorAll('[style]');
    // Each color swatch has a backgroundColor style
    const colorDivs = Array.from(swatches).filter((el) =>
      (el as HTMLElement).style.backgroundColor
    );
    expect(colorDivs.length).toBe(layer.colors.length);
  });

  it('displays the layer label key', () => {
    render(<Legend layerId="median_income" />);
    expect(screen.getByText('layer.median_income')).toBeInTheDocument();
  });

  it('displays min and max formatted values', () => {
    const { container } = render(<Legend layerId="quality_index" />);
    const texts = container.textContent;
    // quality_index format: "X / 100"
    expect(texts).toContain('0 / 100');
    expect(texts).toContain('100 / 100');
  });
});

describe('Tooltip', () => {
  it('renders neighborhood name', () => {
    render(<Tooltip x={100} y={200} name="Kallio" value={75} layerId="quality_index" />);
    expect(screen.getByText('Kallio')).toBeInTheDocument();
  });

  it('renders formatted value', () => {
    render(<Tooltip x={100} y={200} name="Kallio" value={75} layerId="quality_index" />);
    expect(screen.getByText('75 / 100')).toBeInTheDocument();
  });

  it('renders em dash for null value', () => {
    render(<Tooltip x={100} y={200} name="Kallio" value={null} layerId="quality_index" />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('positions tooltip based on x and y props', () => {
    const { container } = render(
      <Tooltip x={150} y={250} name="Test" value={50} layerId="quality_index" />
    );
    const tooltip = container.firstChild as HTMLElement;
    expect(tooltip.style.left).toBe('162px'); // x + 12
    expect(tooltip.style.top).toBe('240px');  // y - 10
  });
});

describe('LayerSelector', () => {
  it('renders all layer group headers', () => {
    render(<LayerSelector activeLayer="quality_index" onLayerChange={() => {}} />);
    expect(screen.getByText('layers.quality')).toBeInTheDocument();
    expect(screen.getByText('layers.demographics')).toBeInTheDocument();
    expect(screen.getByText('layers.economy')).toBeInTheDocument();
    expect(screen.getByText('layers.housing')).toBeInTheDocument();
  });

  it('renders layer buttons', () => {
    render(<LayerSelector activeLayer="quality_index" onLayerChange={() => {}} />);
    // Should have a button for each layer
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBe(LAYERS.length);
  });

  it('calls onLayerChange when a layer button is clicked', () => {
    const onLayerChange = vi.fn();
    render(<LayerSelector activeLayer="quality_index" onLayerChange={onLayerChange} />);
    // Click the median income button
    const buttons = screen.getAllByRole('button');
    fireEvent.click(buttons[1]); // Second button in first group or next group
    expect(onLayerChange).toHaveBeenCalled();
  });

  it('highlights the active layer', () => {
    const { container } = render(
      <LayerSelector activeLayer="median_income" onLayerChange={() => {}} />
    );
    // The active button should have the brand color class
    const activeButton = Array.from(container.querySelectorAll('button')).find((btn) =>
      btn.className.includes('bg-brand')
    );
    expect(activeButton).toBeDefined();
    expect(activeButton!.textContent).toContain('layer.median_income');
  });

  it('renders the title', () => {
    render(<LayerSelector activeLayer="quality_index" onLayerChange={() => {}} />);
    expect(screen.getByText('layers.title')).toBeInTheDocument();
  });
});
