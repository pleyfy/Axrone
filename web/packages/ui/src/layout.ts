import { UIError, UIErrorCode } from './errors';
import type {
    AlignMode,
    Anchor,
    AnchorInput,
    CornerInput,
    CornerRadii,
    EdgeInput,
    EdgeInsets,
    LayoutBox,
    ReadonlyColor,
    ResolvedLayout,
    ResolvedLength,
    SizeLike,
    WidgetLayoutInput,
} from './types';

const ZERO_EDGES: EdgeInsets = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 });
const ZERO_CORNERS: CornerRadii = Object.freeze({ topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 });
const DEFAULT_ANCHOR: Anchor = Object.freeze({
    x: 0,
    y: 0,
    pivotX: 0,
    pivotY: 0,
    offsetX: 0,
    offsetY: 0,
    stretch: false,
});
const AUTO_LENGTH: ResolvedLength = Object.freeze({ kind: 'auto', value: 0 });
const CONTENT_LENGTH: ResolvedLength = Object.freeze({ kind: 'content', value: 0 });

const clamp = (value: number, min: number, max: number): number => {
    if (value < min) {
        return min;
    }
    if (value > max) {
        return max;
    }
    return value;
};

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

const isEdgeRecord = (
    value: EdgeInput
): value is Readonly<Partial<Record<'top' | 'right' | 'bottom' | 'left', number>>> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const createLength = (kind: ResolvedLength['kind'], value: number): ResolvedLength => ({ kind, value });

export const compileLength = (input: number | string | undefined): ResolvedLength => {
    if (input === undefined || input === 'auto') {
        return AUTO_LENGTH;
    }
    if (input === 'content') {
        return CONTENT_LENGTH;
    }
    if (typeof input === 'number') {
        if (!Number.isFinite(input)) {
            throw new UIError(UIErrorCode.InvalidArgument, 'Length numbers must be finite.', { input });
        }
        return createLength('px', input);
    }
    if (input.endsWith('%')) {
        const value = Number.parseFloat(input.slice(0, -1));
        if (!Number.isFinite(value)) {
            throw new UIError(UIErrorCode.InvalidArgument, 'Percent lengths must contain a valid number.', {
                input,
            });
        }
        return createLength('percent', value / 100);
    }
    if (input.startsWith('stretch:')) {
        const value = Number.parseFloat(input.slice('stretch:'.length));
        if (!Number.isFinite(value) || value <= 0) {
            throw new UIError(UIErrorCode.InvalidArgument, 'Stretch lengths must be greater than zero.', { input });
        }
        return createLength('stretch', value);
    }
    if (input.startsWith('viewport:')) {
        const value = Number.parseFloat(input.slice('viewport:'.length));
        if (!Number.isFinite(value)) {
            throw new UIError(UIErrorCode.InvalidArgument, 'Viewport lengths must contain a valid number.', {
                input,
            });
        }
        return createLength('viewport', value);
    }
    throw new UIError(UIErrorCode.InvalidArgument, 'Unsupported length input.', { input });
};

export const normalizeEdges = (input: EdgeInput | undefined): EdgeInsets => {
    if (input === undefined) {
        return ZERO_EDGES;
    }
    if (typeof input === 'number') {
        return { top: input, right: input, bottom: input, left: input };
    }
    if (Array.isArray(input)) {
        if (input.length === 2) {
            return { top: input[0], right: input[1], bottom: input[0], left: input[1] };
        }
        if (input.length === 4) {
            return {
                top: input[0],
                right: input[1],
                bottom: input[2],
                left: input[3],
            };
        }
    }
    if (!isEdgeRecord(input)) {
        return ZERO_EDGES;
    }
    return {
        top: input.top ?? 0,
        right: input.right ?? 0,
        bottom: input.bottom ?? 0,
        left: input.left ?? 0,
    };
};

export const normalizeCorners = (input: CornerInput | undefined): CornerRadii => {
    if (input === undefined) {
        return ZERO_CORNERS;
    }
    if (typeof input === 'number') {
        return { topLeft: input, topRight: input, bottomRight: input, bottomLeft: input };
    }
    return {
        topLeft: input[0],
        topRight: input[1],
        bottomRight: input[2],
        bottomLeft: input[3],
    };
};

