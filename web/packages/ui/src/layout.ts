import { clamp, resolveLength } from './layout/normalization';
import type {
    AlignMode,
    EdgeInsets,
    LayoutBox,
    ReadonlyColor,
    ResolvedLayout,
    SizeLike,
} from './types';

export {
    compileLength,
    compileLayoutInput,
    normalizeAnchor,
    normalizeCorners,
    normalizeEdges,
    resolveLength,
} from './layout/normalization';

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
    padding: EdgeInsets,
    contentOffsetX: number,
    contentOffsetY: number
): LayoutBox => ({
    x,
    y,
    width,
    height,
    contentX: x + padding.left - contentOffsetX,
    contentY: y + padding.top - contentOffsetY,
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
        const box = createBox(
            x,
            y,
            measured.width,
            measured.height,
            layout.padding,
            layout.contentOffsetX,
            layout.contentOffsetY
        );
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
    Anchor,
    CornerRadii,
    EdgeInsets,
    LayoutBox,
    ReadonlyColor,
    ResolvedLayout,
    ResolvedLength,
    SizeLike,
    WidgetLayoutInput,
} from './types';
