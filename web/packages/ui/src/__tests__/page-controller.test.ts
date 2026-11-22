import { describe, expect, it, vi } from 'vitest';
import { UIRuntime } from '../runtime';
import { deserializeUIAsset } from '../runtime/ui-asset-io';
import { pageController, getPage } from '../controls/page-controller';
import type { UIAsset, WidgetId } from '../types';

const createPageAssetJson = (props: Record<string, unknown>): string =>
    JSON.stringify({
        id: 'ui.page-test',
        name: 'page-test',
        version: 1,
        canvas: {
            referenceWidth: 400,
            referenceHeight: 300,
            scaleMode: 'fixed',
            matchBias: 0.5,
        },
        bindings: {
            root: 'root',
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
                    role: 'container',
                    key: 'page',
                    enabled: true,
                    interactive: false,
                    controller: 'page-controller',
                    props,
                    layout: { width: 100, height: 100 },
                    children: [],
                },
            ],
        },
    });

const createPageRuntime = (props: Record<string, unknown>): UIRuntime => {
    const runtime = new UIRuntime({ width: 400, height: 300 });
    runtime.registry.register(pageController);
    runtime.loadFromAsset(deserializeUIAsset(createPageAssetJson(props)) as UIAsset);
    runtime.commit();
    return runtime;
};

describe('@axrone/ui page-controller', () => {
    it('sets initial state from props.page on mount', () => {
        const runtime = createPageRuntime({ page: 'home', pages: ['home', 'settings'] });
        const page = runtime.getBoundWidget('page') as WidgetId;
        expect(getPage(runtime, page)).toBe('home');
        const state = runtime.getWidgetState(page) as { page: string };
        expect(state.page).toBe('home');
    });

    it('defaults to empty page when no page is authored', () => {
        const runtime = createPageRuntime({});
        const page = runtime.getBoundWidget('page') as WidgetId;
        expect(getPage(runtime, page)).toBe('');
    });

    it('commits an external page change and emits onPageChange with index', () => {
        const runtime = createPageRuntime({
            page: 'home',
            pages: ['home', 'settings', 'profile'],
            onPageChange: 'onPageChange',
        });
        const page = runtime.getBoundWidget('page') as WidgetId;
        const callback = vi.fn();
        runtime.onControllerEvent(page, 'onPageChange', callback);
        runtime.updateWidget(page, { props: { page: 'settings' } });
        expect(getPage(runtime, page)).toBe('settings');
        expect(callback).toHaveBeenCalledTimes(1);
        expect(callback).toHaveBeenCalledWith({ page: 'settings', index: 1 });
    });

    it('emits index -1 when the page is not listed in pages', () => {
        const runtime = createPageRuntime({
            page: 'home',
            pages: ['home', 'settings'],
            onPageChange: 'onPageChange',
        });
        const page = runtime.getBoundWidget('page') as WidgetId;
        const callback = vi.fn();
        runtime.onControllerEvent(page, 'onPageChange', callback);
        runtime.updateWidget(page, { props: { page: 'unknown' } });
        expect(getPage(runtime, page)).toBe('unknown');
        expect(callback).toHaveBeenCalledTimes(1);
        expect(callback).toHaveBeenCalledWith({ page: 'unknown', index: -1 });
    });

    it('does not emit when the same page is committed again', () => {
        const runtime = createPageRuntime({
            page: 'home',
            pages: ['home', 'settings'],
            onPageChange: 'onPageChange',
        });
        const page = runtime.getBoundWidget('page') as WidgetId;
        const callback = vi.fn();
        runtime.onControllerEvent(page, 'onPageChange', callback);
        runtime.updateWidget(page, { props: { page: 'settings' } });
        expect(callback).toHaveBeenCalledTimes(1);
        runtime.updateWidget(page, { props: { page: 'settings' } });
        expect(callback).toHaveBeenCalledTimes(1);
    });

    it('ignores input and never captures events', () => {
        const runtime = createPageRuntime({ page: 'home', pages: ['home'] });
        const page = runtime.getBoundWidget('page') as WidgetId;
        const box = runtime.getLayoutBox(page);
        const handled = runtime.dispatchInput({
            type: 'pointer',
            phase: 'down',
            x: box.x + box.width / 2,
            y: box.y + box.height / 2,
        } as never);
        expect(handled).toBe(false);
        expect(getPage(runtime, page)).toBe('home');
    });
});
