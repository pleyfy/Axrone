import type { UIRuntime } from '../runtime';
import type { UIInputEvent, WidgetId } from '../types';
import type { WidgetController, WidgetControllerContext } from '../widget';
import { hitTestBoundWidget, asString, setWidgetVisible } from './internals';

export const TREE_VIEW_CONTROLLER_TYPE = 'tree-view';

export interface TreeViewControllerProps {
    readonly nodePrefix?: string;
    readonly onSelect?: string;
    readonly onToggle?: string;
}

export interface TreeViewControllerState {
    expanded: number[];
    selectedIndex: number;
}

type TreeViewContext = WidgetControllerContext<
    Record<string, unknown>,
    TreeViewControllerState,
    UIRuntime
>;

const MAX_NODE_PROBE = 1024;

const resolveRowKey = (props: TreeViewControllerProps, index: number): string =>
    `${asString(props.nodePrefix)}${index}`;

const resolveToggleKey = (props: TreeViewControllerProps, index: number): string =>
    `${asString(props.nodePrefix)}${index}-toggle`;

const resolveChildrenKey = (props: TreeViewControllerProps, index: number): string =>
    `${asString(props.nodePrefix)}${index}-children`;

const discoverNodeCount = (context: TreeViewContext): number => {
    const props = context.props as TreeViewControllerProps;
    const runtime = context.runtime;
    let count = 0;
    for (let i = 0; i < MAX_NODE_PROBE; i++) {
        if (runtime.getBoundWidget(resolveRowKey(props, i)) === null) {
            break;
        }
        count = i + 1;
    }
    return count;
};

const applyVisuals = (context: TreeViewContext): void => {
    const props = context.props as TreeViewControllerProps;
    const runtime = context.runtime;
    const state = context.state;
    const count = discoverNodeCount(context);
    for (let i = 0; i < count; i++) {
        const children = runtime.getBoundWidget(resolveChildrenKey(props, i));
        if (children !== null) {
            setWidgetVisible(runtime, children, state.expanded.includes(i));
        }
    }
};

const emitSelect = (context: TreeViewContext, index: number): void => {
    const props = context.props as TreeViewControllerProps;
    const name = asString(props.onSelect);
    if (!name) {
        return;
    }
    context.runtime.emitControllerEvent(context.widget as WidgetId, name, { index });
};

const emitToggle = (context: TreeViewContext, index: number, expanded: boolean): void => {
    const props = context.props as TreeViewControllerProps;
    const name = asString(props.onToggle);
    if (!name) {
        return;
    }
    context.runtime.emitControllerEvent(context.widget as WidgetId, name, { index, expanded });
};

const setExpanded = (context: TreeViewContext, index: number, expanded: boolean): void => {
    const state = context.state;
    const has = state.expanded.includes(index);
    if (has === expanded) {
        return;
    }
    state.expanded = expanded
        ? [...state.expanded, index]
        : state.expanded.filter((entry) => entry !== index);
    applyVisuals(context);
};

const hitTestToggle = (context: TreeViewContext, x: number, y: number): number => {
    const props = context.props as TreeViewControllerProps;
    const runtime = context.runtime;
    const count = discoverNodeCount(context);
    for (let i = 0; i < count; i++) {
        const toggle = runtime.getBoundWidget(resolveToggleKey(props, i));
        if (toggle !== null && hitTestBoundWidget(runtime, toggle, x, y)) {
            return i;
        }
    }
    return -1;
};

const hitTestRow = (context: TreeViewContext, x: number, y: number): number => {
    const props = context.props as TreeViewControllerProps;
    const runtime = context.runtime;
    const count = discoverNodeCount(context);
    for (let i = 0; i < count; i++) {
        const row = runtime.getBoundWidget(resolveRowKey(props, i));
        if (row !== null && hitTestBoundWidget(runtime, row, x, y)) {
            return i;
        }
    }
    return -1;
};

export const treeViewController: WidgetController<
    typeof TREE_VIEW_CONTROLLER_TYPE,
    Record<string, unknown>,
    TreeViewControllerState,
    UIRuntime,
    unknown
> = {
    type: TREE_VIEW_CONTROLLER_TYPE,
    createState: () => ({
        expanded: [],
        selectedIndex: -1,
    }),
    mount: (context) => {
        const typed = context as TreeViewContext;
        applyVisuals(typed);
    },
    update: (context, previousProps) => {
        const typed = context as TreeViewContext;
        const props = typed.props as TreeViewControllerProps;
        const previous = previousProps as TreeViewControllerProps;

        if (props.nodePrefix !== previous.nodePrefix) {
            applyVisuals(typed);
        }
    },
    input: (event: Readonly<UIInputEvent>, context) => {
        const typed = context as TreeViewContext;
        const state = typed.state;
        if (!state) return false;

        const count = discoverNodeCount(typed);
        if (count === 0) return false;

        if (event.type === 'pointer') {
            if (event.phase !== 'down') {
                return false;
            }
            const toggleHit = hitTestToggle(typed, event.x, event.y);
            if (toggleHit >= 0) {
                const next = !state.expanded.includes(toggleHit);
                setExpanded(typed, toggleHit, next);
                emitToggle(typed, toggleHit, next);
                return true;
            }
            const rowHit = hitTestRow(typed, event.x, event.y);
            if (rowHit >= 0) {
                state.selectedIndex = rowHit;
                emitSelect(typed, rowHit);
                return true;
            }
            return false;
        }

        if (event.type === 'key' && event.phase === 'down') {
            switch (event.key) {
                case 'ArrowDown': {
                    const next = state.selectedIndex < 0
                        ? 0
                        : Math.min(state.selectedIndex + 1, count - 1);
                    if (next !== state.selectedIndex) {
                        state.selectedIndex = next;
                        emitSelect(typed, next);
                    }
                    return true;
                }
                case 'ArrowUp': {
                    const next = state.selectedIndex <= 0 ? 0 : state.selectedIndex - 1;
                    if (next !== state.selectedIndex) {
                        state.selectedIndex = next;
                        emitSelect(typed, next);
                    }
                    return true;
                }
                case 'ArrowRight': {
                    const target = state.selectedIndex >= 0 ? state.selectedIndex : 0;
                    if (!state.expanded.includes(target)) {
                        setExpanded(typed, target, true);
                        emitToggle(typed, target, true);
                    }
                    return true;
                }
                case 'ArrowLeft': {
                    const target = state.selectedIndex >= 0 ? state.selectedIndex : 0;
                    if (state.expanded.includes(target)) {
                        setExpanded(typed, target, false);
                        emitToggle(typed, target, false);
                    }
                    return true;
                }
                default:
                    return false;
            }
        }

        return false;
    },
};

export const getTreeViewSelectedIndex = (
    runtime: UIRuntime,
    widget: WidgetId
): number | null => {
    const state = runtime.getWidgetState(widget) as TreeViewControllerState | null;
    return state && typeof state.selectedIndex === 'number' ? state.selectedIndex : null;
};

export const getTreeViewExpanded = (
    runtime: UIRuntime,
    widget: WidgetId
): readonly number[] | null => {
    const state = runtime.getWidgetState(widget) as TreeViewControllerState | null;
    return state && Array.isArray(state.expanded) ? [...state.expanded] : null;
};