export const normalizeAnchor = (input: AnchorInput | undefined): Anchor => {
    if (input === undefined) {
        return DEFAULT_ANCHOR;
    }
    if (typeof input === 'string') {
        switch (input) {
            case 'top-left':
                return { ...DEFAULT_ANCHOR };
            case 'top':
                return { ...DEFAULT_ANCHOR, x: 0.5, pivotX: 0.5 };
            case 'top-right':
                return { ...DEFAULT_ANCHOR, x: 1, pivotX: 1 };
            case 'left':
                return { ...DEFAULT_ANCHOR, y: 0.5, pivotY: 0.5 };
            case 'center':
                return { ...DEFAULT_ANCHOR, x: 0.5, y: 0.5, pivotX: 0.5, pivotY: 0.5 };
            case 'right':
                return { ...DEFAULT_ANCHOR, x: 1, y: 0.5, pivotX: 1, pivotY: 0.5 };
            case 'bottom-left':
                return { ...DEFAULT_ANCHOR, y: 1, pivotY: 1 };
            case 'bottom':
                return { ...DEFAULT_ANCHOR, x: 0.5, y: 1, pivotX: 0.5, pivotY: 1 };
            case 'bottom-right':
                return { ...DEFAULT_ANCHOR, x: 1, y: 1, pivotX: 1, pivotY: 1 };
            case 'stretch':
                return { ...DEFAULT_ANCHOR, stretch: true };
            default:
                return DEFAULT_ANCHOR;
        }
    }
    return {
        x: input.x ?? 0,
        y: input.y ?? 0,
        pivotX: input.pivotX ?? input.x ?? 0,
        pivotY: input.pivotY ?? input.y ?? 0,
        offsetX: input.offsetX ?? 0,
        offsetY: input.offsetY ?? 0,
        stretch: input.stretch ?? false,
    };
};

export const resolveLength = (
    length: ResolvedLength,
    available: number,
    content: number,
    viewport: number = available
): number => {
    switch (length.kind) {
        case 'px':
            return length.value;
        case 'percent':
            return Number.isFinite(available) ? available * length.value : content;
        case 'stretch':
            return Number.isFinite(available) ? available * length.value : content;
        case 'viewport':
            return Number.isFinite(viewport) ? viewport * length.value : content;
        case 'content':
        case 'auto':
        default:
            return content;
    }
};

export const compileLayoutInput = (input: WidgetLayoutInput | undefined): ResolvedLayout => {
    const inset = input?.inset;
    return {
        display: input?.display ?? 'stack',
        direction: input?.direction ?? 'column',
        gap: input?.gap ?? 0,
        padding: normalizeEdges(input?.padding),
        margin: normalizeEdges(input?.margin),
        width: compileLength(input?.width),
        height: compileLength(input?.height),
        minWidth: input?.minWidth ?? 0,
        minHeight: input?.minHeight ?? 0,
        maxWidth: input?.maxWidth ?? Number.POSITIVE_INFINITY,
        maxHeight: input?.maxHeight ?? Number.POSITIVE_INFINITY,
        grow: Math.max(0, input?.grow ?? 0),
        shrink: Math.max(0, input?.shrink ?? 1),
        basis: compileLength(input?.basis),
        alignItems: input?.alignItems ?? 'start',
        alignSelf: input?.alignSelf ?? 'auto',
        justifyContent: input?.justifyContent ?? 'start',
        position: input?.position ?? 'flow',
        insetTop: inset?.top === undefined ? undefined : compileLength(inset.top),
        insetRight: inset?.right === undefined ? undefined : compileLength(inset.right),
        insetBottom: inset?.bottom === undefined ? undefined : compileLength(inset.bottom),
        insetLeft: inset?.left === undefined ? undefined : compileLength(inset.left),
        anchor: normalizeAnchor(input?.anchor),
        aspectRatio: input?.aspectRatio ?? 0,
        zIndex: input?.zIndex ?? 0,
    };
};

