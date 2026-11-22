import { DisposedUIError, UIError, UIErrorCode } from './errors';
import { FontRegistry, ensureDefaultUIFont } from './font';
import { UILayoutEngine } from './layout';
import type { LayoutTreeAdapter } from './layout';
import { NodeFlag } from './runtime/node-flags';
import { ControllerEventBus, type ControllerEventHandler } from './runtime/controller-event-bus';
import { FocusController } from './runtime/focus-controller';
import { AutoSizeService } from './runtime/autosize-service';
import { RenderCommandBuilder, type RenderCommandBuilderHost } from './runtime/render-command-builder';
import { normalizeWidgetRecord, type StoredWidgetRecord } from './runtime/records';
import {
    EMPTY_FOCUS_INPUT,
    EMPTY_LAYOUT_INPUT,
    EMPTY_RECORD_OBJECT,
    EMPTY_STYLE_INPUT,
    cloneData,
} from './runtime/internals';
import { TextLayoutEngine } from './text';
import { WidgetRegistry, type WidgetController } from './widget';
import type { RuntimeTreeStoreHost } from './runtime/runtime-tree';
import {
    collectSubtreeWidgetIds as collectSubtreeIds,
    insertChildBefore as insertChildBeforeNode,
    isAncestor as isAncestorIndex,
    isFocusable as isFocusableFlag,
    isVisible as isVisibleFlag,
    removeWidgetNode,
    requireWidget as requireWidgetIndex,
} from './runtime/runtime-tree';
import type { RuntimeRecordHost } from './runtime/runtime-record-apply';
import {
    applyRecord as applyWidgetRecord,
    applyWidgetPatch,
    resolveControllerCached as resolveControllerCachedByName,
} from './runtime/runtime-record-apply';
import type { RuntimeBindingHost } from './runtime/runtime-binding';
import { rebuildBindingTable, remountControllers } from './runtime/runtime-binding';
import type { RuntimeLayoutHost } from './runtime/runtime-layout';
import {
    createLayoutAdapter as buildLayoutAdapter,
    readBox as readWidgetBox,
    resolveTextLayoutForRender as resolveRenderTextLayout,
    setContentOffset as applyContentOffset,
    translateWidgetBox as applyWidgetTranslation,
} from './runtime/runtime-layout';
import type { RuntimeSnapshotHost } from './runtime/runtime-snapshot';
import {
    restoreChildSnapshot as restoreChildSnapshotNode,
    snapshotNode as snapshotWidgetNode,
} from './runtime/runtime-snapshot';
import type { RuntimeComponentHost } from './runtime/runtime-component-instances';
import { expandComponentInstances as expandComponentInstanceNodes } from './runtime/runtime-component-instances';
import type { RuntimeInputSourceHost, RuntimeViewportInputHost } from './runtime/runtime-event';
import {
    bubbleEvent as bubbleEventUp,
    createInputHost,
    dispatchInput as dispatchInputEvent,
    dispatchViewportInput as dispatchViewportInputEvent,
    hitTest as hitTestTree,
    updateHover as updateHoverState,
} from './runtime/runtime-event';
import type { RuntimeFocusHost } from './runtime/runtime-focus';
import { moveFocus as moveFocusOnTree, setFocus as setFocusOnTree } from './runtime/runtime-focus';
import type { RuntimeFrameHost } from './runtime/runtime-frame-commit';
import { commitFrame, commitToViewportFrame } from './runtime/runtime-frame-commit';
import type {
    ColorInput,
    FocusMoveDirection,
    FontRegistryOptions,
    LayoutBox,
    RenderCommand,
    ResolvedFocusPolicy,
    ResolvedLayout,
    ResolvedTextBlock,
    ResolvedWidgetImage,
    ResolvedWidgetStyle,
    SizeLike,
    TextLayoutResult,
    UIFrame,
    UIFrameMetrics,
    UIInputEvent,
    UIPointerEvent,
    WidgetConfig,
    WidgetEventHandlers,
    WidgetFocusChangeEvent,
    WidgetImageInput,
    UIAsset,
    UICanvasConfig,
    WidgetId,
    WidgetKey,
    WidgetLayoutInput,
    WidgetPatch,
    WidgetSnapshot,
    WidgetStyleInput,
    UIRuntimeSnapshot,
} from './types';

export interface UIRuntimeOptions<TPayload = unknown> {
    readonly width?: number;
    readonly height?: number;
    readonly locale?: string;
    readonly fonts?: FontRegistry;
    readonly textEngine?: TextLayoutEngine;
    readonly registry?: WidgetRegistry<UIRuntime<TPayload>, TPayload>;
    readonly fontOptions?: FontRegistryOptions;
    readonly textCacheSize?: number;
}

