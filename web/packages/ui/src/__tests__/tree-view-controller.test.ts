import { describe, expect, it, vi } from 'vitest';
import { AXRONE_DEFAULT_UI_FONT_FAMILY, UIRuntime, getTreeViewExpanded, getTreeViewSelectedIndex } from '../index';
import { treeViewController } from '../controls/tree-view-controller';
import { createTestFontAsset } from './test-font';
import type { UIAsset, WidgetId } from '../types';

const NODE_COUNT = 3;

const textBlock = (value: string) => ({
    value,
    family: AXRONE_DEFAULT_UI_FONT_FAMILY,
    size: 14,
    weight: '400',
    style: 'normal',
    lineHeight: 18.2,
    letterSpacing: 0,
    align: 'start',
    wrap: 'word',
    overflow: 'ellipsis',
});

const treeRow = (prefix: string, index: number) => ({
    role: 'custom:tree-row',
    key: `${prefix}${index}`,
    enabled: true,
    interactive: false,
    layout: { display: 'stack', width: 200, height: 32, direction: 'row', alignItems: 'center', gap: 8, padding: 4 },
    children: [
        {
            role: 'custom:tree-toggle',
            key: `${prefix}${index}-toggle`,
            enabled: true,
            interactive: false,
            layout: { width: 16, height: 16 },
            style: { background: '#334155ff', radius: 4 },
            children: [],
        },
        {
            role: 'text',
            key: `${prefix}${index}-label`,
            enabled: true,
            interactive: false,
            layout: { width: 'content', height: 'content' },
            style: { color: '#e2e8f0ff' },
            text: textBlock(`Node ${index}`),
            children: [],
        },
    ],
});

const treeChildren = (prefix: string, index: number) => ({
    role: 'container',
    key: `${prefix}${index}-children`,
    enabled: true,
    interactive: false,
    layout: { display: 'stack', width: 200, height: 40, direction: 'column', padding: 4 },
    style: { background: '#0f172aff' },
    children: [
        {
            role: 'text',
            key: `${prefix}${index}-child-label`,
            enabled: true,
            interactive: false,
            layout: { width: 'content', height: 'content' },
            style: { color: '#94a3b8ff' },
            text: textBlock(`Child of ${index}`),
            children: [],
        },
    ],
});

const buildTreeAsset = (): UIAsset => {
    const bindings: Record<string, string> = { root: 'root', 'tree-1': 'tree-1' };
    const children: unknown[] = [];
    for (let i = 0; i < NODE_COUNT; i++) {
        bindings[`tree-node-${i}`] = `tree-node-${i}`;
        bindings[`tree-node-${i}-toggle`] = `tree-node-${i}-toggle`;
        bindings[`tree-node-${i}-label`] = `tree-node-${i}-label`;
        bindings[`tree-node-${i}-children`] = `tree-node-${i}-children`;
        bindings[`tree-node-${i}-child-label`] = `tree-node-${i}-child-label`;
        children.push(treeRow('tree-node-', i), treeChildren('tree-node-', i));
    }
    return {
        id: 'test-tree',
        name: 'test-tree',
        version: 1,
        canvas: { referenceWidth: 800, referenceHeight: 600, scaleMode: 'match-width-or-height', matchBias: 0.5 },
        bindings,
        root: {
            role: 'root',
            key: 'root',
            enabled: true,
            interactive: false,
            layout: { display: 'overlay', width: 800, height: 600 },
            children: [
                {
                    role: 'custom:tree-view',
                    key: 'tree-1',
                    enabled: true,
                    interactive: true,
                    controller: 'tree-view',
                    props: {
                        nodePrefix: 'tree-node-',
                        onSelect: 'selected',
                        onToggle: 'toggled',
                    },
                    layout: { width: 'content', height: 'content', direction: 'column', gap: 4 },
                    children,
                },
            ],
        },
    } as unknown as UIAsset;
};

const prepareRuntime = () => {
    const runtime = new UIRuntime({ width: 800, height: 600 });
    runtime.fonts.registerFace(createTestFontAsset(AXRONE_DEFAULT_UI_FONT_FAMILY));
    runtime.registry.register(treeViewController);
    runtime.loadFromAsset(buildTreeAsset());
    runtime.commit();
    return runtime;
};

