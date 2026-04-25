import type { AnchorInput, WidgetLayoutInput } from '../types';

export const createStackLayout = (
    direction: 'row' | 'column' = 'column',
    gap = 0,
    overrides: WidgetLayoutInput = {}
): WidgetLayoutInput => ({
    display: 'stack',
    direction,
    gap,
    ...overrides,
});

export const createOverlayLayout = (overrides: WidgetLayoutInput = {}): WidgetLayoutInput => ({
    display: 'overlay',
    ...overrides,
});

export const createAnchoredLayout = (
    anchor: AnchorInput = 'top-left',
    overrides: WidgetLayoutInput = {}
): WidgetLayoutInput => ({
    position: 'absolute',
    anchor,
    ...overrides,
});