export class UIRuntime<TPayload = unknown> implements Disposable {
    readonly fonts: FontRegistry;
    readonly textEngine: TextLayoutEngine;
    readonly registry: WidgetRegistry<UIRuntime<TPayload>, TPayload>;

    private readonly layoutEngine = new UILayoutEngine<WidgetId>();
    private records: Array<StoredWidgetRecord<UIRuntime<TPayload>> | null> = [];
    private layouts: Array<ResolvedLayout | null> = [];
    private styles: Array<ResolvedWidgetStyle | null> = [];
    private texts: Array<ResolvedTextBlock | null> = [];
    private images: Array<ResolvedWidgetImage | null> = [];
    private focuses: Array<ResolvedFocusPolicy | null> = [];
    private states: unknown[] = [];
    private textLayouts: Array<TextLayoutResult | null> = [];
    private textLayoutWidths: number[] = [];
    private flags = new Uint32Array(16);
    private parent = new Int32Array(16);
    private firstChild = new Int32Array(16);
    private lastChild = new Int32Array(16);
    private previousSibling = new Int32Array(16);
    private nextSibling = new Int32Array(16);
    private sequence = new Uint32Array(16);
    private depth = new Uint16Array(16);
    private boxX = new Float32Array(16);
    private boxY = new Float32Array(16);
    private boxWidth = new Float32Array(16);
    private boxHeight = new Float32Array(16);
    private contentX = new Float32Array(16);
    private contentY = new Float32Array(16);
    private contentWidth = new Float32Array(16);
    private contentHeight = new Float32Array(16);
    /** Per-widget translation offset X (absolute, set by translateWidgetBox). Uses number[] for full precision. */
    private translateX: number[] = new Array(16).fill(0);
    /** Per-widget translation offset Y (absolute, set by translateWidgetBox). Uses number[] for full precision. */
    private translateY: number[] = new Array(16).fill(0);
    private freeList: number[] = [];
    private rootId: WidgetId;
    private nextId = 1;
    private nextSequence = 1;
    private liveCount = 0;
    private hovered: WidgetId | null = null;
    private pressed: WidgetId | null = null;
    private focusController = new FocusController();
    private layoutDirty = true;
    private disposed = false;
    private viewportWidth: number;
    private viewportHeight: number;
    private locale: string;
    private lastLayoutPasses = 0;
    private canvasConfig: UICanvasConfig | null = null;
    private lastViewport: { readonly width: number; readonly height: number } | null = null;
    private readonly bindingTable = new Map<string, WidgetId>();
    private readonly controllerEventBus = new ControllerEventBus();
    private readonly controllerResolveCache = new Map<string, WidgetController<any, any, any> | null>();
    private readonly autoSizeService = new AutoSizeService();
    private readonly renderCommandBuilder = new RenderCommandBuilder<TPayload>();
    private readonly dirtyNodes = new Set<number>();
    private structuralDirty = false;

    constructor(options: UIRuntimeOptions<TPayload> = {}) {
        this.locale = options.locale ?? 'en';
        this.viewportWidth = Math.max(0, options.width ?? 0);
        this.viewportHeight = Math.max(0, options.height ?? 0);
        this.fonts = options.fonts ?? new FontRegistry(options.fontOptions);
        if (this.fonts.getDefaultFamily() === null) {
            try {
                ensureDefaultUIFont(this.fonts);
            } catch (error) {
                if (
                    !(error instanceof UIError) ||
                    error.code !== UIErrorCode.FontLoadFailed ||
                    !error.message.includes('No 2D canvas implementation is available')
                ) {
                    throw error;
                }
            }
        }
        this.textEngine =
            options.textEngine ??
            new TextLayoutEngine(this.fonts, { cacheSize: options.textCacheSize, locale: this.locale });
        this.registry = options.registry ?? new WidgetRegistry<UIRuntime<TPayload>, TPayload>();
        const rootId = this.allocate();
        this.rootId = rootId as WidgetId;
        this.records[rootId] = normalizeWidgetRecord({
            role: 'root',
            layout: {
                display: 'overlay',
                width: '100%',
                height: '100%',
            },
            style: {
                visible: true,
            },
            enabled: true,
            interactive: false,
        });
        this.applyRecord(rootId, null, null, true);
    }

    get root(): WidgetId {
        return this.rootId;
    }

    get width(): number {
        return this.viewportWidth;
    }

    get height(): number {
        return this.viewportHeight;
    }

    /** Returns the currently loaded canvas configuration, or null if no UIAsset is loaded. */
    getCanvasConfig(): UICanvasConfig | null {
        return this.canvasConfig;
    }