export interface LayoutTreeAdapter<TNode> {
    readonly root: TNode;
    getLayout(node: TNode): ResolvedLayout;
    getFirstChild(node: TNode): TNode | null;
    getNextSibling(node: TNode): TNode | null;
    measureContent(node: TNode, constraints: Readonly<SizeLike>): SizeLike;
    setBox(node: TNode, box: LayoutBox): void;
    isVisible(node: TNode): boolean;
}

interface MeasuredChild<TNode> {
    readonly node: TNode;
    readonly layout: ResolvedLayout;
    width: number;
    height: number;
    readonly margin: EdgeInsets;
    readonly grow: number;
    readonly shrink: number;
}

const sumHorizontal = (edges: EdgeInsets): number => edges.left + edges.right;
const sumVertical = (edges: EdgeInsets): number => edges.top + edges.bottom;

const createBox = (
    x: number,
    y: number,
    width: number,
    height: number,
    padding: EdgeInsets
): LayoutBox => ({
    x,
    y,
    width,
    height,
    contentX: x + padding.left,
    contentY: y + padding.top,
    contentWidth: Math.max(0, width - sumHorizontal(padding)),
    contentHeight: Math.max(0, height - sumVertical(padding)),
});

export class UILayoutEngine<TNode> {
    private layoutPasses = 0;
    private viewportWidth = 0;
    private viewportHeight = 0;

    compute(adapter: LayoutTreeAdapter<TNode>, viewport: Readonly<SizeLike>): void {
        this.layoutPasses = 0;
        this.viewportWidth = viewport.width;
        this.viewportHeight = viewport.height;
        this.layoutNode(adapter, adapter.root, 0, 0, viewport.width, viewport.height, viewport.width, viewport.height);
    }

    getLayoutPassCount(): number {
        return this.layoutPasses;
    }

    private measureNode(
        adapter: LayoutTreeAdapter<TNode>,
        node: TNode,
        availableWidth: number,
        availableHeight: number
    ): SizeLike {
        this.layoutPasses += 1;
        if (!adapter.isVisible(node)) {
            return { width: 0, height: 0 };
        }
        const layout = adapter.getLayout(node);
        const hasChildren = adapter.getFirstChild(node) !== null;
        const padding = layout.padding;
        const intrinsicAvailableWidth = layout.width.kind === 'auto' || layout.width.kind === 'content'
            ? Number.POSITIVE_INFINITY
            : Math.max(0, resolveLength(layout.width, availableWidth, availableWidth, this.viewportWidth) - sumHorizontal(padding));
        const intrinsicAvailableHeight = layout.height.kind === 'auto' || layout.height.kind === 'content'
            ? Number.POSITIVE_INFINITY
            : Math.max(0, resolveLength(layout.height, availableHeight, availableHeight, this.viewportHeight) - sumVertical(padding));
        const content = hasChildren
            ? this.measureChildren(adapter, node, intrinsicAvailableWidth, intrinsicAvailableHeight)
            : adapter.measureContent(node, {
                  width: intrinsicAvailableWidth,
                  height: intrinsicAvailableHeight,
              });
        let width = resolveLength(
            layout.width,
            availableWidth,
            content.width + sumHorizontal(padding),
            this.viewportWidth
        );
        let height = resolveLength(
            layout.height,
            availableHeight,
            content.height + sumVertical(padding),
            this.viewportHeight
        );
        if (layout.aspectRatio > 0) {
            const widthAuto = layout.width.kind === 'auto' || layout.width.kind === 'content';
            const heightAuto = layout.height.kind === 'auto' || layout.height.kind === 'content';
            if (widthAuto && !heightAuto) {
                width = height * layout.aspectRatio;
            } else if (heightAuto && !widthAuto) {
                height = width / layout.aspectRatio;
            } else if (widthAuto && heightAuto) {
                height = width / layout.aspectRatio;
            }
        }
        return {
            width: clamp(width, layout.minWidth, layout.maxWidth),
            height: clamp(height, layout.minHeight, layout.maxHeight),
        };
    }

