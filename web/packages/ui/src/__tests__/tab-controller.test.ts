import { describe, expect, it, vi } from 'vitest';
import { UIRuntime } from '../runtime';
import { deserializeUIAsset } from '../runtime/ui-asset-io';
import { tabViewController, getTabSelectedIndex } from '../controls/tab-controller';
import { pageController, getPage } from '../controls/page-controller';
import type { UIAsset, WidgetId } from '../types';

const createTabPageAssetJson = (
    tabProps: Record<string, unknown>,
    pageProps: Record<string, unknown>,
): string =>
    JSON.stringify({
        id: 'ui.tab-page-test',
        name: 'tab-page-test',
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
            page: 'page',
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
                {
                    role: 'container',
                    key: 'page',
                    enabled: true,
                    interactive: false,
                    controller: 'page-controller',
                    props: pageProps,
                    layout: {
                        position: 'absolute',
                        inset: { left: 0, top: 0 },
                        width: 10,
                        height: 10,
                    },
                    children: [],
                },
            ],
        },
    });

const createTabPageRuntime = (
    tabProps: Record<string, unknown>,
    pageProps: Record<string, unknown>,
): UIRuntime => {
    const runtime = new UIRuntime({ width: 400, height: 300 });
    runtime.registry.register(tabViewController);
    runtime.registry.register(pageController);
    runtime.loadFromAsset(
        deserializeUIAsset(createTabPageAssetJson(tabProps, pageProps)) as UIAsset,
    );
    runtime.commit();
    return runtime;
};

const centerOf = (runtime: UIRuntime, widget: WidgetId) => {
    const box = runtime.getLayoutBox(widget);
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

describe('@axrone/ui tab-controller without page link', () => {
    it('keeps legacy selection and panel visibility when pageKey is absent', () => {
        const runtime = createTabPageRuntime(
            { selectedIndex: 0, tabCount: 2, tabPrefix: 'tab-', panelPrefix: 'panel-' },
            { page: 'home', pages: ['home', 'settings'] },
        );
        const tabView = runtime.getBoundWidget('tab-view') as WidgetId;
        const page = runtime.getBoundWidget('page') as WidgetId;
        expect(getTabSelectedIndex(runtime, tabView)).toBe(0);
        const tab1 = runtime.getBoundWidget('tab-1') as WidgetId;
        const at = centerOf(runtime, tab1);
        runtime.dispatchInput({ type: 'pointer', phase: 'up', x: at.x, y: at.y });
        expect(getTabSelectedIndex(runtime, tabView)).toBe(1);
        expect(runtime.getWidgetStyleInput(runtime.getBoundWidget('panel-1') as WidgetId)?.visible).toBe(true);
        expect(runtime.getWidgetStyleInput(runtime.getBoundWidget('panel-0') as WidgetId)?.visible).toBe(false);
        expect(getPage(runtime, page)).toBe('home');
    });
});

describe('@axrone/ui tab-controller with page link', () => {
    it('pushes the page name on programmatic selectIndex and emits onPageChange', () => {
        const runtime = createTabPageRuntime(
            {
                selectedIndex: 0,
                tabCount: 2,
                tabPrefix: 'tab-',
                panelPrefix: 'panel-',
                pageKey: 'page',
                pageNames: ['home', 'settings'],
            },
            { page: 'home', pages: ['home', 'settings'], onPageChange: 'onPageChange' },
        );
        const tabView = runtime.getBoundWidget('tab-view') as WidgetId;
        const page = runtime.getBoundWidget('page') as WidgetId;
        const callback = vi.fn();
        runtime.onControllerEvent(page, 'onPageChange', callback);
        runtime.updateWidget(tabView, { props: { selectedIndex: 1 } });
        expect(getTabSelectedIndex(runtime, tabView)).toBe(1);
        expect(getPage(runtime, page)).toBe('settings');
        expect(callback).toHaveBeenCalledTimes(1);
        expect(callback).toHaveBeenCalledWith({ page: 'settings', index: 1 });
    });

    it('pushes the page name on keyboard selection and emits onPageChange', () => {
        const runtime = createTabPageRuntime(
            {
                selectedIndex: 0,
                tabCount: 2,
                tabPrefix: 'tab-',
                panelPrefix: 'panel-',
                pageKey: 'page',
                pageNames: ['home', 'settings'],
            },
            { page: 'home', pages: ['home', 'settings'], onPageChange: 'onPageChange' },
        );
        const tabView = runtime.getBoundWidget('tab-view') as WidgetId;
        const page = runtime.getBoundWidget('page') as WidgetId;
        const callback = vi.fn();
        runtime.onControllerEvent(page, 'onPageChange', callback);
        expect(runtime.setFocus(tabView)).toBe(true);
        runtime.dispatchInput({ type: 'key', phase: 'down', key: 'ArrowRight' });
        expect(getTabSelectedIndex(runtime, tabView)).toBe(1);
        expect(getPage(runtime, page)).toBe('settings');
        expect(callback).toHaveBeenCalledTimes(1);
        expect(callback).toHaveBeenCalledWith({ page: 'settings', index: 1 });
    });

    it('pushes the page name on pointer selection and emits onPageChange', () => {
        const runtime = createTabPageRuntime(
            {
                selectedIndex: 0,
                tabCount: 2,
                tabPrefix: 'tab-',
                panelPrefix: 'panel-',
                pageKey: 'page',
                pageNames: ['home', 'settings'],
            },
            { page: 'home', pages: ['home', 'settings'], onPageChange: 'onPageChange' },
        );
        const tabView = runtime.getBoundWidget('tab-view') as WidgetId;
        const page = runtime.getBoundWidget('page') as WidgetId;
        const callback = vi.fn();
        runtime.onControllerEvent(page, 'onPageChange', callback);
        const tab1 = runtime.getBoundWidget('tab-1') as WidgetId;
        const at = centerOf(runtime, tab1);
        runtime.dispatchInput({ type: 'pointer', phase: 'up', x: at.x, y: at.y });
        expect(getTabSelectedIndex(runtime, tabView)).toBe(1);
        expect(getPage(runtime, page)).toBe('settings');
        expect(callback).toHaveBeenCalledTimes(1);
        expect(callback).toHaveBeenCalledWith({ page: 'settings', index: 1 });
    });
});