    /**
     * Loads a UIAsset into this runtime.
     * Sets the viewport to the asset's reference resolution, restores the widget tree,
     * stores the canvas configuration for later use during commit(), and resolves the
     * asset's named bindings against restored widget keys.
     */
    loadFromAsset(asset: UIAsset): this {
        this.ensureActive();
        this.canvasConfig = asset.canvas;
        this.lastViewport = null;
        this.setViewport(asset.canvas.referenceWidth, asset.canvas.referenceHeight);
        this.restore({
            viewportWidth: asset.canvas.referenceWidth,
            viewportHeight: asset.canvas.referenceHeight,
            locale: this.locale,
            root: asset.root,
        });
        const expansion = expandComponentInstanceNodes(this.getComponentHost(), asset.components);
        const bindings = asset.bindings ? { ...asset.bindings } : undefined;
        if (bindings) {
            for (const name of Object.keys(bindings)) {
                if (expansion.replaced.has(bindings[name] as WidgetKey)) {
                    delete bindings[name];
                }
            }
        }
        rebuildBindingTable(this.getBindingHost(), bindings);
        for (const [name, widget] of expansion.created) {
            this.bindingTable.set(name, widget);
        }
        remountControllers(this.getBindingHost());
        return this;
    }

    /**
     * Resolves a named binding (declared in the loaded UIAsset) to the widget it targets.
     * Returns null when no asset is loaded or the binding name is unknown.
     */
    getBoundWidget(name: string): WidgetId | null {
        this.ensureActive();
        return this.bindingTable.get(name) ?? null;
    }

    /** Returns the full binding-name to widget table resolved by the last loadFromAsset(). */
    getBindingTable(): ReadonlyMap<string, WidgetId> {
        this.ensureActive();
        return this.bindingTable;
    }

    /**
     * Registers a listener for a named controller event on a widget.
     * Controllers emit semantic events (e.g. 'onDragStart') at meaningful
     * interaction points. Listeners are called synchronously during emit.
     */
    onControllerEvent(widget: WidgetId, eventName: string, callback: (data: unknown) => void): void {
        this.ensureActive();
        this.requireWidget(widget);
        this.controllerEventBus.on(widget, eventName, callback as ControllerEventHandler);
    }

    /**
     * Removes a previously registered controller event listener.
     */
    offControllerEvent(widget: WidgetId, eventName: string, callback: (data: unknown) => void): void {
        this.ensureActive();
        this.controllerEventBus.off(widget, eventName, callback as ControllerEventHandler);
    }

    /**
     * Emits a named controller event for a widget. Called by controllers at
     * meaningful interaction points (drag start, drop, etc.). Returns true
     * when at least one listener was invoked.
     */
    emitControllerEvent(widget: WidgetId, eventName: string, data?: unknown): boolean {
        this.ensureActive();
        return this.controllerEventBus.emit(widget, eventName, data);
    }

    /**
     * Returns the controller state of a widget, or null when it has no
     * controller. Lets callers read live control values (a slider's value, a
     * toggle's checked flag) without reaching into runtime internals.
     */
    getWidgetState<TState = unknown>(widget: WidgetId): TState | null {
        this.ensureActive();
        const index = this.requireWidget(widget);
        return (this.states[index] as TState | undefined) ?? null;
    }

    isWidgetEnabled(widget: WidgetId): boolean {
        this.ensureActive();
        const index = this.requireWidget(widget);
        return this.records[index]!.enabled;
    }

    /**
     * Returns a clone of the widget's current image input, or null when the
     * widget has no image. Lets controllers read the authored image source
     * (e.g. to restore it after a per-state sprite swap).
     */
    getWidgetImageInput(widget: WidgetId): WidgetImageInput | null {
        this.ensureActive();
        const index = this.requireWidget(widget);
        const record = this.records[index]!;
        return cloneData(record.imageInput);
    }

    /**
     * Returns a clone of the widget's current style input, or null when the
     * widget has no style. Lets controllers read the authored visual state
     * (e.g. current background color for animation start values).
     */
    getWidgetStyleInput(widget: WidgetId): WidgetStyleInput | null {
        this.ensureActive();
        const index = this.requireWidget(widget);
        const record = this.records[index]!;
        return cloneData(record.styleInput);
    }

    setViewport(width: number, height: number): this {
        this.ensureActive();
        if (width !== this.viewportWidth || height !== this.viewportHeight) {
            this.viewportWidth = Math.max(0, width);
            this.viewportHeight = Math.max(0, height);
            this.layoutDirty = true;
        }
        return this;
    }

    createWidget<TProps extends Record<string, unknown> = Record<string, never>>(
        config: WidgetConfig<TProps, UIRuntime<TPayload>> = {}
    ): WidgetId {
        this.ensureActive();
        const id = this.allocate();
        this.records[id] = normalizeWidgetRecord(config as WidgetConfig<Record<string, unknown>, UIRuntime<TPayload>>);
        this.applyRecord(id, null, null, true);
        return id as WidgetId;
    }

    appendChild(parent: WidgetId, child: WidgetId): this {
        return this.insertChildBefore(parent, child, null);
    }

