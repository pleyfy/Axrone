import { describe, expect, it } from 'vitest';
import {
    AXRONE_DEFAULT_UI_FONT_FAMILY,
    UIRuntime,
    getDropdownSelectedIndex,
} from '../index';
import { dropdownController } from '../controls/dropdown-controller';
import { createTestFontAsset } from './test-font';
import type { UIAsset, WidgetId } from '../types';

const textBlock = (value: string, size = 14) => ({
    value,
    family: AXRONE_DEFAULT_UI_FONT_FAMILY,
    size,
    weight: '400',
    style: 'normal',
    lineHeight: size * 1.3,
    letterSpacing: 0,
    align: 'start',
    wrap: 'word',
    overflow: 'ellipsis',
});

const itemRow = (rootKey: string, index: number, label: string) => ({
    role: 'custom:dropdown-item',
    key: `${rootKey}-item-${index}`,
    enabled: true,
    interactive: false,
    layout: { width: '100%', height: 32, padding: 8 },
    style: { background: '#00000000', radius: 4 },
    children: [
        {
            role: 'text',
            key: `${rootKey}-item-${index}-text`,
            enabled: true,
            interactive: false,
            layout: { width: 'content', height: 'content' },
            style: { color: '#e2e8f0ff' },
            text: textBlock(label),
            children: [],
        },
    ],
});

