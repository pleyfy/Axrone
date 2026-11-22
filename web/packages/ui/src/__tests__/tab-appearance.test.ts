import { describe, expect, it } from 'vitest';
import { UIRuntime } from '../runtime';
import { deserializeUIAsset } from '../runtime/ui-asset-io';
import { tabViewController, getTabSelectedIndex } from '../controls/tab-controller';
import type { UIAsset, WidgetId } from '../types';

const createTabAssetJson = (tabProps: Record<string, unknown>): string =>
    JSON.stringify({
        id: 'ui.tab-appearance-test',
        name: 'tab-appearance-test',
        version: 1,
        canvas: {
            referenceWidth: 400,
            referenceHeight: 300,
            scaleMode: 'fixed',
            matchBias: 0.5,
        },
        bindings: {
            root: 'root',
            'tab-view': 'tab-view',
            'tab-0': 'tab-0',
            'tab-1': 'tab-1',
            'panel-0': 'panel-0',
            'panel-1': 'panel-1',
        },
        root: {
            role: 'root',
            key: 'root',
            enabled: true,
            interactive: false,
            layout: { display: 'overlay', width: '100%', height: '100%' },
            children: [
                {
                    role: 'custom:tab-view',
                    key: 'tab-view',
                    enabled: true,
                    interactive: true,
                    controller: 'tab-view',
                    props: tabProps,
                    layout: {
                        position: 'absolute',
                        inset: { left: 0, top: 0 },
                        width: 400,
                        height: 300,
                    },
                    children: [
                        {
                            role: 'container',
                            key: 'tab-0',
                            enabled: true,
                            interactive: false,
                            layout: {
                                position: 'absolute',
                                inset: { left: 0, top: 0 },
                                width: 100,
                                height: 30,
                            },
                            style: { background: '#334155ff' },
                            children: [],
                        },
                        {
                            role: 'container',
                            key: 'tab-1',
                            enabled: true,
                            interactive: false,
                            layout: {
                                position: 'absolute',
                                inset: { left: 110, top: 0 },
                                width: 100,
                                height: 30,
                            },
                            style: { background: '#334155ff' },
                            children: [],
                        },
                        {
                            role: 'container',
                            key: 'panel-0',
                            enabled: true,
                            interactive: false,
                            layout: {
                                position: 'absolute',
                                inset: { left: 0, top: 40 },
                                width: 400,
                                height: 260,
                            },
                            style: { background: '#1e293bff' },
                            children: [],
                        },
                        {
                            role: 'container',
                            key: 'panel-1',
                            enabled: false,
                            interactive: false,
                            layout: {
                                position: 'absolute',
                                inset: { left: 0, top: 40 },
                                width: 400,
                                height: 260,
                            },
                            style: { background: '#1e293bff' },
                            children: [],
                        },
                    ],
                },
            ],
        },
    });

const createTabRuntime = (tabProps: Record<string, unknown>): UIRuntime => {
    const runtime = new UIRuntime({ width: 400, height: 300 });
    runtime.registry.register(tabViewController);
    runtime.loadFromAsset(deserializeUIAsset(createTabAssetJson(tabProps)) as UIAsset);
    runtime.commit();
    return runtime;
};

