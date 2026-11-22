import type { UIRuntime } from '../runtime';
import type { UIInputEvent, WidgetId } from '../types';
import type { WidgetController, WidgetControllerContext } from '../widget';
import { clamp } from '@axrone/numeric';
import { hitTestBoundWidget, asString, asNumber, asArray, asBoolean, asFiniteNumber, asColorString, setWidgetVisible } from './internals';
import { defaultUIControlTheme } from './theme';

/**
 * Declarative tab-view controller for `.ui.json` authored tabbed interfaces.
 *
 * The authored widget acts as the interaction surface and its `props` name the
 * child widgets that visualise tab selection and panel visibility:
 *
 *   props: {
 *     selectedIndex: number,
 *     tabCount: number,
 *     tabPrefix: string,           // e.g. 'tab-' resolves 'tab-0', 'tab-1', ...
 *     panelPrefix: string,         // e.g. 'panel-' resolves 'panel-0', 'panel-1', ...
 *     activeColor: string,
 *     inactiveColor: string,
 *     activeTextColor: string,
 *     inactiveTextColor: string,
 *   }
 *
 * For each index i, the controller resolves:
 *   - tab widget:   `${tabPrefix}${i}`
 *   - panel widget: `${panelPrefix}${i}`
 *
 * Child widgets are resolved through the asset's binding table.
 */
export const TAB_VIEW_CONTROLLER_TYPE = 'tab-view';

export interface TabControllerProps {
    readonly selectedIndex?: number;
    readonly tabCount?: number;
    readonly tabPrefix?: string;
    readonly panelPrefix?: string;
    readonly activeColor?: string;
    readonly inactiveColor?: string;
    readonly activeTextColor?: string;
    readonly inactiveTextColor?: string;
    readonly pageKey?: string;
    readonly pageNames?: readonly string[];
    readonly panelHeight?: number;
    readonly panelRadius?: number;
    readonly panelBackground?: string;
    readonly switchOnHover?: boolean;
    readonly keyboardNav?: boolean;
}

export interface TabControllerState {
    selectedIndex: number;
}

type TabContext = WidgetControllerContext<
    Record<string, unknown>,
    TabControllerState,
    UIRuntime
>;

const DEFAULT_ACTIVE_COLOR = defaultUIControlTheme.accentColor;
const DEFAULT_INACTIVE_COLOR = '#334155ff';
const DEFAULT_ACTIVE_TEXT_COLOR = '#ffffffff';
const DEFAULT_INACTIVE_TEXT_COLOR = '#94a3b8ff';

/** Resolves the tab widget key for a given index. */
const resolveTabKey = (props: TabControllerProps, index: number): string =>
    `${asString(props.tabPrefix) || 'tab-'}${index}`;

/** Resolves the panel widget key for a given index. */
const resolvePanelKey = (props: TabControllerProps, index: number): string =>
    `${asString(props.panelPrefix) || 'panel-'}${index}`;

const syncPage = (context: TabContext, index: number): void => {
    const props = context.props as TabControllerProps;
    const pageKey = asString(props.pageKey);
    if (!pageKey) return;
    const pageNames = asArray(props.pageNames);
    if (index < 0 || index >= pageNames.length) return;
    const page = pageNames[index];
    if (!page) return;
    const pageWidget = context.runtime.getBoundWidget(pageKey);
    if (pageWidget === null) return;
    context.runtime.updateWidget(pageWidget, { props: { page } });
};

/**
 * Pushes the visual state onto all tab and panel widgets.
 * Active tab gets the active background/text color; inactive tabs get the
 * inactive colors. The selected panel is enabled; all others are disabled.
 * Returns true once at least one visual was applied.
 */
const applyVisuals = (context: TabContext): boolean => {
    const props = context.props as TabControllerProps;
    const runtime = context.runtime;
    const state = context.state;

    const count = Math.max(0, asNumber(props.tabCount, 0) | 0);
    const activeColor = (asString(props.activeColor) || DEFAULT_ACTIVE_COLOR) as `#${string}`;
    const inactiveColor = (asString(props.inactiveColor) || DEFAULT_INACTIVE_COLOR) as `#${string}`;
    const activeTextColor = (asString(props.activeTextColor) || DEFAULT_ACTIVE_TEXT_COLOR) as `#${string}`;
    const inactiveTextColor = (asString(props.inactiveTextColor) || DEFAULT_INACTIVE_TEXT_COLOR) as `#${string}`;
    const panelHeight = asFiniteNumber(props.panelHeight);
    const panelRadius = asFiniteNumber(props.panelRadius);
    const panelBackground = asColorString(props.panelBackground);

    let applied = false;

    for (let i = 0; i < count; i++) {
        const isActive = i === state.selectedIndex;

        const tabKey = resolveTabKey(props, i);
        const tab = runtime.getBoundWidget(tabKey);
        if (tab !== null) {
            runtime.updateWidget(tab, {
                style: {
                    background: isActive ? activeColor : inactiveColor,
                    color: isActive ? activeTextColor : inactiveTextColor,
                },
            });
            applied = true;
        }

        const panelKey = resolvePanelKey(props, i);
        const panel = runtime.getBoundWidget(panelKey);
        if (panel !== null) {
            setWidgetVisible(runtime, panel, isActive);
            const layoutPatch: Record<string, unknown> = {};
            const stylePatch: Record<string, unknown> = {};
            if (panelHeight !== null && panelHeight > 0) layoutPatch.height = panelHeight;
            if (panelRadius !== null && panelRadius >= 0) stylePatch.radius = panelRadius;
            if (panelBackground !== null) stylePatch.background = panelBackground as `#${string}`;
            if (Object.keys(layoutPatch).length > 0 || Object.keys(stylePatch).length > 0) {
                runtime.updateWidget(
                    panel,
                    {
                        ...(Object.keys(layoutPatch).length > 0 ? { layout: layoutPatch } : {}),
                        ...(Object.keys(stylePatch).length > 0 ? { style: stylePatch } : {}),
                    },
                );
            }
            applied = true;
        }
    }

    return applied || count === 0;
};