const centerOf = (runtime: UIRuntime, widget: WidgetId) => {
    const box = runtime.getLayoutBox(widget);
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

const rowPressPoint = (runtime: UIRuntime, widget: WidgetId) => {
    const box = runtime.getLayoutBox(widget);
    return { x: box.x + box.width - 4, y: box.y + box.height / 2 };
};

const keyDown = (key: string) =>
    ({ type: 'key', phase: 'down', key }) as never;

describe('tree-view controller', () => {
    it('collapses every children container on mount', () => {
        const runtime = prepareRuntime();
        const tree = runtime.getBoundWidget('tree-1')!;
        expect(getTreeViewSelectedIndex(runtime, tree)).toBe(-1);
        expect(getTreeViewExpanded(runtime, tree)).toEqual([]);
        for (let i = 0; i < NODE_COUNT; i++) {
            expect(runtime.getWidgetStyleInput(runtime.getBoundWidget(`tree-node-${i}-children`)!)?.visible).toBe(false);
        }
    });

    it('expands and collapses through the toggle caret with onToggle events', () => {
        const runtime = prepareRuntime();
        const tree = runtime.getBoundWidget('tree-1')!;
        const onToggle = vi.fn();
        runtime.onControllerEvent(tree, 'toggled', onToggle);

        const toggle = centerOf(runtime, runtime.getBoundWidget('tree-node-1-toggle')!);
        runtime.dispatchInput({ type: 'pointer', phase: 'down', x: toggle.x, y: toggle.y });

        expect(getTreeViewExpanded(runtime, tree)).toEqual([1]);
        expect(runtime.getWidgetStyleInput(runtime.getBoundWidget('tree-node-1-children')!)?.visible).toBe(true);
        expect(runtime.getWidgetStyleInput(runtime.getBoundWidget('tree-node-0-children')!)?.visible).toBe(false);
        expect(onToggle).toHaveBeenCalledTimes(1);
        expect(onToggle.mock.calls[0]![0]).toEqual({ index: 1, expanded: true });

        runtime.dispatchInput({ type: 'pointer', phase: 'down', x: toggle.x, y: toggle.y });

        expect(getTreeViewExpanded(runtime, tree)).toEqual([]);
        expect(runtime.getWidgetStyleInput(runtime.getBoundWidget('tree-node-1-children')!)?.visible).toBe(false);
        expect(onToggle).toHaveBeenCalledTimes(2);
        expect(onToggle.mock.calls[1]![0]).toEqual({ index: 1, expanded: false });
    });

    it('selects rows with onSelect events without touching expansion', () => {
        const runtime = prepareRuntime();
        const tree = runtime.getBoundWidget('tree-1')!;
        const onSelect = vi.fn();
        const onToggle = vi.fn();
        runtime.onControllerEvent(tree, 'selected', onSelect);
        runtime.onControllerEvent(tree, 'toggled', onToggle);

        const at = rowPressPoint(runtime, runtime.getBoundWidget('tree-node-2')!);
        runtime.dispatchInput({ type: 'pointer', phase: 'down', x: at.x, y: at.y });

        expect(getTreeViewSelectedIndex(runtime, tree)).toBe(2);
        expect(onSelect).toHaveBeenCalledTimes(1);
        expect(onSelect.mock.calls[0]![0]).toEqual({ index: 2 });
        expect(onToggle).not.toHaveBeenCalled();
        expect(getTreeViewExpanded(runtime, tree)).toEqual([]);
    });

    it('does not select when the toggle caret is pressed', () => {
        const runtime = prepareRuntime();
        const tree = runtime.getBoundWidget('tree-1')!;
        const onSelect = vi.fn();
        runtime.onControllerEvent(tree, 'selected', onSelect);

        const toggle = centerOf(runtime, runtime.getBoundWidget('tree-node-0-toggle')!);
        runtime.dispatchInput({ type: 'pointer', phase: 'down', x: toggle.x, y: toggle.y });

        expect(getTreeViewSelectedIndex(runtime, tree)).toBe(-1);
        expect(onSelect).not.toHaveBeenCalled();
    });

    it('moves selection and expansion with arrow keys', () => {
        const runtime = prepareRuntime();
        const tree = runtime.getBoundWidget('tree-1')!;
        const onSelect = vi.fn();
        const onToggle = vi.fn();
        runtime.onControllerEvent(tree, 'selected', onSelect);
        runtime.onControllerEvent(tree, 'toggled', onToggle);
        expect(runtime.setFocus(tree)).toBe(true);

        runtime.dispatchInput(keyDown('ArrowDown'));
        runtime.dispatchInput(keyDown('ArrowDown'));
        expect(getTreeViewSelectedIndex(runtime, tree)).toBe(1);
        expect(onSelect.mock.calls.map((call) => call[0])).toEqual([{ index: 0 }, { index: 1 }]);

        runtime.dispatchInput(keyDown('ArrowUp'));
        expect(getTreeViewSelectedIndex(runtime, tree)).toBe(0);

        runtime.dispatchInput(keyDown('ArrowRight'));
        expect(getTreeViewExpanded(runtime, tree)).toEqual([0]);
        expect(runtime.getWidgetStyleInput(runtime.getBoundWidget('tree-node-0-children')!)?.visible).toBe(true);
        expect(onToggle).toHaveBeenCalledTimes(1);
        expect(onToggle.mock.calls[0]![0]).toEqual({ index: 0, expanded: true });

        runtime.dispatchInput(keyDown('ArrowLeft'));
        expect(getTreeViewExpanded(runtime, tree)).toEqual([]);
        expect(runtime.getWidgetStyleInput(runtime.getBoundWidget('tree-node-0-children')!)?.visible).toBe(false);
        expect(onToggle.mock.calls[1]![0]).toEqual({ index: 0, expanded: false });
    });

    it('keeps state across external prop commits and honours renamed events', () => {
        const runtime = prepareRuntime();
        const tree = runtime.getBoundWidget('tree-1')!;

        const toggle = centerOf(runtime, runtime.getBoundWidget('tree-node-0-toggle')!);
        runtime.dispatchInput({ type: 'pointer', phase: 'down', x: toggle.x, y: toggle.y });
        const row = rowPressPoint(runtime, runtime.getBoundWidget('tree-node-2')!);
        runtime.dispatchInput({ type: 'pointer', phase: 'down', x: row.x, y: row.y });
        expect(getTreeViewExpanded(runtime, tree)).toEqual([0]);
        expect(getTreeViewSelectedIndex(runtime, tree)).toBe(2);

        runtime.updateWidget(tree, { props: { onSelect: 'selected-v2', onToggle: 'toggled-v2' } });

        expect(getTreeViewExpanded(runtime, tree)).toEqual([0]);
        expect(getTreeViewSelectedIndex(runtime, tree)).toBe(2);
        expect(runtime.getWidgetStyleInput(runtime.getBoundWidget('tree-node-0-children')!)?.visible).toBe(true);

        const onSelectV2 = vi.fn();
        const onToggleV2 = vi.fn();
        runtime.onControllerEvent(tree, 'selected-v2', onSelectV2);
        runtime.onControllerEvent(tree, 'toggled-v2', onToggleV2);

        const row1 = rowPressPoint(runtime, runtime.getBoundWidget('tree-node-1')!);
        runtime.dispatchInput({ type: 'pointer', phase: 'down', x: row1.x, y: row1.y });
        expect(onSelectV2).toHaveBeenCalledTimes(1);
        expect(onSelectV2.mock.calls[0]![0]).toEqual({ index: 1 });

        const toggle2 = centerOf(runtime, runtime.getBoundWidget('tree-node-2-toggle')!);
        runtime.dispatchInput({ type: 'pointer', phase: 'down', x: toggle2.x, y: toggle2.y });
        expect(onToggleV2).toHaveBeenCalledTimes(1);
        expect(onToggleV2.mock.calls[0]![0]).toEqual({ index: 2, expanded: true });
    });
});