const buildModernDropdownAsset = (): UIAsset =>
    ({
        id: 'test-drp-modern',
        name: 'test-drp-modern',
        version: 1,
        canvas: {
            referenceWidth: 800,
            referenceHeight: 600,
            scaleMode: 'match-width-or-height',
            matchBias: 0.5,
        },
        bindings: {
            root: 'root',
            'drp-1': 'drp-1',
            'drp-1-trigger': 'drp-1-trigger',
            'drp-1-trigger-label': 'drp-1-trigger-label',
            'drp-1-chevron': 'drp-1-chevron',
            'drp-1-popup': 'drp-1-popup',
            'drp-1-items': 'drp-1-items',
            'drp-1-item-0': 'drp-1-item-0',
            'drp-1-item-0-text': 'drp-1-item-0-text',
            'drp-1-item-1': 'drp-1-item-1',
            'drp-1-item-1-text': 'drp-1-item-1-text',
            'drp-1-item-2': 'drp-1-item-2',
            'drp-1-item-2-text': 'drp-1-item-2-text',
        },
        root: {
            role: 'root',
            key: 'root',
            enabled: true,
            interactive: false,
            layout: { display: 'overlay', width: 800, height: 600 },
            children: [
                {
                    role: 'custom:dropdown',
                    key: 'drp-1',
                    enabled: true,
                    interactive: true,
                    controller: 'dropdown-select',
                    props: {
                        selectedIndex: 0,
                        options: ['Option 1', 'Option 2', 'Option 3'],
                        triggerContainerKey: 'drp-1-trigger',
                        triggerKey: 'drp-1-trigger-label',
                        popupKey: 'drp-1-popup',
                        itemContainerKey: 'drp-1-items',
                        chevronKey: 'drp-1-chevron',
                        placeholder: 'Select…',
                        fieldHeight: 36,
                        cornerRadius: 6,
                        itemHeight: 32,
                        panelRadius: 8,
                        arrowSize: 12,
                        arrowColor: '#94a3b8ff',
                        hoverColor: '#ff0000ff',
                        selectedColor: '#00ff00ff',
                        states: { normal: '#111111ff', hover: '#333333ff', open: '#222222ff', disabled: '#444444ff' },
                    },
                    layout: {
                        width: 200,
                        height: 'content',
                        display: 'stack',
                        direction: 'column',
                        gap: 4,
                    },
                    children: [
                        {
                            role: 'container',
                            key: 'drp-1-trigger',
                            enabled: true,
                            interactive: false,
                            layout: {
                                width: '100%',
                                height: 36,
                                direction: 'row',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                            },
                            style: { background: '#1e293bff', radius: 6 },
                            children: [
                                {
                                    role: 'text',
                                    key: 'drp-1-trigger-label',
                                    enabled: true,
                                    interactive: false,
                                    layout: { width: 'content', height: 'content' },
                                    style: { color: '#e2e8f0ff' },
                                    text: textBlock('Option 1'),
                                    children: [],
                                },
                                {
                                    role: 'text',
                                    key: 'drp-1-chevron',
                                    enabled: true,
                                    interactive: false,
                                    layout: { width: 'content', height: 'content' },
                                    style: { color: '#94a3b8ff' },
                                    text: textBlock('▾', 12),
                                    children: [],
                                },
                            ],
                        },
                        {
                            role: 'container',
                            key: 'drp-1-popup',
                            enabled: false,
                            interactive: false,
                            layout: {
                                width: '100%',
                                height: 'content',
                                display: 'stack',
                                direction: 'column',
                                gap: 2,
                                padding: 4,
                            },
                            style: {
                                background: '#1e293bff',
                                borderColor: '#334155ff',
                                borderWidth: 1,
                                radius: 8,
                            },
                            children: [
                                {
                                    role: 'container',
                                    key: 'drp-1-items',
                                    enabled: true,
                                    interactive: false,
                                    layout: {
                                        width: '100%',
                                        height: 'content',
                                        display: 'stack',
                                        direction: 'column',
                                        gap: 2,
                                    },
                                    children: [
                                        itemRow('drp-1', 0, 'Option 1'),
                                        itemRow('drp-1', 1, 'Option 2'),
                                        itemRow('drp-1', 2, 'Option 3'),
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
    }) as unknown as UIAsset;

const buildLegacyDropdownAsset = (): UIAsset => {
    const asset = buildModernDropdownAsset();
    const root = asset.root as unknown as Record<string, unknown>;
    const dropdown = (root.children as Record<string, unknown>[])[0]!;
    const popup = (dropdown.children as Record<string, unknown>[])[1]!;
    const items = ((popup.children as Record<string, unknown>[])[0]!
        .children as Record<string, unknown>[]);
    popup.children = items;
    (popup.layout as Record<string, unknown>).position = 'absolute';
    (popup.layout as Record<string, unknown>).inset = { top: 40, left: 0 };
    const props = dropdown.props as Record<string, unknown>;
    delete props.itemContainerKey;
    delete props.triggerContainerKey;
    delete (asset.bindings as Record<string, string>)['drp-1-items'];
    return asset;
};

const prepareRuntime = () => {
    const runtime = new UIRuntime({ width: 800, height: 600 });
    runtime.fonts.registerFace(createTestFontAsset(AXRONE_DEFAULT_UI_FONT_FAMILY));
    runtime.registry.register(dropdownController);
    return runtime;
};

const frameTexts = (runtime: UIRuntime) =>
    runtime
        .commit()
        .commands.filter((c) => c.kind === 'text')
        .map((c) => (c.kind === 'text' ? c.layout.text : ''));

const pointerAtCenter = (
    runtime: UIRuntime,
    widget: WidgetId,
    phase: 'down' | 'move' | 'up',
) => {
    const box = runtime.getLayoutBox(widget);
    return {
        type: 'pointer' as const,
        phase,
        x: box.x + box.width / 2,
        y: box.y + box.height / 2,
    };
};

describe('dropdown-select controller (preview open/close/select)', () => {
    it('hides the popup while closed instead of painting it always open', () => {
        const runtime = prepareRuntime();
        runtime.loadFromAsset(buildModernDropdownAsset());

        const texts = frameTexts(runtime);
        expect(texts).toContain('Option 1');
        expect(texts).not.toContain('Option 2');
        expect(texts).not.toContain('Option 3');

        const popup = runtime.getBoundWidget('drp-1-popup')!;
        expect(runtime.getWidgetStyleInput(popup)?.visible).toBe(false);
    });

    it('toggles open on trigger press and selects the hovered row on release', () => {
        const runtime = prepareRuntime();
        runtime.loadFromAsset(buildModernDropdownAsset());
        const dropdown = runtime.getBoundWidget('drp-1')!;
        const trigger = runtime.getBoundWidget('drp-1-trigger')!;
        const item1 = runtime.getBoundWidget('drp-1-item-1')!;

        runtime.dispatchInput(pointerAtCenter(runtime, trigger, 'down'));
        let texts = frameTexts(runtime);
        expect(texts).toContain('Option 2');
        expect(texts).toContain('Option 3');
        expect(runtime.getWidgetStyleInput(runtime.getBoundWidget('drp-1-popup')!)?.visible).toBe(
            true,
        );

        runtime.dispatchInput(pointerAtCenter(runtime, item1, 'move'));
        runtime.dispatchInput(pointerAtCenter(runtime, item1, 'up'));

        expect(getDropdownSelectedIndex(runtime, dropdown)).toBe(1);
        texts = frameTexts(runtime);
        expect(texts).toContain('Option 2');
        expect(texts).not.toContain('Option 3');
        expect(
            runtime.getWidgetStyleInput(runtime.getBoundWidget('drp-1-popup')!)?.visible,
        ).toBe(false);
    });

    it('honours hover/selected colors and appearance props', () => {
        const runtime = prepareRuntime();
        runtime.loadFromAsset(buildModernDropdownAsset());
        const trigger = runtime.getBoundWidget('drp-1-trigger')!;
        const item0 = runtime.getBoundWidget('drp-1-item-0')!;
        const item1 = runtime.getBoundWidget('drp-1-item-1')!;

        runtime.commit();
        expect(runtime.getLayoutBox(trigger).height).toBeCloseTo(36, 5);

        runtime.dispatchInput(pointerAtCenter(runtime, trigger, 'down'));
        runtime.commit();
        expect(runtime.getLayoutBox(item0).height).toBeCloseTo(32, 5);

        runtime.dispatchInput(pointerAtCenter(runtime, item1, 'move'));
        runtime.commit();

        expect(runtime.getWidgetStyleInput(item1)?.background).toBe('#ff0000ff');
        expect(runtime.getWidgetStyleInput(item0)?.background).toBe('#00ff00ff');
    });

    it('resolves items through the popup fallback for legacy assets', () => {
        const runtime = prepareRuntime();
        runtime.loadFromAsset(buildLegacyDropdownAsset());
        const dropdown = runtime.getBoundWidget('drp-1')!;
        const trigger = runtime.getBoundWidget('drp-1-trigger')!;
        const item0 = runtime.getBoundWidget('drp-1-item-0')!;

        expect(frameTexts(runtime)).not.toContain('Option 2');

        runtime.dispatchInput(pointerAtCenter(runtime, trigger, 'down'));
        expect(frameTexts(runtime)).toContain('Option 2');

        runtime.dispatchInput(pointerAtCenter(runtime, item0, 'move'));
        runtime.dispatchInput(pointerAtCenter(runtime, item0, 'up'));
        expect(getDropdownSelectedIndex(runtime, dropdown)).toBe(0);
    });

    it('rebuilds the item cache after a same-size item swap', () => {
        const runtime = prepareRuntime();
        runtime.loadFromAsset(buildModernDropdownAsset());
        const dropdown = runtime.getBoundWidget('drp-1')!;
        const trigger = runtime.getBoundWidget('drp-1-trigger')!;
        const items = runtime.getBoundWidget('drp-1-items')!;
        const staleItem = runtime.getBoundWidget('drp-1-item-1')!;

        runtime.dispatchInput(pointerAtCenter(runtime, trigger, 'down'));
        runtime.dispatchInput(pointerAtCenter(runtime, trigger, 'down'));

        runtime.removeWidget(staleItem);
        const replacement = runtime.createWidget({
            role: 'custom:dropdown-item',
            layout: { width: '100%', height: 32, padding: 8 },
            style: { background: '#00000000', radius: 4 },
        });
        const replacementText = runtime.createWidget({
            role: 'text',
            layout: { width: 'content', height: 'content' },
            style: { color: '#e2e8f0ff' },
        });
        runtime.appendChild(replacement, replacementText);
        runtime.appendChild(items, replacement);
        runtime.commit();

        runtime.dispatchInput(pointerAtCenter(runtime, trigger, 'down'));
        runtime.commit();
        runtime.dispatchInput(pointerAtCenter(runtime, replacement, 'move'));
        runtime.dispatchInput(pointerAtCenter(runtime, replacement, 'up'));

        expect(getDropdownSelectedIndex(runtime, dropdown)).toBe(2);
    });

    it('applies an externally committed selectedIndex to the trigger label', () => {
        const runtime = prepareRuntime();
        runtime.loadFromAsset(buildModernDropdownAsset());
        const dropdown = runtime.getBoundWidget('drp-1')!;

        runtime.updateWidget(dropdown, { props: { selectedIndex: 2 } });
        expect(getDropdownSelectedIndex(runtime, dropdown)).toBe(2);
        const texts = frameTexts(runtime);
        expect(texts.filter((t) => t === 'Option 3')).toHaveLength(1);
    });

    it('applies hover tint on enter and restores normal on leave', () => {
        const runtime = prepareRuntime();
        runtime.loadFromAsset(buildModernDropdownAsset());
        const triggerBox = runtime.getBoundWidget('drp-1-trigger')!;

        runtime.commit();
        expect(runtime.getWidgetStyleInput(triggerBox)?.background).toBe('#111111ff');

        runtime.dispatchInput(pointerAtCenter(runtime, triggerBox, 'move'));
        runtime.commit();
        expect(runtime.getWidgetStyleInput(triggerBox)?.background).toBe('#333333ff');

        runtime.dispatchInput({ type: 'pointer', phase: 'move', x: 799, y: 599 });
        runtime.commit();
        expect(runtime.getWidgetStyleInput(triggerBox)?.background).toBe('#111111ff');
    });

    it('applies disabled tint when the dropdown is disabled', () => {
        const runtime = prepareRuntime();
        const asset = buildModernDropdownAsset();
        const root = asset.root as unknown as Record<string, unknown>;
        const dropdownNode = (root.children as Record<string, unknown>[])[0]!;
        dropdownNode.enabled = false;
        runtime.loadFromAsset(asset);
        runtime.commit();

        const triggerBox = runtime.getBoundWidget('drp-1-trigger')!;
        expect(runtime.getWidgetStyleInput(triggerBox)?.background).toBe('#444444ff');
    });
});
