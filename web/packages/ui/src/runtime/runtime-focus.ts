import type {
    FocusMoveDirection,
    LayoutBox,
    ResolvedFocusPolicy,
    WidgetEventContext,
    WidgetFocusChangeEvent,
    WidgetId,
} from '../types';
import type { FocusController, FocusControllerHost } from './focus-controller';
import type { StoredWidgetRecord } from './records';
import type { RuntimeControllerResolver } from './runtime-host';
import { requireWidget } from './runtime-tree';

export interface RuntimeFocusHost<TRuntime = unknown> {
    readonly flags: Uint32Array;
    readonly parent: Int32Array;
    readonly sequence: Uint32Array;
    readonly focuses: Array<ResolvedFocusPolicy | null>;
    readonly rootId: WidgetId;
    readonly nextId: number;
    readonly records: Array<StoredWidgetRecord<TRuntime> | null>;
    readonly states: unknown[];
    readonly focusController: FocusController;
    readonly registry: RuntimeControllerResolver;
    getRuntime(): TRuntime;
    isFocusable(index: number): boolean;
    isAncestor(ancestor: number, candidate: number): boolean;
    readBox(index: number): LayoutBox;
}

export function createFocusControllerHost<TRuntime>(host: RuntimeFocusHost<TRuntime>): FocusControllerHost {
    return {
        flags: host.flags,
        parent: host.parent,
        sequence: host.sequence,
        focuses: host.focuses,
        rootId: host.rootId,
        nextId: host.nextId,
        isFocusable: (index) => host.isFocusable(index),
        isAncestor: (ancestor, candidate) => host.isAncestor(ancestor, candidate),
        readBox: (index) => host.readBox(index),
    };
}

export function setFocus<TRuntime>(
    host: RuntimeFocusHost<TRuntime>,
    widget: WidgetId | null,
    reason: WidgetFocusChangeEvent['reason'] = 'api',
    direction?: FocusMoveDirection
): boolean {
    if (widget !== null) {
        const target = requireWidget(host.flags, widget);
        if (!host.isFocusable(target)) {
            return false;
        }
        widget = target as WidgetId;
    }
    return host.focusController.setFocus(widget, createFocusControllerHost(host), {
        reason,
        direction,
        onFocusedChange: (next, prev) => {
            if (prev !== null) {
                emitFocusChange(host, prev as number, false, reason, direction);
            }
            if (next !== null) {
                emitFocusChange(host, next as number, true, reason, direction);
            }
        },
    });
}

export function moveFocus<TRuntime>(
    host: RuntimeFocusHost<TRuntime>,
    direction: FocusMoveDirection
): WidgetId | null {
    return host.focusController.moveFocus(
        direction,
        createFocusControllerHost(host),
        (widget, reason, moveDirection) => setFocus(host, widget, reason, moveDirection)
    );
}

export function emitFocusChange<TRuntime>(
    host: RuntimeFocusHost<TRuntime>,
    index: number,
    focused: boolean,
    reason: WidgetFocusChangeEvent['reason'],
    direction?: FocusMoveDirection
): void {
    const record = host.records[index];
    if (!record) {
        return;
    }
    const event: WidgetFocusChangeEvent = {
        type: 'widget-focus',
        focused,
        reason,
    };
    const context: WidgetEventContext<Record<string, unknown>, TRuntime> = {
        runtime: host.getRuntime(),
        widget: index as WidgetId,
        props: record.props,
    };
    if (focused) {
        void record.handlers?.focus?.(event, context);
    } else {
        void record.handlers?.blur?.(event, context);
    }
    const controller = record.controller ? host.registry.resolve(record.controller) : null;
    if (controller) {
        const controllerContext = {
            runtime: host.getRuntime(),
            widget: index as WidgetId,
            props: record.props,
            state: host.states[index],
            reason,
            direction,
        };
        if (focused) {
            controller.focus?.(controllerContext);
        } else {
            controller.blur?.(controllerContext);
        }
    }
}