    insertChildBefore(parent: WidgetId, child: WidgetId, before: WidgetId | null): this {
        this.ensureActive();
        insertChildBeforeNode(this.getTreeHost(), parent, child, before);
        return this;
    }

    updateWidget<TProps extends Record<string, unknown> = Record<string, never>>(
        widget: WidgetId,
        patch: WidgetPatch<TProps, UIRuntime<TPayload>>
    ): this {
        this.ensureActive();
        applyWidgetPatch(
            this.getRecordHost(),
            widget,
            patch as unknown as WidgetPatch<Record<string, unknown>, unknown>
        );
        return this;
    }

    /**
     * Updates a widget's scroll content offset without triggering a full
     * relayout pass.
     *
     * Scrolling is a pure translation: children keep their measured sizes and
     * relative arrangement, so the widget's resolved layout offset is updated
     * in place and the subtree boxes are translated by the delta. The widget's
     * layoutInput is kept in sync (when it already authors content offsets) so
     * a later full relayout produces the same geometry. Per-frame scroll
     * updates must use this instead of updateWidget, which marks the whole
     * tree dirty and re-measures everything.
     */
    setContentOffset(widget: WidgetId, offsetX: number, offsetY: number): this {
        this.ensureActive();
        applyContentOffset(this.getLayoutHost(), widget, offsetX, offsetY);
        return this;
    }

    /**
     * Translates an already-laid-out widget subtree by a pixel delta without
     * invalidating layout. Used for per-frame scroll-driven repositioning
     * (scrollbar thumbs). The translation is stored as an absolute offset
     * (not by mutating insets) to prevent float drift across repeated calls.
     * A later full relayout will clear the translation offset.
     */
    translateWidgetBox(widget: WidgetId, dx: number, dy: number): this {
        this.ensureActive();
        applyWidgetTranslation(this.getLayoutHost(), widget, dx, dy);
        return this;
    }

    removeWidget(widget: WidgetId): this {
        this.ensureActive();
        removeWidgetNode(this.getTreeHost(), widget);
        return this;
    }

    clear(): this {
        this.ensureActive();
        const children: WidgetId[] = [];
        for (let child = this.firstChild[this.rootId]; child !== 0; child = this.nextSibling[child]) {
            children.push(child as WidgetId);
        }
        for (const child of children) {
            this.removeWidget(child);
        }
        this.bindingTable.clear();
        this.lastViewport = null;
        return this;
    }

    getLayoutBox(widget: WidgetId): LayoutBox {
        const index = this.requireWidget(widget);
        return this.readBox(index);
    }

    getTextLayout(widget: WidgetId): TextLayoutResult | null {
        const index = this.requireWidget(widget);
        return this.textLayouts[index] ?? null;
    }

    getWidgetCount(): number {
        return Math.max(0, this.liveCount - 1);
    }

    collectSubtreeWidgetIds(widget: WidgetId): WidgetId[] {
        return collectSubtreeIds(this.getTreeHost(), widget);
    }

    commit(viewport?: Partial<SizeLike>): UIFrame<TPayload> {
        this.ensureActive();
        return commitFrame<TPayload, unknown>(this.getFrameHost(), viewport);
    }

    /**
     * Commits the UI frame targeting a specific actual viewport size.
     * When a canvas config is loaded (via loadFromAsset), layout is computed at the
     * reference resolution and then a scale transform is applied to all render commands
     * to map them into the actual viewport.
     *
     * When no canvas config is loaded, this behaves identically to commit(viewport).
     */
    commitToViewport(actualWidth: number, actualHeight: number): UIFrame<TPayload> {
        this.ensureActive();
        return commitToViewportFrame<TPayload, unknown>(this.getFrameHost(), actualWidth, actualHeight);
    }

    /**
     * Dispatches an input event whose pointer coordinates are expressed in actual
     * viewport (screen) pixels. When a canvas config is loaded and a commitToViewport()
     * has been performed, pointer coordinates are mapped back into the reference
     * canvas space before hit-testing. Non-pointer events pass through unchanged.
     */
    dispatchViewportInput(event: Readonly<UIInputEvent>): boolean {
        this.ensureActive();
        return dispatchViewportInputEvent(this.getEventHost(), event);
    }

    dispatchInput(event: Readonly<UIInputEvent>): boolean {
        this.ensureActive();
        return dispatchInputEvent(this.getEventHost(), event);
    }

    setFocus(widget: WidgetId | null, reason: WidgetFocusChangeEvent['reason'] = 'api', direction?: FocusMoveDirection): boolean {
        this.ensureActive();
        return setFocusOnTree(this.getFocusHost(), widget, reason, direction);
    }

    /** Returns the currently focused widget, or null if nothing is focused. */
    getFocused(): WidgetId | null {
        return this.focusController.getFocused();
    }

