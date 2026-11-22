import { WidgetNotFoundError, WidgetTreeIntegrityError } from '../errors';
import type {
    ResolvedFocusPolicy,
    ResolvedLayout,
    ResolvedTextBlock,
    ResolvedWidgetImage,
    ResolvedWidgetStyle,
    TextLayoutResult,
    WidgetId,
} from '../types';
import type { ControllerEventBus } from './controller-event-bus';
import type { FocusController } from './focus-controller';
import { NodeFlag } from './node-flags';
import type { StoredWidgetRecord } from './records';
import type { RuntimeControllerResolver, RuntimeLayoutDirtyState, RuntimePointerState } from './runtime-host';

export interface RuntimeTreeLinksHost {
    parent: Int32Array;
    firstChild: Int32Array;
    lastChild: Int32Array;
    previousSibling: Int32Array;
    nextSibling: Int32Array;
    depth: Uint16Array;
}

export interface RuntimeTreeDirtyHost extends RuntimeLayoutDirtyState {
    readonly focusController: FocusController;
}

export interface RuntimeTreeStoreHost<TRuntime = unknown>
    extends RuntimeTreeLinksHost, RuntimePointerState {
    readonly rootId: WidgetId;
    flags: Uint32Array;
    sequence: Uint32Array;
    boxX: Float32Array;
    boxY: Float32Array;
    boxWidth: Float32Array;
    boxHeight: Float32Array;
    contentX: Float32Array;
    contentY: Float32Array;
    contentWidth: Float32Array;
    contentHeight: Float32Array;
    translateX: number[];
    translateY: number[];
    records: Array<StoredWidgetRecord<TRuntime> | null>;
    layouts: Array<ResolvedLayout | null>;
    styles: Array<ResolvedWidgetStyle | null>;
    texts: Array<ResolvedTextBlock | null>;
    images: Array<ResolvedWidgetImage | null>;
    focuses: Array<ResolvedFocusPolicy | null>;
    textLayouts: Array<TextLayoutResult | null>;
    textLayoutWidths: number[];
    states: unknown[];
    freeList: number[];
    nextId: number;
    nextSequence: number;
    liveCount: number;
    layoutDirty: boolean;
    structuralDirty: boolean;
    readonly dirtyNodes: Set<number>;
    readonly focusController: FocusController;
    readonly controllerEventBus: ControllerEventBus;
    readonly registry: RuntimeControllerResolver;
    getRuntime(): TRuntime;
    isAncestor(ancestor: number, candidate: number): boolean;
}

export function requireWidget(flags: Uint32Array, widget: WidgetId | null): number {
    if (widget === null) {
        throw new WidgetNotFoundError(-1);
    }
    const index = widget as number;
    if ((flags[index] & NodeFlag.Allocated) === 0) {
        throw new WidgetNotFoundError(index);
    }
    return index;
}

export function isVisible(flags: Uint32Array, index: number): boolean {
    return (flags[index] & NodeFlag.Visible) !== 0;
}

export function isFocusable(flags: Uint32Array, index: number): boolean {
    return (
        (flags[index] & NodeFlag.Focusable) !== 0 &&
        (flags[index] & NodeFlag.Enabled) !== 0 &&
        (flags[index] & NodeFlag.Visible) !== 0
    );
}

export function isAncestor(parent: Int32Array, ancestor: number, candidate: number): boolean {
    for (let current = candidate; current !== 0; current = parent[current]) {
        if (current === ancestor) {
            return true;
        }
    }
    return false;
}

export function markTreeChanged(host: RuntimeTreeDirtyHost, index: number): void {
    host.dirtyNodes.add(index);
    host.layoutDirty = true;
    host.focusController.markDirty();
    host.structuralDirty = true;
}

export function detachNode(host: RuntimeTreeLinksHost, index: number): void {
    const parent = host.parent[index];
    if (parent === 0) {
        return;
    }
    const previous = host.previousSibling[index];
    const next = host.nextSibling[index];
    if (previous !== 0) {
        host.nextSibling[previous] = next;
    } else {
        host.firstChild[parent] = next;
    }
    if (next !== 0) {
        host.previousSibling[next] = previous;
    } else {
        host.lastChild[parent] = previous;
    }
    host.parent[index] = 0;
    host.previousSibling[index] = 0;
    host.nextSibling[index] = 0;
}

