import { describe, expect, it, vi } from 'vitest';
import { AXRONE_DEFAULT_UI_FONT_FAMILY, UIRuntime, getNavigationRoute } from '../index';
import { navigationController } from '../controls/navigation-controller';
import { createTestFontAsset } from './test-font';
import type { UIAsset, WidgetId } from '../types';

const ROUTES = ['home', 'search', 'profile'];

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

const routePanel = (prefix: string, name: string) => ({
    role: 'custom:route-panel',
    key: `${prefix}${name}`,
    enabled: true,
    interactive: false,
    layout: { display: 'stack', width: 200, height: 100, direction: 'column', padding: 8 },
    style: { background: '#1e293bff', radius: 8 },
    children: [
        {
            role: 'text',
            key: `${prefix}${name}-label`,
            enabled: true,
            interactive: false,
            layout: { width: 'content', height: 'content' },
            style: { color: '#e2e8f0ff' },
            text: textBlock(name),
            children: [],
        },
    ],
});

const buildNavigationAsset = (props: Record<string, unknown>): UIAsset => {
    const bindings: Record<string, string> = { root: 'root', 'nav-1': 'nav-1' };
    for (const name of ROUTES) {
        bindings[`nav-${name}`] = `nav-${name}`;
        bindings[`nav-${name}-label`] = `nav-${name}-label`;
    }
    return {
        id: 'test-navigation',
        name: 'test-navigation',
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
                    role: 'custom:navigation',
                    key: 'nav-1',
                    enabled: true,
                    interactive: false,
                    controller: 'navigation',
                    props,
                    layout: { width: 'content', height: 'content', direction: 'column' },
                    children: ROUTES.map((name) => routePanel('nav-', name)),
                },
            ],
        },
    } as unknown as UIAsset;
};

const prepareRuntime = (props: Record<string, unknown>) => {
    const runtime = new UIRuntime({ width: 800, height: 600 });
    runtime.fonts.registerFace(createTestFontAsset(AXRONE_DEFAULT_UI_FONT_FAMILY));
    runtime.registry.register(navigationController);
    runtime.loadFromAsset(buildNavigationAsset(props));
    runtime.commit();
    return runtime;
};

const defaultProps = (): Record<string, unknown> => ({
    route: 'home',
    routes: [...ROUTES],
    routePrefix: 'nav-',
    onNavigate: 'navigated',
});

const navWidget = (runtime: UIRuntime): WidgetId => runtime.getBoundWidget('nav-1')!;

describe('navigation controller', () => {
    it('shows only the active route panel on mount', () => {
        const runtime = prepareRuntime(defaultProps());
        const nav = navWidget(runtime);
        expect(getNavigationRoute(runtime, nav)).toBe('home');
        expect(runtime.getWidgetStyleInput(runtime.getBoundWidget('nav-home')!)?.visible).toBe(true);
        expect(runtime.getWidgetStyleInput(runtime.getBoundWidget('nav-search')!)?.visible).toBe(false);
        expect(runtime.getWidgetStyleInput(runtime.getBoundWidget('nav-profile')!)?.visible).toBe(false);
    });

    it('switches panels and emits onNavigate on route commit', () => {
        const runtime = prepareRuntime(defaultProps());
        const nav = navWidget(runtime);
        const onNavigate = vi.fn();
        runtime.onControllerEvent(nav, 'navigated', onNavigate);

        runtime.updateWidget(nav, { props: { route: 'search' } });

        expect(getNavigationRoute(runtime, nav)).toBe('search');
        expect(runtime.getWidgetStyleInput(runtime.getBoundWidget('nav-home')!)?.visible).toBe(false);
        expect(runtime.getWidgetStyleInput(runtime.getBoundWidget('nav-search')!)?.visible).toBe(true);
        expect(runtime.getWidgetStyleInput(runtime.getBoundWidget('nav-profile')!)?.visible).toBe(false);
        expect(onNavigate).toHaveBeenCalledTimes(1);
        expect(onNavigate.mock.calls[0]![0]).toEqual({ route: 'search' });

        runtime.updateWidget(nav, { props: { route: 'profile' } });

        expect(getNavigationRoute(runtime, nav)).toBe('profile');
        expect(runtime.getWidgetStyleInput(runtime.getBoundWidget('nav-search')!)?.visible).toBe(false);
        expect(runtime.getWidgetStyleInput(runtime.getBoundWidget('nav-profile')!)?.visible).toBe(true);
        expect(onNavigate).toHaveBeenCalledTimes(2);
        expect(onNavigate.mock.calls[1]![0]).toEqual({ route: 'profile' });
    });

    it('stays silent when the committed route is unchanged', () => {
        const runtime = prepareRuntime(defaultProps());
        const nav = navWidget(runtime);
        const onNavigate = vi.fn();
        runtime.onControllerEvent(nav, 'navigated', onNavigate);

        runtime.updateWidget(nav, { props: { route: 'home' } });

        expect(getNavigationRoute(runtime, nav)).toBe('home');
        expect(onNavigate).not.toHaveBeenCalled();
        expect(runtime.getWidgetStyleInput(runtime.getBoundWidget('nav-home')!)?.visible).toBe(true);
    });

    it('falls back to the first route when no route is authored', () => {
        const runtime = prepareRuntime({
            routes: [...ROUTES],
            routePrefix: 'nav-',
            onNavigate: 'navigated',
        });
        const nav = navWidget(runtime);
        expect(getNavigationRoute(runtime, nav)).toBe('home');
        expect(runtime.getWidgetStyleInput(runtime.getBoundWidget('nav-home')!)?.visible).toBe(true);
        expect(runtime.getWidgetStyleInput(runtime.getBoundWidget('nav-search')!)?.visible).toBe(false);
    });
});