    moveFocus(direction: FocusMoveDirection): WidgetId | null {
        this.ensureActive();
        return moveFocusOnTree(this.getFocusHost(), direction);
    }

    snapshot(): UIRuntimeSnapshot {
        this.ensureActive();
        return {
            viewportWidth: this.viewportWidth,
            viewportHeight: this.viewportHeight,
            locale: this.locale,
            root: snapshotWidgetNode(this.getSnapshotHost(), this.rootId),
        };
    }

    restore(snapshot: UIRuntimeSnapshot): this {
        this.ensureActive();
        if (!snapshot || typeof snapshot !== 'object' || !snapshot.root) {
            throw new UIError(UIErrorCode.InvalidSnapshot, 'Runtime snapshot is invalid.', { snapshot });
        }
        this.setViewport(snapshot.viewportWidth, snapshot.viewportHeight);
        this.locale = snapshot.locale;
        this.clear();
        const rootSnapshot = snapshot.root;
        this.records[this.rootId] = normalizeWidgetRecord({
            role: rootSnapshot.role,
            controller: rootSnapshot.controller,
            key: rootSnapshot.key ?? undefined,
            props: cloneData(rootSnapshot.props ?? EMPTY_RECORD_OBJECT),
            enabled: rootSnapshot.enabled,
            interactive: rootSnapshot.interactive,
            layout: cloneData(rootSnapshot.layout ?? EMPTY_LAYOUT_INPUT),
            style: cloneData(rootSnapshot.style ?? EMPTY_STYLE_INPUT),
            text: cloneData(rootSnapshot.text ?? null),
            image: cloneData(rootSnapshot.image ?? null),
            focus: cloneData(rootSnapshot.focus ?? EMPTY_FOCUS_INPUT),
        });
        this.applyRecord(this.rootId, null, null, true);
        for (const child of rootSnapshot.children) {
            restoreChildSnapshotNode(this.getSnapshotHost(), this.rootId, child);
        }
        return this;
    }

    /**
     * Disposes the runtime, releasing all resources.
     *
     * NOTE: Controller re-registration after dispose is unsupported. The
     * controller resolve cache is cleared here; any controllers registered
     * before dispose become unreachable.
     */
    dispose(): void {
        if (!this.disposed) {
            this.clear();
            this.fonts.dispose();
            this.textEngine.dispose();
            this.registry.clear();
            this.controllerResolveCache.clear();
            this.disposed = true;
        }
    }

    [Symbol.dispose](): void {
        this.dispose();
    }

    /* ------------------------------------------------------------------ */
    /* Host adapters                                                        */
    /* ------------------------------------------------------------------ */

    /**
     * Widget-tree storage/links adapter consumed by `./runtime/runtime-tree`.
     * Mutable scalars (dirty flags) are exposed as accessors so writes made by
     * the delegated functions land on this runtime.
     */
    private getTreeHost(): RuntimeTreeStoreHost {
        const self = this;
        return {
            parent: this.parent,
            firstChild: this.firstChild,
            lastChild: this.lastChild,
            previousSibling: this.previousSibling,
            nextSibling: this.nextSibling,
            depth: this.depth,
            rootId: this.rootId,
            flags: this.flags,
            sequence: this.sequence,
            boxX: this.boxX,
            boxY: this.boxY,
            boxWidth: this.boxWidth,
            boxHeight: this.boxHeight,
            contentX: this.contentX,
            contentY: this.contentY,
            contentWidth: this.contentWidth,
            contentHeight: this.contentHeight,
            translateX: this.translateX,
            translateY: this.translateY,
            records: this.records as unknown as Array<StoredWidgetRecord | null>,
            layouts: this.layouts,
            styles: this.styles,
            texts: this.texts,
            images: this.images,
            focuses: this.focuses,
            textLayouts: this.textLayouts,
            textLayoutWidths: this.textLayoutWidths,
            states: this.states,
            freeList: this.freeList,
            nextId: this.nextId,
            nextSequence: this.nextSequence,
            get liveCount(): number {
                return self.liveCount;
            },
            set liveCount(value: number) {
                self.liveCount = value;
            },
            get layoutDirty(): boolean {
                return self.layoutDirty;
            },
            set layoutDirty(value: boolean) {
                self.layoutDirty = value;
            },
            get structuralDirty(): boolean {
                return self.structuralDirty;
            },
            set structuralDirty(value: boolean) {
                self.structuralDirty = value;
            },
            dirtyNodes: this.dirtyNodes,
            focusController: this.focusController,
            controllerEventBus: this.controllerEventBus,
            registry: this.registry,
            getRuntime: () => this,
            getHovered: () => this.hovered,
            setHovered: (widget) => {
                this.hovered = widget;
            },
            getPressed: () => this.pressed,
            setPressed: (widget) => {
                this.pressed = widget;
            },
            isAncestor: (ancestor, candidate) => this.isAncestor(ancestor, candidate),
        };
    }