const centerOf = (runtime: UIRuntime, widget: WidgetId) => {
    const box = runtime.getLayoutBox(widget);
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

const baseProps = (): Record<string, unknown> => ({
    selectedIndex: 0,
    tabCount: 2,
    tabPrefix: 'tab-',
    panelPrefix: 'panel-',
});

describe('@axrone/ui tab-controller panel appearance', () => {
    it('applies panel height, radius and background on mount', () => {
        const runtime = createTabRuntime({
            ...baseProps(),
            panelHeight: 120,
            panelRadius: 10,
            panelBackground: '#ff0000ff',
        });
        const panel0 = runtime.getBoundWidget('panel-0') as WidgetId;
        const panel1 = runtime.getBoundWidget('panel-1') as WidgetId;
        expect(runtime.getLayoutBox(panel0).height).toBeCloseTo(120, 5);
        expect(runtime.getWidgetStyleInput(panel0)?.radius).toBe(10);
        expect(runtime.getWidgetStyleInput(panel1)?.radius).toBe(10);
        expect(runtime.getWidgetStyleInput(panel0)?.background).toBe('#ff0000ff');
        expect(runtime.getWidgetStyleInput(panel1)?.background).toBe('#ff0000ff');
        const tabView = runtime.getBoundWidget('tab-view') as WidgetId;
        runtime.updateWidget(tabView, { props: { selectedIndex: 1 } });
        runtime.commit();
        expect(runtime.getLayoutBox(panel1).height).toBeCloseTo(120, 5);
    });

    it('preserves authored panel visuals when appearance props are absent', () => {
        const runtime = createTabRuntime(baseProps());
        const panel0 = runtime.getBoundWidget('panel-0') as WidgetId;
        expect(runtime.getLayoutBox(panel0).height).toBeCloseTo(260, 5);
        expect(runtime.getWidgetStyleInput(panel0)?.background).toBe('#1e293bff');
    });

    it('selects the hovered tab on pointer move when switchOnHover is enabled', () => {
        const idle = createTabRuntime(baseProps());
        const idleView = idle.getBoundWidget('tab-view') as WidgetId;
        const idleTab1 = idle.getBoundWidget('tab-1') as WidgetId;
        const idleAt = centerOf(idle, idleTab1);
        idle.dispatchInput({ type: 'pointer', phase: 'move', x: idleAt.x, y: idleAt.y });
        expect(getTabSelectedIndex(idle, idleView)).toBe(0);

        const runtime = createTabRuntime({ ...baseProps(), switchOnHover: true });
        const tabView = runtime.getBoundWidget('tab-view') as WidgetId;
        const tab1 = runtime.getBoundWidget('tab-1') as WidgetId;
        const at = centerOf(runtime, tab1);
        runtime.dispatchInput({ type: 'pointer', phase: 'move', x: at.x, y: at.y });
        expect(getTabSelectedIndex(runtime, tabView)).toBe(1);
        expect(runtime.getWidgetStyleInput(runtime.getBoundWidget('panel-1') as WidgetId)?.visible).toBe(true);
        expect(runtime.getWidgetStyleInput(runtime.getBoundWidget('panel-0') as WidgetId)?.visible).toBe(false);
    });

    it('ignores arrow keys when keyboardNav is false', () => {
        const runtime = createTabRuntime({ ...baseProps(), keyboardNav: false });
        const tabView = runtime.getBoundWidget('tab-view') as WidgetId;
        expect(runtime.setFocus(tabView)).toBe(true);
        runtime.dispatchInput({ type: 'key', phase: 'down', key: 'ArrowRight' });
        expect(getTabSelectedIndex(runtime, tabView)).toBe(0);
        runtime.dispatchInput({ type: 'key', phase: 'down', key: 'ArrowLeft' });
        expect(getTabSelectedIndex(runtime, tabView)).toBe(0);

        const enabled = createTabRuntime(baseProps());
        const enabledView = enabled.getBoundWidget('tab-view') as WidgetId;
        expect(enabled.setFocus(enabledView)).toBe(true);
        enabled.dispatchInput({ type: 'key', phase: 'down', key: 'ArrowRight' });
        expect(getTabSelectedIndex(enabled, enabledView)).toBe(1);
    });

    it('applies an externally committed selectedIndex', () => {
        const runtime = createTabRuntime(baseProps());
        const tabView = runtime.getBoundWidget('tab-view') as WidgetId;
        runtime.updateWidget(tabView, { props: { selectedIndex: 1 } });
        expect(getTabSelectedIndex(runtime, tabView)).toBe(1);
        expect(runtime.getWidgetStyleInput(runtime.getBoundWidget('panel-1') as WidgetId)?.visible).toBe(true);
        expect(runtime.getWidgetStyleInput(runtime.getBoundWidget('panel-0') as WidgetId)?.visible).toBe(false);
    });
});