export function refreshDepths(host: RuntimeTreeLinksHost, index: number, depth: number): void {
    const queue = [index];
    host.depth[index] = depth;
    while (queue.length > 0) {
        const current = queue.shift()!;
        const currentDepth = host.depth[current];
        for (let child = host.firstChild[current]; child !== 0; child = host.nextSibling[child]) {
            host.depth[child] = currentDepth + 1;
            queue.push(child);
        }
    }
}

export function insertChildBefore(
    host: RuntimeTreeStoreHost,
    parent: WidgetId,
    child: WidgetId,
    before: WidgetId | null
): void {
    const parentIndex = requireWidget(host.flags, parent);
    const childIndex = requireWidget(host.flags, child);
    if (childIndex === host.rootId) {
        throw new WidgetTreeIntegrityError('The root widget cannot be re-parented.');
    }
    if (parentIndex === childIndex || host.isAncestor(childIndex, parentIndex)) {
        throw new WidgetTreeIntegrityError('Re-parenting would create a cycle.', {
            parent,
            child,
            before,
        });
    }
    if (before !== null) {
        const beforeIndex = requireWidget(host.flags, before);
        if (host.parent[beforeIndex] !== parentIndex) {
            throw new WidgetTreeIntegrityError('The insertion reference must already belong to the parent.', {
                parent,
                child,
                before,
            });
        }
    }
    detachNode(host, childIndex);
    host.parent[childIndex] = parentIndex;
    if (before === null) {
        const last = host.lastChild[parentIndex];
        if (last === 0) {
            host.firstChild[parentIndex] = childIndex;
            host.lastChild[parentIndex] = childIndex;
        } else {
            host.nextSibling[last] = childIndex;
            host.previousSibling[childIndex] = last;
            host.lastChild[parentIndex] = childIndex;
        }
    } else {
        const beforeIndex = before as number;
        const previous = host.previousSibling[beforeIndex];
        host.nextSibling[childIndex] = beforeIndex;
        host.previousSibling[beforeIndex] = childIndex;
        if (previous !== 0) {
            host.nextSibling[previous] = childIndex;
            host.previousSibling[childIndex] = previous;
        } else {
            host.firstChild[parentIndex] = childIndex;
        }
    }
    refreshDepths(host, childIndex, host.depth[parentIndex] + 1);
    markTreeChanged(host, childIndex);
}

export function removeWidgetNode(host: RuntimeTreeStoreHost, widget: WidgetId): void {
    const index = requireWidget(host.flags, widget);
    if (index === host.rootId) {
        throw new WidgetTreeIntegrityError('The root widget cannot be removed.');
    }
    const traversal: number[] = [];
    const stack = [index];
    while (stack.length > 0) {
        const current = stack.pop()!;
        traversal.push(current);
        for (let child = host.firstChild[current]; child !== 0; child = host.nextSibling[child]) {
            stack.push(child);
        }
    }
    detachNode(host, index);
    for (let offset = traversal.length - 1; offset >= 0; offset -= 1) {
        destroyNode(host, traversal[offset]);
    }
    host.layoutDirty = true;
    host.focusController.markDirty();
    host.structuralDirty = true;
}

export function collectSubtreeWidgetIds(
    host: Pick<RuntimeTreeStoreHost, 'flags' | 'lastChild' | 'previousSibling' | 'nextSibling'>,
    widget: WidgetId
): WidgetId[] {
    const index = requireWidget(host.flags, widget);
    const widgets: WidgetId[] = [];
    const stack = [index];

    while (stack.length > 0) {
        const current = stack.pop()!;
        widgets.push(current as WidgetId);
        for (let child = host.lastChild[current]; child !== 0; child = host.previousSibling[child]) {
            stack.push(child);
        }
    }

    return widgets;
}