    private measureChildren(
        adapter: LayoutTreeAdapter<TNode>,
        node: TNode,
        availableWidth: number,
        availableHeight: number
    ): SizeLike {
        const layout = adapter.getLayout(node);
        if (layout.display === 'overlay') {
            let width = 0;
            let height = 0;
            for (let child = adapter.getFirstChild(node); child !== null; child = adapter.getNextSibling(child)) {
                if (!adapter.isVisible(child)) {
                    continue;
                }
                const childLayout = adapter.getLayout(child);
                const measured = this.measureNode(adapter, child, availableWidth, availableHeight);
                width = Math.max(width, measured.width + sumHorizontal(childLayout.margin));
                height = Math.max(height, measured.height + sumVertical(childLayout.margin));
            }
            return { width, height };
        }
        const horizontal = layout.direction === 'row';
        let main = 0;
        let cross = 0;
        let first = true;
        for (let child = adapter.getFirstChild(node); child !== null; child = adapter.getNextSibling(child)) {
            if (!adapter.isVisible(child)) {
                continue;
            }
            const childLayout = adapter.getLayout(child);
            if (childLayout.position === 'absolute') {
                continue;
            }
            const measured = this.measureNode(
                adapter,
                child,
                horizontal ? Number.POSITIVE_INFINITY : availableWidth,
                horizontal ? availableHeight : Number.POSITIVE_INFINITY
            );
            const outerMain = horizontal
                ? measured.width + childLayout.margin.left + childLayout.margin.right
                : measured.height + childLayout.margin.top + childLayout.margin.bottom;
            const outerCross = horizontal
                ? measured.height + childLayout.margin.top + childLayout.margin.bottom
                : measured.width + childLayout.margin.left + childLayout.margin.right;
            if (!first) {
                main += layout.gap;
            }
            first = false;
            main += outerMain;
            cross = Math.max(cross, outerCross);
        }
        return horizontal ? { width: main, height: cross } : { width: cross, height: main };
    }

    private layoutNode(
        adapter: LayoutTreeAdapter<TNode>,
        node: TNode,
        x: number,
        y: number,
        availableWidth: number,
        availableHeight: number,
        forcedWidth?: number,
        forcedHeight?: number
    ): SizeLike {
        const layout = adapter.getLayout(node);
        const measured = {
            width: forcedWidth ?? this.measureNode(adapter, node, availableWidth, availableHeight).width,
            height: forcedHeight ?? this.measureNode(adapter, node, availableWidth, availableHeight).height,
        };
        const box = createBox(x, y, measured.width, measured.height, layout.padding);
        adapter.setBox(node, box);
        if (adapter.getFirstChild(node) !== null) {
            if (layout.display === 'overlay') {
                this.layoutOverlayChildren(adapter, node, box);
            } else {
                this.layoutStackChildren(adapter, node, box);
            }
        }
        return measured;
    }

