import type { UIRuntime } from '../runtime';
import type { WidgetId } from '../types';
import type { WidgetController, WidgetControllerContext } from '../widget';
import { asArray, asString, setWidgetVisible } from './internals';

export const NAVIGATION_CONTROLLER_TYPE = 'navigation';

export interface NavigationControllerProps {
    readonly route?: string;
    readonly routes?: string[];
    readonly routePrefix?: string;
    readonly onNavigate?: string;
}

export interface NavigationControllerState {
    route: string;
}

type NavigationContext = WidgetControllerContext<
    Record<string, unknown>,
    NavigationControllerState,
    UIRuntime
>;

const resolveRoute = (props: NavigationControllerProps): string => {
    const authored = asString(props.route);
    if (authored) {
        return authored;
    }
    const routes = asArray(props.routes);
    return routes[0] ?? '';
};

const resolvePanelKey = (props: NavigationControllerProps, name: string): string =>
    `${asString(props.routePrefix)}${name}`;

const applyVisuals = (context: NavigationContext): void => {
    const props = context.props as NavigationControllerProps;
    const runtime = context.runtime;
    const state = context.state;
    const routes = asArray(props.routes);
    for (const name of routes) {
        const panel = runtime.getBoundWidget(resolvePanelKey(props, name));
        if (panel !== null) {
            setWidgetVisible(runtime, panel, name === state.route);
        }
    }
};

const emitNavigate = (context: NavigationContext, route: string): void => {
    const props = context.props as NavigationControllerProps;
    const name = asString(props.onNavigate);
    if (!name) {
        return;
    }
    context.runtime.emitControllerEvent(context.widget as WidgetId, name, { route });
};

export const navigationController: WidgetController<
    typeof NAVIGATION_CONTROLLER_TYPE,
    Record<string, unknown>,
    NavigationControllerState,
    UIRuntime,
    unknown
> = {
    type: NAVIGATION_CONTROLLER_TYPE,
    createState: (props) => ({
        route: resolveRoute(props as NavigationControllerProps),
    }),
    mount: (context) => {
        const typed = context as NavigationContext;
        applyVisuals(typed);
    },
    update: (context, previousProps) => {
        const typed = context as NavigationContext;
        const props = typed.props as NavigationControllerProps;
        const previous = previousProps as NavigationControllerProps;

        if (
            props.route !== previous.route ||
            props.routes !== previous.routes ||
            props.routePrefix !== previous.routePrefix ||
            props.onNavigate !== previous.onNavigate
        ) {
            const next = resolveRoute(props);
            const changed = next !== typed.state.route;
            typed.state.route = next;
            applyVisuals(typed);
            if (changed) {
                emitNavigate(typed, next);
            }
        }
    },
};

export const getNavigationRoute = (
    runtime: UIRuntime,
    widget: WidgetId
): string | null => {
    const state = runtime.getWidgetState(widget) as NavigationControllerState | null;
    return state && typeof state.route === 'string' ? state.route : null;
};
