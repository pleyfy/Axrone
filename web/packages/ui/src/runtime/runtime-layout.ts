import type { FontRegistry } from '../font';
import { UILayoutEngine, type LayoutTreeAdapter } from '../layout';
import type { TextLayoutEngine } from '../text';
import type {
    LayoutBox,
    ResolvedLayout,
    ResolvedTextBlock,
    ResolvedWidgetImage,
    SizeLike,
    TextLayoutConstraint,
    TextLayoutResult,
    WidgetId,
} from '../types';
import type { AutoSizeService } from './autosize-service';
import { measureImageContent } from './runtime-frame';
import type { StoredWidgetRecord } from './records';
import type { RuntimeControllerResolver, RuntimeLayoutDirtyState } from './runtime-host';
import { isVisible, requireWidget } from './runtime-tree';

export interface RuntimeLayoutHost<TRuntime = unknown> extends RuntimeLayoutDirtyState {
    readonly layoutEngine: UILayoutEngine<WidgetId>;
    readonly autoSizeService: AutoSizeService;
    readonly fonts: FontRegistry;
    readonly textEngine: TextLayoutEngine;
    readonly rootId: WidgetId;
    readonly viewportWidth: number;
    readonly viewportHeight: number;
    lastLayoutPasses: number;
    readonly liveCount: number;
    readonly flags: Uint32Array;
    readonly records: Array<StoredWidgetRecord<TRuntime> | null>;
    readonly parent: Int32Array;
    readonly depth: Uint16Array;
    readonly firstChild: Int32Array;
    readonly nextSibling: Int32Array;
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
    layouts: Array<ResolvedLayout | null>;
    readonly texts: Array<ResolvedTextBlock | null>;
    readonly images: Array<ResolvedWidgetImage | null>;
    readonly states: unknown[];
    textLayouts: Array<TextLayoutResult | null>;
    textLayoutWidths: number[];
    readonly registry: RuntimeControllerResolver;
    getRuntime(): TRuntime;
}

export function createLayoutAdapter<TRuntime>(host: RuntimeLayoutHost<TRuntime>): LayoutTreeAdapter<WidgetId> {
    return {
        root: host.rootId,
        getLayout: (node) => host.layouts[node as number]!,
        getFirstChild: (node) => {
            const child = host.firstChild[node as number];
            return child === 0 ? null : (child as WidgetId);
        },
        getNextSibling: (node) => {
            const sibling = host.nextSibling[node as number];
            return sibling === 0 ? null : (sibling as WidgetId);
        },
        measureContent: (node, constraints) => measureContent(host, node as number, constraints),
        setBox: (node, box) => writeBox(host, node as number, box),
        isVisible: (node) => isVisible(host.flags, node as number),
    };
}

export function canScopedRelayout<TRuntime>(host: RuntimeLayoutHost<TRuntime>): boolean {
    if (host.dirtyNodes.size === 0 || host.structuralDirty) {
        return false;
    }
    if (host.dirtyNodes.has(host.rootId)) {
        return false;
    }
    return host.dirtyNodes.size <= host.liveCount * 0.5;
}

export function scopedRelayout<TRuntime>(
    host: RuntimeLayoutHost<TRuntime>,
    adapter: LayoutTreeAdapter<WidgetId>,
    viewport: Readonly<SizeLike>
): void {
    const parents = new Set<number>();
    for (const nodeId of host.dirtyNodes) {
        const parent = host.parent[nodeId];
        if (parent !== 0) {
            parents.add(parent);
        }
    }
    const sortedParents = Array.from(parents).sort((left, right) => host.depth[left] - host.depth[right]);
    for (const parentId of sortedParents) {
        const box = readBox(host, parentId);
        const grandparent = host.parent[parentId];
        const gpBox = grandparent !== 0 ? readBox(host, grandparent) : null;
        const availWidth = gpBox ? gpBox.contentWidth : viewport.width;
        const availHeight = gpBox ? gpBox.contentHeight : viewport.height;
        host.layoutEngine.computeSubtree(adapter, viewport, parentId as WidgetId, box.x, box.y, availWidth, availHeight);
    }
}

export function ensureLayoutUpToDate<TRuntime>(host: RuntimeLayoutHost<TRuntime>): void {
    if (!host.layoutDirty) {
        return;
    }
    const adapter = createLayoutAdapter(host);
    const viewportSize = { width: host.viewportWidth, height: host.viewportHeight };
    if (canScopedRelayout(host)) {
        scopedRelayout(host, adapter, viewportSize);
    } else {
        host.layoutEngine.compute(adapter, viewportSize);
    }
    clearTranslationOffsets(host);
    host.layoutDirty = false;
    host.dirtyNodes.clear();
    host.structuralDirty = false;
    host.lastLayoutPasses = host.layoutEngine.getLayoutPassCount();
}

export function translateSubtreeBoxes<TRuntime>(
    host: RuntimeLayoutHost<TRuntime>,
    index: number,
    dx: number,
    dy: number
): void {
    const stack = [index];
    while (stack.length > 0) {
        const current = stack.pop()!;
        host.boxX[current] += dx;
        host.boxY[current] += dy;
        host.contentX[current] += dx;
        host.contentY[current] += dy;
        for (let child = host.firstChild[current]; child !== 0; child = host.nextSibling[child]) {
            stack.push(child);
        }
    }
}

export function translateSubtreeOffsets<TRuntime>(
    host: RuntimeLayoutHost<TRuntime>,
    index: number,
    dx: number,
    dy: number
): void {
    const stack = [index];
    while (stack.length > 0) {
        const current = stack.pop()!;
        host.translateX[current] += dx;
        host.translateY[current] += dy;
        for (let child = host.firstChild[current]; child !== 0; child = host.nextSibling[child]) {
            stack.push(child);
        }
    }
}