    private layoutStackChildren(adapter: LayoutTreeAdapter<TNode>, node: TNode, box: LayoutBox): void {
        const layout = adapter.getLayout(node);
        const horizontal = layout.direction === 'row';
        const mainAvailable = horizontal ? box.contentWidth : box.contentHeight;
        const crossAvailable = horizontal ? box.contentHeight : box.contentWidth;
        const flowChildren: MeasuredChild<TNode>[] = [];
        for (let child = adapter.getFirstChild(node); child !== null; child = adapter.getNextSibling(child)) {
            if (!adapter.isVisible(child)) {
                continue;
            }
            const childLayout = adapter.getLayout(child);
            if (childLayout.position === 'absolute') {
                continue;
            }
            const measured = this.measureNode(
                adapter,
                child,
                horizontal ? Number.POSITIVE_INFINITY : crossAvailable,
                horizontal ? crossAvailable : Number.POSITIVE_INFINITY
            );
            let width = measured.width;
            let height = measured.height;
            const baseMainLength = horizontal ? childLayout.width : childLayout.height;
            const baseCrossLength = horizontal ? childLayout.height : childLayout.width;
            if (baseMainLength.kind === 'px' || baseMainLength.kind === 'percent' || baseMainLength.kind === 'viewport') {
                const resolved = resolveLength(baseMainLength, mainAvailable, horizontal ? measured.width : measured.height, horizontal ? this.viewportWidth : this.viewportHeight);
                if (horizontal) {
                    width = resolved;
                } else {
                    height = resolved;
                }
            }
            if (baseCrossLength.kind === 'px' || baseCrossLength.kind === 'percent' || baseCrossLength.kind === 'viewport') {
                const resolved = resolveLength(baseCrossLength, crossAvailable, horizontal ? measured.height : measured.width, horizontal ? this.viewportHeight : this.viewportWidth);
                if (horizontal) {
                    height = resolved;
                } else {
                    width = resolved;
                }
            }
            flowChildren.push({
                node: child,
                layout: childLayout,
                width,
                height,
                margin: childLayout.margin,
                grow: childLayout.grow || (baseMainLength.kind === 'stretch' ? baseMainLength.value : 0),
                shrink: childLayout.shrink,
            });
        }
        let totalMain = 0;
        let totalGrow = 0;
        let totalShrink = 0;
        for (let index = 0; index < flowChildren.length; index += 1) {
            const child = flowChildren[index];
            const childMain = horizontal ? child.width : child.height;
            const outerMain = horizontal
                ? childMain + child.margin.left + child.margin.right
                : childMain + child.margin.top + child.margin.bottom;
            totalMain += outerMain;
            if (index > 0) {
                totalMain += layout.gap;
            }
            totalGrow += child.grow;
            totalShrink += child.shrink;
        }
        const remaining = mainAvailable - totalMain;
        if (remaining > 0 && totalGrow > 0) {
            for (const child of flowChildren) {
                const delta = (remaining * child.grow) / totalGrow;
                if (horizontal) {
                    child.width += delta;
                } else {
                    child.height += delta;
                }
            }
        } else if (remaining < 0 && totalShrink > 0) {
            const deficit = Math.abs(remaining);
            for (const child of flowChildren) {
                const delta = (deficit * child.shrink) / totalShrink;
                if (horizontal) {
                    child.width = Math.max(0, child.width - delta);
                } else {
                    child.height = Math.max(0, child.height - delta);
                }
            }
        }
        let occupiedMain = 0;
        for (let index = 0; index < flowChildren.length; index += 1) {
            const child = flowChildren[index];
            occupiedMain += horizontal
                ? child.width + child.margin.left + child.margin.right
                : child.height + child.margin.top + child.margin.bottom;
            if (index > 0) {
                occupiedMain += layout.gap;
            }
        }
        const slack = Math.max(0, mainAvailable - occupiedMain);
        let cursor = 0;
        let gap = layout.gap;
        switch (layout.justifyContent) {
            case 'center':
                cursor = slack / 2;
                break;
            case 'end':
                cursor = slack;
                break;
            case 'space-between':
                gap = flowChildren.length > 1 ? layout.gap + slack / (flowChildren.length - 1) : layout.gap;
                break;
            case 'space-around':
                gap = flowChildren.length > 0 ? layout.gap + slack / flowChildren.length : layout.gap;
                cursor = gap / 2;
                break;
            case 'space-evenly':
                gap = flowChildren.length > 0 ? layout.gap + slack / (flowChildren.length + 1) : layout.gap;
                cursor = gap;
                break;
            default:
                break;
        }
        for (let index = 0; index < flowChildren.length; index += 1) {
            const child = flowChildren[index];
            const crossAlign: AlignMode = child.layout.alignSelf === 'auto' ? layout.alignItems : child.layout.alignSelf;
            if (crossAlign === 'stretch') {
                if (horizontal) {
                    child.height = Math.max(0, crossAvailable - child.margin.top - child.margin.bottom);
                } else {
                    child.width = Math.max(0, crossAvailable - child.margin.left - child.margin.right);
                }
            }
            const mainStart = cursor + (horizontal ? child.margin.left : child.margin.top);
            const crossSlack = horizontal
                ? crossAvailable - child.height - child.margin.top - child.margin.bottom
                : crossAvailable - child.width - child.margin.left - child.margin.right;
            const crossOffset = this.resolveCrossOffset(crossAlign, crossSlack);
            const childX = horizontal
                ? box.contentX + mainStart
                : box.contentX + child.margin.left + crossOffset;
            const childY = horizontal
                ? box.contentY + child.margin.top + crossOffset
                : box.contentY + mainStart;
            this.layoutNode(adapter, child.node, childX, childY, child.width, child.height, child.width, child.height);
            cursor = mainStart + (horizontal ? child.width + child.margin.right : child.height + child.margin.bottom) + gap;
        }
        for (let child = adapter.getFirstChild(node); child !== null; child = adapter.getNextSibling(child)) {
            if (!adapter.isVisible(child)) {
                continue;
            }
            const childLayout = adapter.getLayout(child);
            if (childLayout.position === 'absolute') {
                this.layoutAbsoluteChild(adapter, child, box);
            }
        }
    }