    /**
     * Widget-record adapter consumed by `./runtime/runtime-record-apply` and
     * `./runtime/runtime-binding`.
     */
    private getRecordHost(): RuntimeRecordHost {
        const self = this;
        return {
            records: this.records as unknown as Array<StoredWidgetRecord | null>,
            layouts: this.layouts,
            styles: this.styles,
            texts: this.texts,
            images: this.images,
            focuses: this.focuses,
            textLayouts: this.textLayouts,
            textLayoutWidths: this.textLayoutWidths,
            states: this.states,
            flags: this.flags,
            fonts: this.fonts,
            locale: this.locale,
            registry: this.registry,
            focusController: this.focusController,
            controllerResolveCache: this.controllerResolveCache,
            get layoutDirty(): boolean {
                return self.layoutDirty;
            },
            set layoutDirty(value: boolean) {
                self.layoutDirty = value;
            },
            dirtyNodes: this.dirtyNodes,
            getRuntime: () => this,
            requireWidget: (widget) => requireWidgetIndex(this.flags, widget),
        };
    }

    /** Asset-binding adapter; adds the binding table to the record host. */
    private getBindingHost(): RuntimeBindingHost {
        const self = this;
        return {
            ...this.getRecordHost(),
            get layoutDirty(): boolean {
                return self.layoutDirty;
            },
            set layoutDirty(value: boolean) {
                self.layoutDirty = value;
            },
            bindingTable: this.bindingTable,
        };
    }

    /** Layout adapter consumed by `./runtime/runtime-layout`. */
    private getLayoutHost(): RuntimeLayoutHost {
        const self = this;
        return {
            layoutEngine: this.layoutEngine,
            autoSizeService: this.autoSizeService,
            fonts: this.fonts,
            textEngine: this.textEngine,
            rootId: this.rootId,
            viewportWidth: this.viewportWidth,
            viewportHeight: this.viewportHeight,
            get lastLayoutPasses(): number {
                return self.lastLayoutPasses;
            },
            set lastLayoutPasses(value: number) {
                self.lastLayoutPasses = value;
            },
            liveCount: this.liveCount,
            flags: this.flags,
            records: this.records as unknown as Array<StoredWidgetRecord | null>,
            parent: this.parent,
            depth: this.depth,
            firstChild: this.firstChild,
            nextSibling: this.nextSibling,
            boxX: this.boxX,
            boxY: this.boxY,
            boxWidth: this.boxWidth,
            boxHeight: this.boxHeight,
            contentX: this.contentX,
            contentY: this.contentY,
            contentWidth: this.contentWidth,
            contentHeight: this.contentHeight,
            translateX: this.translateX,
            translateY: this.translateY,
            layouts: this.layouts,
            texts: this.texts,
            images: this.images,
            states: this.states,
            textLayouts: this.textLayouts,
            textLayoutWidths: this.textLayoutWidths,
            registry: this.registry,
            get layoutDirty(): boolean {
                return self.layoutDirty;
            },
            set layoutDirty(value: boolean) {
                self.layoutDirty = value;
            },
            get structuralDirty(): boolean {
                return self.structuralDirty;
            },
            set structuralDirty(value: boolean) {
                self.structuralDirty = value;
            },
            dirtyNodes: this.dirtyNodes,
            getRuntime: () => this,
        };
    }

    /** Snapshot/restore adapter consumed by `./runtime/runtime-snapshot`. */
    private getSnapshotHost(): RuntimeSnapshotHost {
        return {
            records: this.records as unknown as Array<StoredWidgetRecord | null>,
            firstChild: this.firstChild,
            nextSibling: this.nextSibling,
            createWidget: (config) => this.createWidget(config),
            appendChild: (parent, child) => {
                this.appendChild(parent, child);
            },
        };
    }

    /** Component-instance expansion adapter consumed by `./runtime/runtime-component-instances`. */
    private getComponentHost(): RuntimeComponentHost {
        return {
            ...this.getSnapshotHost(),
            flags: this.flags,
            parent: this.parent,
            nextSibling: this.nextSibling,
            removeWidget: (widget) => {
                this.removeWidget(widget);
            },
            insertChildBefore: (parent, child, before) => {
                this.insertChildBefore(parent, child, before);
            },
        };
    }