export function clearTranslationOffsets<TRuntime>(host: RuntimeLayoutHost<TRuntime>): void {
    for (let i = 0; i < host.records.length; i++) {
        host.translateX[i] = 0;
        host.translateY[i] = 0;
    }
}

export function setContentOffset<TRuntime>(host: RuntimeLayoutHost<TRuntime>, widget: WidgetId, offsetX: number, offsetY: number): void {
    const index = requireWidget(host.flags, widget);
    const layout = host.layouts[index];
    if (!layout) {
        return;
    }
    const deltaX = offsetX - layout.contentOffsetX;
    const deltaY = offsetY - layout.contentOffsetY;
    if (deltaX === 0 && deltaY === 0) {
        return;
    }
    host.layouts[index] = { ...layout, contentOffsetX: offsetX, contentOffsetY: offsetY };
    const record = host.records[index];
    if (
        record &&
        (record.layoutInput.contentOffsetX !== undefined || record.layoutInput.contentOffsetY !== undefined)
    ) {
        host.records[index] = {
            ...record,
            layoutInput: { ...record.layoutInput, contentOffsetX: offsetX, contentOffsetY: offsetY },
        };
    }
    const contentShiftX = -deltaX;
    const contentShiftY = -deltaY;
    host.contentX[index] += contentShiftX;
    host.contentY[index] += contentShiftY;
    for (let child = host.firstChild[index]; child !== 0; child = host.nextSibling[child]) {
        translateSubtreeBoxes(host, child, contentShiftX, contentShiftY);
    }
}

export function translateWidgetBox<TRuntime>(host: RuntimeLayoutHost<TRuntime>, widget: WidgetId, dx: number, dy: number): void {
    const index = requireWidget(host.flags, widget);
    if (dx === 0 && dy === 0) {
        return;
    }
    translateSubtreeOffsets(host, index, dx, dy);
}

export function measureContent<TRuntime>(
    host: RuntimeLayoutHost<TRuntime>,
    index: number,
    constraints: Readonly<SizeLike>
): SizeLike {
    const text = host.texts[index];
    const image = host.images[index];
    const controllerType = host.records[index]?.controller;
    if (controllerType) {
        const controller = host.registry.resolve(controllerType);
        const measured = controller?.measure?.({
            runtime: host.getRuntime(),
            widget: index as WidgetId,
            props: host.records[index]!.props,
            state: host.states[index],
            availableWidth: constraints.width,
            availableHeight: constraints.height,
        });
        if (measured) {
            return measured;
        }
    }
    let measuredWidth = 0;
    let measuredHeight = 0;
    if (image) {
        const imageSize = measureImageContent(image, constraints);
        measuredWidth = Math.max(measuredWidth, imageSize.width);
        measuredHeight = Math.max(measuredHeight, imageSize.height);
    }
    if (text && text.value.length > 0) {
        const width = Number.isFinite(constraints.width)
            ? Math.max(0, constraints.width)
            : Number.POSITIVE_INFINITY;
        if (!host.textLayouts[index] || host.textLayoutWidths[index] !== width) {
            host.textLayouts[index] = measureTextWithAutoSize(host, text, {
                width,
                height: constraints.height,
            });
            host.textLayoutWidths[index] = width;
        }
        measuredWidth = Math.max(measuredWidth, host.textLayouts[index]!.width);
        measuredHeight = Math.max(measuredHeight, host.textLayouts[index]!.height);
    }
    return { width: measuredWidth, height: measuredHeight };
}

export function writeBox<TRuntime>(host: RuntimeLayoutHost<TRuntime>, index: number, box: LayoutBox): void {
    host.boxX[index] = box.x;
    host.boxY[index] = box.y;
    host.boxWidth[index] = box.width;
    host.boxHeight[index] = box.height;
    host.contentX[index] = box.contentX;
    host.contentY[index] = box.contentY;
    host.contentWidth[index] = box.contentWidth;
    host.contentHeight[index] = box.contentHeight;
}

export function readBox<TRuntime>(host: RuntimeLayoutHost<TRuntime>, index: number): LayoutBox {
    return {
        x: host.boxX[index] + host.translateX[index],
        y: host.boxY[index] + host.translateY[index],
        width: host.boxWidth[index],
        height: host.boxHeight[index],
        contentX: host.contentX[index] + host.translateX[index],
        contentY: host.contentY[index] + host.translateY[index],
        contentWidth: host.contentWidth[index],
        contentHeight: host.contentHeight[index],
    };
}

export function measureTextWithAutoSize<TRuntime>(
    host: RuntimeLayoutHost<TRuntime>,
    text: ResolvedTextBlock,
    constraints: TextLayoutConstraint
): TextLayoutResult {
    return host.autoSizeService.measure(host, text, constraints);
}

export function resolveTextLayoutForRender<TRuntime>(
    host: RuntimeLayoutHost<TRuntime>,
    index: number
): TextLayoutResult | null {
    const text = host.texts[index];
    if (!text) {
        return null;
    }
    const width = host.contentWidth[index];
    if (!host.textLayouts[index] || host.textLayoutWidths[index] !== width) {
        const layoutWidth = host.textLayoutWidths[index];
        const layoutResult = host.textLayouts[index];
        const layoutHadInfinity = layoutResult && (layoutWidth === undefined || !Number.isFinite(layoutWidth));
        if (layoutHadInfinity && layoutResult.lines.length === 1 && layoutResult.width <= width + 1e-4) {
            host.textLayoutWidths[index] = width;
        } else {
            host.textLayouts[index] = measureTextWithAutoSize(host, text, {
                width,
                height: host.contentHeight[index],
            });
            host.textLayoutWidths[index] = width;
        }
    }
    const result = host.textLayouts[index];
    return result;
}