    private layoutOverlayChildren(adapter: LayoutTreeAdapter<TNode>, node: TNode, box: LayoutBox): void {
        for (let child = adapter.getFirstChild(node); child !== null; child = adapter.getNextSibling(child)) {
            if (!adapter.isVisible(child)) {
                continue;
            }
            this.layoutAbsoluteChild(adapter, child, box);
        }
    }

    private layoutAbsoluteChild(adapter: LayoutTreeAdapter<TNode>, node: TNode, box: LayoutBox): void {
        const layout = adapter.getLayout(node);
        const measured = this.measureNode(adapter, node, box.contentWidth, box.contentHeight);
        let left = layout.insetLeft
            ? resolveLength(layout.insetLeft, box.contentWidth, 0, this.viewportWidth)
            : null;
        let right = layout.insetRight
            ? resolveLength(layout.insetRight, box.contentWidth, 0, this.viewportWidth)
            : null;
        let top = layout.insetTop
            ? resolveLength(layout.insetTop, box.contentHeight, 0, this.viewportHeight)
            : null;
        let bottom = layout.insetBottom
            ? resolveLength(layout.insetBottom, box.contentHeight, 0, this.viewportHeight)
            : null;
        if (layout.anchor.stretch) {
            left ??= 0;
            right ??= 0;
            top ??= 0;
            bottom ??= 0;
        }
        let width = resolveLength(layout.width, box.contentWidth, measured.width, this.viewportWidth);
        let height = resolveLength(layout.height, box.contentHeight, measured.height, this.viewportHeight);
        if (left !== null && right !== null && (layout.width.kind === 'auto' || layout.width.kind === 'content' || layout.width.kind === 'stretch')) {
            width = Math.max(0, box.contentWidth - left - right - layout.margin.left - layout.margin.right);
        }
        if (top !== null && bottom !== null && (layout.height.kind === 'auto' || layout.height.kind === 'content' || layout.height.kind === 'stretch')) {
            height = Math.max(0, box.contentHeight - top - bottom - layout.margin.top - layout.margin.bottom);
        }
        const x = left !== null
            ? box.contentX + left + layout.margin.left
            : right !== null
              ? box.contentX + box.contentWidth - right - width - layout.margin.right
              : box.contentX + box.contentWidth * layout.anchor.x + layout.anchor.offsetX - width * layout.anchor.pivotX;
        const y = top !== null
            ? box.contentY + top + layout.margin.top
            : bottom !== null
              ? box.contentY + box.contentHeight - bottom - height - layout.margin.bottom
              : box.contentY + box.contentHeight * layout.anchor.y + layout.anchor.offsetY - height * layout.anchor.pivotY;
        this.layoutNode(adapter, node, x, y, width, height, width, height);
    }

    private resolveCrossOffset(align: AlignMode, slack: number): number {
        switch (align) {
            case 'center':
                return Math.max(0, slack / 2);
            case 'end':
                return Math.max(0, slack);
            default:
                return 0;
        }
    }
}

export type {
    LayoutBox,
    WidgetLayoutInput,
    ResolvedLayout,
    ResolvedLength,
    EdgeInsets,
    CornerRadii,
    Anchor,
    SizeLike,
    ReadonlyColor,
};