    /** Input-dispatch adapter consumed by `./runtime/runtime-event`. */
    private getEventHost(): RuntimeViewportInputHost {
        const source: RuntimeInputSourceHost = {
            rootId: this.rootId,
            flags: this.flags,
            parent: this.parent,
            firstChild: this.firstChild,
            nextSibling: this.nextSibling,
            depth: this.depth,
            sequence: this.sequence,
            styles: this.styles,
            layouts: this.layouts,
            records: this.records as unknown as Array<StoredWidgetRecord | null>,
            states: this.states,
            focusController: this.focusController,
            registry: this.registry,
            getRuntime: () => this,
            getHovered: () => this.hovered,
            setHovered: (widget) => {
                this.hovered = widget;
            },
            getPressed: () => this.pressed,
            setPressed: (widget) => {
                this.pressed = widget;
            },
            isFocusable: (index) => this.isFocusable(index),
            readBox: (index) => this.readBox(index),
            hitTest: (x, y) => this.hitTest(x, y),
            updateHover: (target, event) => this.updateHover(target, event),
            bubbleEvent: (index, event) => this.bubbleEvent(index, event),
            setFocus: (widget, reason) => this.setFocus(widget, reason),
            moveFocus: (direction) => this.moveFocus(direction),
        };
        return {
            ...source,
            inputHost: createInputHost(source),
            canvasConfig: this.canvasConfig,
            lastViewport: this.lastViewport,
        };
    }

    /** Focus adapter consumed by `./runtime/runtime-focus`. */
    private getFocusHost(): RuntimeFocusHost {
        return {
            flags: this.flags,
            parent: this.parent,
            sequence: this.sequence,
            focuses: this.focuses,
            rootId: this.rootId,
            nextId: this.nextId,
            records: this.records as unknown as Array<StoredWidgetRecord | null>,
            states: this.states,
            focusController: this.focusController,
            registry: this.registry,
            getRuntime: () => this,
            isFocusable: (index) => this.isFocusable(index),
            isAncestor: (ancestor, candidate) => this.isAncestor(ancestor, candidate),
            readBox: (index) => this.readBox(index),
        };
    }

    /** Frame-commit adapter consumed by `./runtime/runtime-frame-commit`. */
    private getFrameHost(): RuntimeFrameHost<TPayload> {
        const self = this;
        return {
            ...this.getLayoutHost(),
            get lastLayoutPasses(): number {
                return self.lastLayoutPasses;
            },
            set lastLayoutPasses(value: number) {
                self.lastLayoutPasses = value;
            },
            get layoutDirty(): boolean {
                return self.layoutDirty;
            },
            set layoutDirty(value: boolean) {
                self.layoutDirty = value;
            },
            get structuralDirty(): boolean {
                return self.structuralDirty;
            },
            set structuralDirty(value: boolean) {
                self.structuralDirty = value;
            },
            fonts: this.fonts,
            canvasConfig: this.canvasConfig,
            get lastViewport() {
                return self.lastViewport;
            },
            set lastViewport(value: { readonly width: number; readonly height: number } | null) {
                self.lastViewport = value;
            },
            setViewport: (width, height) => {
                this.setViewport(width, height);
            },
            renderFrame: () => this.renderFrame(),
        };
    }

    private getRenderHost(): RenderCommandBuilderHost<TPayload> {
        return {
            flags: this.flags,
            parent: this.parent,
            firstChild: this.firstChild,
            nextSibling: this.nextSibling,
            sequence: this.sequence,
            styles: this.styles,
            layouts: this.layouts,
            images: this.images,
            texts: this.texts,
            focuses: this.focuses,
            records: this.records as Array<{ controller: string | null; props: Record<string, unknown> } | null>,
            states: this.states,
            rootId: this.rootId,
            viewportWidth: this.viewportWidth,
            viewportHeight: this.viewportHeight,
            lastLayoutPasses: this.lastLayoutPasses,
            isVisible: (index) => this.isVisible(index),
            readBox: (index) => this.readBox(index),
            resolveTextLayoutForRender: (index) => this.resolveTextLayoutForRender(index),
            resolveControllerCached: (name) => this.resolveControllerCached(name),
            getFocused: () => this.focusController.getFocused(),
            getWidgetCount: () => this.getWidgetCount(),
            getRuntime: () => this,
        };
    }

    /* ------------------------------------------------------------------ */
    /* Delegated runtime operations                                         */
    /* ------------------------------------------------------------------ */

    private ensureActive(): void {
        if (this.disposed) {
            throw new DisposedUIError('UIRuntime');
        }
    }

    private applyRecord(
        index: number,
        previousProps: Readonly<Record<string, unknown>> | null,
        previousController: string | null,
        initial: boolean,
        styleOnly = false
    ): void {
        applyWidgetRecord(this.getRecordHost(), index, previousProps, previousController, initial, styleOnly);
    }

    /**
     * Capacity management reallocates the parallel typed arrays, so it stays
     * bound to the runtime instance; every other tree operation goes through
     * `getTreeHost()`.
     */
    private allocate(): number {
        const id = this.freeList.pop() ?? this.nextId++;
        this.ensureCapacity(id + 1);
        this.flags[id] = NodeFlag.Allocated;
        this.sequence[id] = this.nextSequence++;
        this.liveCount += 1;
        return id;
    }

