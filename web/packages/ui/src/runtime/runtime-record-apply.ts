import { compileLayoutInput } from '../layout';
import type { FontRegistry } from '../font';
import { WidgetNotFoundError } from '../errors';
import type {
    ResolvedFocusPolicy,
    ResolvedLayout,
    ResolvedTextBlock,
    ResolvedWidgetImage,
    ResolvedWidgetStyle,
    TextLayoutResult,
    WidgetEventContext,
    WidgetEventHandlers,
    WidgetId,
    WidgetPatch,
} from '../types';
import type { FocusController } from './focus-controller';
import { NodeFlag } from './node-flags';
import {
    compileWidgetFocus,
    compileWidgetImage,
    compileWidgetStyle,
    compileWidgetText,
    type StoredWidgetRecord,
} from './records';
import type { RuntimeControllerResolver } from './runtime-host';
import {
    mergeFocusInput,
    mergeHandlers,
    mergeImageInput,
    mergeLayoutInput,
    mergeProps,
    mergeStyleInput,
    mergeTextInput,
} from './internals';
import type { WidgetController } from '../widget';

export interface RuntimeRecordHost<TRuntime = unknown> {
    readonly records: Array<StoredWidgetRecord<TRuntime> | null>;
    layouts: Array<ResolvedLayout | null>;
    styles: Array<ResolvedWidgetStyle | null>;
    texts: Array<ResolvedTextBlock | null>;
    images: Array<ResolvedWidgetImage | null>;
    focuses: Array<ResolvedFocusPolicy | null>;
    textLayouts: Array<TextLayoutResult | null>;
    textLayoutWidths: number[];
    readonly states: unknown[];
    readonly flags: Uint32Array;
    readonly fonts: FontRegistry;
    readonly locale: string;
    readonly registry: RuntimeControllerResolver;
    readonly focusController: FocusController;
    readonly controllerResolveCache: Map<string, WidgetController<any, any, any> | null>;
    layoutDirty: boolean;
    readonly dirtyNodes: Set<number>;
    getRuntime(): TRuntime;
    requireWidget(widget: WidgetId | null): number;
}

export function applyWidgetPatch<TRuntime>(
    host: RuntimeRecordHost<TRuntime>,
    widget: WidgetId,
    patch: WidgetPatch<Record<string, unknown>, TRuntime>
): void {
    const index = host.requireWidget(widget);
    const current = host.records[index];
    if (!current) {
        throw new WidgetNotFoundError(index);
    }
    const previousController = current.controller;
    const previousProps = current.props;
    const merged: StoredWidgetRecord<TRuntime> = {
        role: patch.role ?? current.role,
        controller: patch.controller ?? current.controller,
        key: patch.key ?? current.key,
        props: mergeProps(current.props, patch.props as Readonly<Record<string, unknown>> | undefined),
        enabled: patch.enabled ?? current.enabled,
        interactive: patch.interactive ?? current.interactive,
        layoutInput: mergeLayoutInput(current.layoutInput, patch.layout),
        styleInput: mergeStyleInput(current.styleInput, patch.style),
        textInput: mergeTextInput(current.textInput, patch.text),
        imageInput: mergeImageInput(current.imageInput, patch.image),
        focusInput: mergeFocusInput(current.focusInput, patch.focus),
        handlers: mergeHandlers(
            current.handlers,
            patch.handlers as WidgetEventHandlers<Record<string, unknown>, TRuntime> | undefined
        ),
    };
    host.records[index] = merged;
    const styleOnly = !patch.layout && !patch.text && !patch.image && !patch.focus && !patch.controller && !patch.role && patch.enabled === undefined && patch.interactive === undefined;
    applyRecord(host, index, previousProps, previousController, false, styleOnly);
}

export function applyRecord<TRuntime>(
    host: RuntimeRecordHost<TRuntime>,
    index: number,
    previousProps: Readonly<Record<string, unknown>> | null,
    previousController: string | null,
    initial: boolean,
    styleOnly = false
): void {
    const record = host.records[index];
    if (!record) {
        throw new WidgetNotFoundError(index);
    }
    const previousResolvedController = previousController ? host.registry.resolve(previousController) : null;
    const nextResolvedController = record.controller ? host.registry.resolve(record.controller) : null;
    if (!initial && previousResolvedController && previousResolvedController !== nextResolvedController) {
        previousResolvedController.disposeState?.(host.states[index], host.getRuntime(), index as WidgetId);
        host.states[index] = undefined;
    }
    host.layouts[index] = compileLayoutInput(record.layoutInput);
    host.styles[index] = compileWidgetStyle(record.styleInput);
    host.texts[index] = compileWidgetText(record.textInput, {
        defaultFamily: host.fonts.getDefaultFamily(),
        locale: host.locale,
        fallbackColor: host.styles[index]!.color,
    });
    host.images[index] = compileWidgetImage(record.imageInput);
    host.focuses[index] = compileWidgetFocus(record.focusInput, record.interactive);
    host.textLayouts[index] = null;
    host.textLayoutWidths[index] = Number.NaN;
    updateFlags(host, index);
    if (!initial && previousResolvedController === nextResolvedController && nextResolvedController && previousProps) {
        nextResolvedController.update?.(createControllerContext(host, index), previousProps);
    } else if (nextResolvedController) {
        host.states[index] = nextResolvedController.createState?.(record.props, host.getRuntime(), index as WidgetId);
        nextResolvedController.mount?.(createControllerContext(host, index));
    }
    if (!styleOnly) {
        host.layoutDirty = true;
        host.dirtyNodes.add(index);
    }
    host.focusController.markDirty();
}

export function updateFlags<TRuntime>(host: RuntimeRecordHost<TRuntime>, index: number): void {
    const style = host.styles[index]!;
    const focus = host.focuses[index]!;
    const record = host.records[index]!;
    let flags = NodeFlag.Allocated;
    if (style.visible) {
        flags |= NodeFlag.Visible;
    }
    if (record.enabled) {
        flags |= NodeFlag.Enabled;
    }
    if (record.interactive) {
        flags |= NodeFlag.Interactive;
    }
    if (focus.focusable) {
        flags |= NodeFlag.Focusable;
    }
    flags |= NodeFlag.TextDirty;
    host.flags[index] = flags;
}

export function createControllerContext<TRuntime>(
    host: RuntimeRecordHost<TRuntime>,
    index: number
): WidgetEventContext<Record<string, unknown>, TRuntime> & {
    readonly state: unknown;
} {
    const record = host.records[index]!;
    return {
        runtime: host.getRuntime(),
        widget: index as WidgetId,
        props: record.props,
        state: host.states[index],
    };
}

export function resolveControllerCached<TRuntime>(
    host: RuntimeRecordHost<TRuntime>,
    controllerName: string | null
): WidgetController<any, any, any> | null {
    if (!controllerName) {
        return null;
    }
    const cached = host.controllerResolveCache.get(controllerName);
    if (cached !== undefined) {
        return cached;
    }
    const resolved = host.registry.resolve(controllerName);
    host.controllerResolveCache.set(controllerName, resolved);
    return resolved;
}