export function allocate(host: RuntimeTreeStoreHost): number {
    const id = host.freeList.pop() ?? host.nextId++;
    ensureCapacity(host, id + 1);
    host.flags[id] = NodeFlag.Allocated;
    host.sequence[id] = host.nextSequence++;
    host.liveCount += 1;
    return id;
}

export function ensureCapacity(host: RuntimeTreeStoreHost, minimum: number): void {
    if (minimum < host.parent.length) {
        return;
    }
    let nextCapacity = host.parent.length;
    while (nextCapacity <= minimum) {
        nextCapacity *= 2;
    }
    host.parent = growTypedArray(host.parent, nextCapacity);
    host.firstChild = growTypedArray(host.firstChild, nextCapacity);
    host.lastChild = growTypedArray(host.lastChild, nextCapacity);
    host.previousSibling = growTypedArray(host.previousSibling, nextCapacity);
    host.nextSibling = growTypedArray(host.nextSibling, nextCapacity);
    host.sequence = growTypedArray(host.sequence, nextCapacity);
    host.depth = growTypedArray(host.depth, nextCapacity);
    host.flags = growTypedArray(host.flags, nextCapacity);
    host.boxX = growTypedArray(host.boxX, nextCapacity);
    host.boxY = growTypedArray(host.boxY, nextCapacity);
    host.boxWidth = growTypedArray(host.boxWidth, nextCapacity);
    host.boxHeight = growTypedArray(host.boxHeight, nextCapacity);
    host.contentX = growTypedArray(host.contentX, nextCapacity);
    host.contentY = growTypedArray(host.contentY, nextCapacity);
    host.contentWidth = growTypedArray(host.contentWidth, nextCapacity);
    host.contentHeight = growTypedArray(host.contentHeight, nextCapacity);
    host.translateX.length = nextCapacity;
    host.translateY.length = nextCapacity;
    host.translateX.fill(0, host.records.length);
    host.translateY.fill(0, host.records.length);
    host.records.length = nextCapacity;
    host.layouts.length = nextCapacity;
    host.styles.length = nextCapacity;
    host.texts.length = nextCapacity;
    host.images.length = nextCapacity;
    host.focuses.length = nextCapacity;
    host.states.length = nextCapacity;
    host.textLayouts.length = nextCapacity;
    host.textLayoutWidths.length = nextCapacity;
}

export function growTypedArray<TArray extends Int32Array | Uint32Array | Uint16Array | Float32Array>(
    current: TArray,
    length: number
): TArray {
    const Ctor = current.constructor as new (size: number) => TArray;
    const next = new Ctor(length);
    next.set(current);
    return next;
}

export function destroyNode(host: RuntimeTreeStoreHost, index: number): void {
    const focusedWidget = host.focusController.getFocused();
    if (focusedWidget && host.isAncestor(index, focusedWidget as number)) {
        host.focusController.clearFocus();
    }
    const hovered = host.getHovered();
    if (hovered && host.isAncestor(index, hovered as number)) {
        host.setHovered(null);
    }
    const pressed = host.getPressed();
    if (pressed && host.isAncestor(index, pressed as number)) {
        host.setPressed(null);
    }
    const controller = host.records[index]?.controller
        ? host.registry.resolve(host.records[index]!.controller)
        : null;
    controller?.disposeState?.(host.states[index], host.getRuntime(), index as WidgetId);
    host.controllerEventBus.clear(index as WidgetId);
    host.records[index] = null;
    host.layouts[index] = null;
    host.styles[index] = null;
    host.texts[index] = null;
    host.images[index] = null;
    host.focuses[index] = null;
    host.states[index] = undefined;
    host.textLayouts[index] = null;
    host.textLayoutWidths[index] = Number.NaN;
    host.parent[index] = 0;
    host.firstChild[index] = 0;
    host.lastChild[index] = 0;
    host.previousSibling[index] = 0;
    host.nextSibling[index] = 0;
    host.flags[index] = 0;
    host.freeList.push(index);
    host.liveCount -= 1;
}