    private ensureCapacity(minimum: number): void {
        if (minimum < this.parent.length) {
            return;
        }
        let nextCapacity = this.parent.length;
        while (nextCapacity <= minimum) {
            nextCapacity *= 2;
        }
        this.parent = this.growTypedArray(this.parent, nextCapacity);
        this.firstChild = this.growTypedArray(this.firstChild, nextCapacity);
        this.lastChild = this.growTypedArray(this.lastChild, nextCapacity);
        this.previousSibling = this.growTypedArray(this.previousSibling, nextCapacity);
        this.nextSibling = this.growTypedArray(this.nextSibling, nextCapacity);
        this.sequence = this.growTypedArray(this.sequence, nextCapacity);
        this.depth = this.growTypedArray(this.depth, nextCapacity);
        this.flags = this.growTypedArray(this.flags, nextCapacity);
        this.boxX = this.growTypedArray(this.boxX, nextCapacity);
        this.boxY = this.growTypedArray(this.boxY, nextCapacity);
        this.boxWidth = this.growTypedArray(this.boxWidth, nextCapacity);
        this.boxHeight = this.growTypedArray(this.boxHeight, nextCapacity);
        this.contentX = this.growTypedArray(this.contentX, nextCapacity);
        this.contentY = this.growTypedArray(this.contentY, nextCapacity);
        this.contentWidth = this.growTypedArray(this.contentWidth, nextCapacity);
        this.contentHeight = this.growTypedArray(this.contentHeight, nextCapacity);
        this.translateX.length = nextCapacity;
        this.translateY.length = nextCapacity;
        this.translateX.fill(0, this.records.length);
        this.translateY.fill(0, this.records.length);
        this.records.length = nextCapacity;
        this.layouts.length = nextCapacity;
        this.styles.length = nextCapacity;
        this.texts.length = nextCapacity;
        this.images.length = nextCapacity;
        this.focuses.length = nextCapacity;
        this.states.length = nextCapacity;
        this.textLayouts.length = nextCapacity;
        this.textLayoutWidths.length = nextCapacity;
    }

    private growTypedArray<TArray extends Int32Array | Uint32Array | Uint16Array | Float32Array>(
        current: TArray,
        length: number
    ): TArray {
        const Ctor = current.constructor as new (size: number) => TArray;
        const next = new Ctor(length);
        next.set(current);
        return next;
    }

    private requireWidget(widget: WidgetId | null): number {
        return requireWidgetIndex(this.flags, widget);
    }

    private isVisible(index: number): boolean {
        return isVisibleFlag(this.flags, index);
    }

    private isFocusable(index: number): boolean {
        return isFocusableFlag(this.flags, index);
    }

    private isAncestor(ancestor: number, candidate: number): boolean {
        return isAncestorIndex(this.parent, ancestor, candidate);
    }

    private createLayoutAdapter(): LayoutTreeAdapter<WidgetId> {
        return buildLayoutAdapter(this.getLayoutHost());
    }

    private readBox(index: number): LayoutBox {
        return readWidgetBox(this.getLayoutHost(), index);
    }

    private resolveControllerCached(controllerName: string | null): WidgetController<any, any, any> | null {
        return resolveControllerCachedByName(this.getRecordHost(), controllerName);
    }

    private renderFrame(): UIFrame<TPayload> {
        return this.renderCommandBuilder.build(this.getRenderHost());
    }

    private resolveTextLayoutForRender(index: number): TextLayoutResult | null {
        return resolveRenderTextLayout(this.getLayoutHost(), index);
    }

    private hitTest(x: number, y: number): WidgetId | null {
        return hitTestTree(this.getEventHost(), x, y);
    }

    private updateHover(target: WidgetId | null, event: Readonly<UIPointerEvent>): void {
        updateHoverState(this.getEventHost(), target, event);
    }

    private bubbleEvent(index: number, event: Readonly<UIInputEvent>): boolean {
        return bubbleEventUp(this.getEventHost(), index, event);
    }
}

export type {
    ColorInput,
    FocusMoveDirection,
    LayoutBox,
    RenderCommand,
    SizeLike,
    TextLayoutResult,
    UIFrame,
    UIFrameMetrics,
    UIInputEvent,
    WidgetConfig,
    WidgetEventHandlers,
    WidgetId,
    WidgetLayoutInput,
    WidgetPatch,
    WidgetSnapshot,
    WidgetStyleInput,
    UIRuntimeSnapshot,
};

export { serializeUIAsset, deserializeUIAsset, validateUIAsset } from './runtime/ui-asset-io';
export type { UIAsset, UICanvasConfig, UICanvasScaleMode, UISafeAreaInset } from './types/ui-asset';