/**
 * Determines which tab the pointer is over by hit-testing each tab widget's
 * layout box. Returns -1 when no tab contains the point.
 */
const hitTestTab = (context: TabContext, x: number, y: number): number => {
    const props = context.props as TabControllerProps;
    const runtime = context.runtime;
    const count = Math.max(0, asNumber(props.tabCount, 0) | 0);

    for (let i = 0; i < count; i++) {
        const tabKey = resolveTabKey(props, i);
        const tab = runtime.getBoundWidget(tabKey);
        if (tab !== null && hitTestBoundWidget(runtime, tab, x, y)) {
            return i;
        }
    }
    return -1;
};

export const tabViewController: WidgetController<
    typeof TAB_VIEW_CONTROLLER_TYPE,
    Record<string, unknown>,
    TabControllerState,
    UIRuntime,
    unknown
> = {
    type: TAB_VIEW_CONTROLLER_TYPE,
    createState: (props) => {
        const tabProps = props as TabControllerProps;
        const count = Math.max(0, asNumber(tabProps.tabCount, 0) | 0);
        const rawIndex = asNumber(tabProps.selectedIndex, 0);
        const clampedIndex = count > 0 ? clamp(rawIndex, 0, count - 1) : 0;
        return {
            selectedIndex: clampedIndex,
        };
    },
    mount: (context) => {
        const typed = context as TabContext;
        applyVisuals(typed);
    },
    update: (context, previousProps) => {
        const typed = context as TabContext;
        const props = typed.props as TabControllerProps;
        const previous = previousProps as TabControllerProps;

        if (
            props.selectedIndex !== previous.selectedIndex ||
            props.tabCount !== previous.tabCount ||
            props.tabPrefix !== previous.tabPrefix ||
            props.panelPrefix !== previous.panelPrefix ||
            props.activeColor !== previous.activeColor ||
            props.inactiveColor !== previous.inactiveColor ||
            props.activeTextColor !== previous.activeTextColor ||
            props.inactiveTextColor !== previous.inactiveTextColor ||
            props.pageKey !== previous.pageKey ||
            props.pageNames !== previous.pageNames ||
            props.panelHeight !== previous.panelHeight ||
            props.panelRadius !== previous.panelRadius ||
            props.panelBackground !== previous.panelBackground ||
            props.switchOnHover !== previous.switchOnHover ||
            props.keyboardNav !== previous.keyboardNav
        ) {
            const previousSelected = typed.state.selectedIndex;
            const count = Math.max(0, asNumber(props.tabCount, 0) | 0);
            const authored = asNumber(props.selectedIndex, typed.state.selectedIndex);
            typed.state.selectedIndex = count > 0 ? clamp(authored, 0, count - 1) : 0;
            applyVisuals(typed);
            if (
                typed.state.selectedIndex !== previousSelected ||
                props.pageKey !== previous.pageKey ||
                props.pageNames !== previous.pageNames
            ) {
                syncPage(typed, typed.state.selectedIndex);
            }
        }
    },
    input: (event: Readonly<UIInputEvent>, context) => {
        const typed = context as TabContext;
        const state = typed.state;
        if (!state) return false;

        const props = typed.props as TabControllerProps;
        const count = Math.max(0, asNumber(props.tabCount, 0) | 0);
        if (count === 0) return false;

        if (event.type === 'pointer') {
            switch (event.phase) {
                case 'up': {
                    const hit = hitTestTab(typed, event.x, event.y);
                    if (hit >= 0 && hit !== state.selectedIndex) {
                        state.selectedIndex = hit;
                        applyVisuals(typed);
                        syncPage(typed, hit);
                        return true;
                    }
                    return false;
                }
                case 'move': {
                    if (!asBoolean(props.switchOnHover, false)) return false;
                    const hit = hitTestTab(typed, event.x, event.y);
                    if (hit >= 0 && hit !== state.selectedIndex) {
                        state.selectedIndex = hit;
                        applyVisuals(typed);
                        syncPage(typed, hit);
                        return true;
                    }
                    return false;
                }
                default:
                    return false;
            }
        }

        if (event.type === 'key' && event.phase === 'down') {
            if (!asBoolean(props.keyboardNav, true)) return false;
            switch (event.key) {
                case 'ArrowRight': {
                    const next = state.selectedIndex + 1;
                    state.selectedIndex = next < count ? next : 0;
                    applyVisuals(typed);
                    syncPage(typed, state.selectedIndex);
                    return true;
                }
                case 'ArrowLeft': {
                    const prev = state.selectedIndex - 1;
                    state.selectedIndex = prev >= 0 ? prev : count - 1;
                    applyVisuals(typed);
                    syncPage(typed, state.selectedIndex);
                    return true;
                }
                default:
                    return false;
            }
        }

        return false;
    },
};

/**
 * Reads the live selected index of a tab-view widget driven by `tab-view`.
 * Returns null when the widget has no tab-view state.
 */
export const getTabSelectedIndex = (
    runtime: UIRuntime,
    widget: WidgetId
): number | null => {
    const state = runtime.getWidgetState(widget) as TabControllerState | null;
    return state && typeof state.selectedIndex === 'number' ? state.selectedIndex : null;
};
