import {
    DisposedUIError,
    UIError,
    UIErrorCode,
    WidgetNotFoundError,
    WidgetTreeIntegrityError,
} from './errors';
import { FontRegistry } from './font';
import { UILayoutEngine, compileLayoutInput, normalizeCorners } from './layout';
import { TextLayoutEngine } from './text';
import { WidgetRegistry } from './widget';
import type {
    ColorInput,
    CornerRadii,
    CustomRenderCommand,
    FocusMoveDirection,
    FontRegistryOptions,
    ImageRenderCommand,
    LayoutBox,
    QuadRenderCommand,
    ReadonlyColor,
    RenderCommand,
    ResolvedFocusPolicy,
    ResolvedWidgetImage,
    ResolvedLayout,
    ResolvedTextBlock,
    ResolvedWidgetStyle,
    SizeLike,
    TextBlockInput,
    TextLayoutResult,
    TextRenderCommand,
    UIFrame,
    UIFrameMetrics,
    UIInputEvent,
    UIPointerEvent,
    UIKeyEvent,
    UITextInputEvent,
    WidgetConfig,
    WidgetEventContext,
    WidgetEventHandlers,
    WidgetFocusChangeEvent,
    WidgetFocusPolicyInput,
    WidgetImageInput,
    WidgetId,
    WidgetKey,
    WidgetLayoutInput,
    WidgetPatch,
    WidgetRole,
    WidgetSerializableKey,
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

interface StoredWidgetRecord<TPayload> {
    readonly role: WidgetRole;
    readonly controller: string | null;
    readonly key?: WidgetKey;
    readonly props: Readonly<Record<string, unknown>>;
    readonly enabled: boolean;
    readonly interactive: boolean;
    readonly layoutInput: WidgetLayoutInput;
    readonly styleInput: WidgetStyleInput;
    readonly textInput: TextBlockInput | null;
    readonly imageInput: WidgetImageInput | null;
    readonly focusInput: WidgetFocusPolicyInput;
    readonly handlers: WidgetEventHandlers<Record<string, unknown>, UIRuntime<TPayload>> | null;
}

const EMPTY_RECORD_OBJECT: Readonly<Record<string, unknown>> = Object.freeze({});
const EMPTY_LAYOUT_INPUT: WidgetLayoutInput = Object.freeze({});
const EMPTY_STYLE_INPUT: WidgetStyleInput = Object.freeze({});
const EMPTY_FOCUS_INPUT: WidgetFocusPolicyInput = Object.freeze({});
const TRANSPARENT: ReadonlyColor = Object.freeze({ r: 0, g: 0, b: 0, a: 0 });
const BLACK: ReadonlyColor = Object.freeze({ r: 0, g: 0, b: 0, a: 1 });
const WHITE: ReadonlyColor = Object.freeze({ r: 1, g: 1, b: 1, a: 1 });

const enum NodeFlag {
    Allocated = 1 << 0,
    Visible = 1 << 1,
    Interactive = 1 << 2,
    Enabled = 1 << 3,
    Focusable = 1 << 4,
    TextDirty = 1 << 5,
}

const clamp = (value: number, min: number, max: number): number => {
    if (value < min) {
        return min;
    }
    if (value > max) {
        return max;
    }
    return value;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
    if (value === null || typeof value !== 'object') {
        return false;
    }
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
};

const isColorLike = (
    value: ColorInput
): value is { readonly r: number; readonly g: number; readonly b: number; readonly a?: number } =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const cloneData = <TValue>(value: TValue): TValue => {
    if (value === null || value === undefined) {
        return value;
    }
    if (Array.isArray(value)) {
        return value.map((entry) => cloneData(entry)) as TValue;
    }
    if (isPlainObject(value)) {
        const clone: Record<string, unknown> = {};
        for (const [key, entry] of Object.entries(value)) {
            if (typeof entry === 'function' || typeof entry === 'symbol') {
                continue;
            }
            clone[key] = cloneData(entry);
        }
        return clone as TValue;
    }
    if (typeof value === 'function' || typeof value === 'symbol') {
        return undefined as TValue;
    }
    return value;
};

const colorFromNumber = (value: number): ReadonlyColor => ({
    r: ((value >>> 24) & 0xff) / 255,
    g: ((value >>> 16) & 0xff) / 255,
    b: ((value >>> 8) & 0xff) / 255,
    a: (value & 0xff) / 255,
});

const colorFromHex = (value: string): ReadonlyColor => {
    const hex = value.replace('#', '').trim();
    if (hex.length === 3) {
        return {
            r: Number.parseInt(hex[0] + hex[0], 16) / 255,
            g: Number.parseInt(hex[1] + hex[1], 16) / 255,
            b: Number.parseInt(hex[2] + hex[2], 16) / 255,
            a: 1,
        };
    }
    if (hex.length === 6 || hex.length === 8) {
        return {
            r: Number.parseInt(hex.slice(0, 2), 16) / 255,
            g: Number.parseInt(hex.slice(2, 4), 16) / 255,
            b: Number.parseInt(hex.slice(4, 6), 16) / 255,
            a: hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) / 255 : 1,
        };
    }
    return TRANSPARENT;
};

const normalizeColor = (input: ColorInput | undefined, fallback: ReadonlyColor): ReadonlyColor => {
    if (input === undefined) {
        return fallback;
    }
    if (typeof input === 'number') {
        return colorFromNumber(input >>> 0);
    }
    if (typeof input === 'string') {
        return colorFromHex(input);
    }
    if (Array.isArray(input)) {
        if (input.length === 3) {
            return { r: input[0], g: input[1], b: input[2], a: 1 };
        }
        return { r: input[0], g: input[1], b: input[2], a: input[3] };
    }
    if (!isColorLike(input)) {
        return fallback;
    }
    return {
        r: input.r,
        g: input.g,
        b: input.b,
        a: input.a ?? 1,
    };
};

const normalizeWeight = (value: ResolvedTextBlock['weight'] | TextBlockInput['weight']): number => {
    switch (value) {
        case 'thin':
            return 100;
        case 'extralight':
            return 200;
        case 'light':
            return 300;
        case 'normal':
            return 400;
        case 'medium':
            return 500;
        case 'semibold':
            return 600;
        case 'bold':
            return 700;
        case 'extrabold':
            return 800;
        case 'black':
            return 900;
        case undefined:
            return 400;
        default:
            return value;
    }
};

const mergeLayoutInput = (
    base: WidgetLayoutInput,
    patch: WidgetPatch['layout'] | undefined
): WidgetLayoutInput => {
    if (!patch) {
        return base;
    }
    return {
        ...base,
        ...patch,
        inset: patch.inset ? { ...(base.inset ?? {}), ...patch.inset } : base.inset,
        anchor:
            patch.anchor && isPlainObject(patch.anchor) && isPlainObject(base.anchor)
                ? { ...base.anchor, ...patch.anchor }
                : patch.anchor ?? base.anchor,
    } as WidgetLayoutInput;
};

const mergeStyleInput = (
    base: WidgetStyleInput,
    patch: WidgetPatch['style'] | undefined
): WidgetStyleInput => ({ ...(base ?? {}), ...(patch ?? {}) }) as WidgetStyleInput;

const mergeTextInput = (
    base: TextBlockInput | null,
    patch: WidgetPatch['text'] | undefined
): TextBlockInput | null => {
    if (patch === undefined) {
        return base;
    }
    if (patch === null) {
        return null;
    }
    return { ...(base ?? { value: '' }), ...patch } as TextBlockInput;
};

const mergeImageInput = (
    base: WidgetImageInput | null,
    patch: WidgetPatch['image'] | undefined
): WidgetImageInput | null => {
    if (patch === undefined) {
        return base;
    }
    if (patch === null) {
        return null;
    }
    const next = patch as WidgetImageInput;
    return {
        ...(base ?? {}),
        ...next,
        uvRect: next.uvRect ? { ...(base?.uvRect ?? {}), ...next.uvRect } : base?.uvRect,
    } as WidgetImageInput;
};

const mergeFocusInput = (
    base: WidgetFocusPolicyInput,
    patch: WidgetPatch['focus'] | undefined
): WidgetFocusPolicyInput => ({ ...(base ?? {}), ...(patch ?? {}) });

const mergeHandlers = <TPayload>(
    base: WidgetEventHandlers<Record<string, unknown>, UIRuntime<TPayload>> | null,
    patch: WidgetEventHandlers<Record<string, unknown>, UIRuntime<TPayload>> | undefined
): WidgetEventHandlers<Record<string, unknown>, UIRuntime<TPayload>> | null => {
    if (patch === undefined) {
        return base;
    }
    return { ...(base ?? {}), ...patch };
};

const mergeProps = (
    base: Readonly<Record<string, unknown>>,
    patch: Readonly<Record<string, unknown>> | undefined
): Readonly<Record<string, unknown>> => ({ ...(base ?? EMPTY_RECORD_OBJECT), ...(patch ?? {}) });

const normalizeIndex = (value: number | undefined): number | null => {
    if (value === undefined || value === null) {
        return null;
    }
    if (!Number.isFinite(value)) {
        return null;
    }
    return Math.max(0, Math.floor(value));
};

const normalizeUvRect = (input: WidgetImageInput['uvRect']): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } => {
    const x = clamp(input?.x ?? 0, 0, 1);
    const y = clamp(input?.y ?? 0, 0, 1);
    const width = clamp(input?.width ?? 1, 0, 1 - x);
    const height = clamp(input?.height ?? 1, 0, 1 - y);
    return { x, y, width, height };
};

const intersectsPoint = (box: LayoutBox | null, x: number, y: number): boolean => {
    if (!box) {
        return false;
    }
    return x >= box.x && y >= box.y && x <= box.x + box.width && y <= box.y + box.height;
};

const intersectRect = (left: LayoutBox | null, right: LayoutBox): LayoutBox | null => {
    if (!left) {
        return right;
    }
    const x = Math.max(left.x, right.x);
    const y = Math.max(left.y, right.y);
    const maxX = Math.min(left.x + left.width, right.x + right.width);
    const maxY = Math.min(left.y + left.height, right.y + right.height);
    if (maxX <= x || maxY <= y) {
        return null;
    }
    return {
        x,
        y,
        width: maxX - x,
        height: maxY - y,
        contentX: x,
        contentY: y,
        contentWidth: maxX - x,
        contentHeight: maxY - y,
    };
};

export class UIRuntime<TPayload = unknown> implements Disposable {
    readonly fonts: FontRegistry;
    readonly textEngine: TextLayoutEngine;
    readonly registry: WidgetRegistry<UIRuntime<TPayload>, TPayload>;

    private readonly layoutEngine = new UILayoutEngine<WidgetId>();
    private records: Array<StoredWidgetRecord<TPayload> | null> = [];
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
    private freeList: number[] = [];
    private focusOrder: WidgetId[] = [];
    private rootId: WidgetId;
    private nextId = 1;
    private nextSequence = 1;
    private liveCount = 0;
    private hovered: WidgetId | null = null;
    private focused: WidgetId | null = null;
    private pressed: WidgetId | null = null;
    private focusDirty = true;
    private layoutDirty = true;
    private disposed = false;
    private viewportWidth: number;
    private viewportHeight: number;
    private locale: string;
    private lastLayoutPasses = 0;

    constructor(options: UIRuntimeOptions<TPayload> = {}) {
        this.locale = options.locale ?? 'en';
        this.viewportWidth = Math.max(0, options.width ?? 0);
        this.viewportHeight = Math.max(0, options.height ?? 0);
        this.fonts = options.fonts ?? new FontRegistry(options.fontOptions);
        this.textEngine =
            options.textEngine ??
            new TextLayoutEngine(this.fonts, { cacheSize: options.textCacheSize, locale: this.locale });
        this.registry = options.registry ?? new WidgetRegistry<UIRuntime<TPayload>, TPayload>();
        const rootId = this.allocate();
        this.rootId = rootId as WidgetId;
        this.records[rootId] = this.normalizeRecord({
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
        this.records[id] = this.normalizeRecord(config as WidgetConfig<Record<string, unknown>, UIRuntime<TPayload>>);
        this.applyRecord(id, null, null, true);
        return id as WidgetId;
    }

    appendChild(parent: WidgetId, child: WidgetId): this {
        return this.insertChildBefore(parent, child, null);
    }

    insertChildBefore(parent: WidgetId, child: WidgetId, before: WidgetId | null): this {
        this.ensureActive();
        const parentIndex = this.requireWidget(parent);
        const childIndex = this.requireWidget(child);
        if (childIndex === this.rootId) {
            throw new WidgetTreeIntegrityError('The root widget cannot be re-parented.');
        }
        if (parentIndex === childIndex || this.isAncestor(childIndex, parentIndex)) {
            throw new WidgetTreeIntegrityError('Re-parenting would create a cycle.', {
                parent,
                child,
                before,
            });
        }
        if (before !== null) {
            const beforeIndex = this.requireWidget(before);
            if (this.parent[beforeIndex] !== parentIndex) {
                throw new WidgetTreeIntegrityError('The insertion reference must already belong to the parent.', {
                    parent,
                    child,
                    before,
                });
            }
        }
        this.detachNode(childIndex);
        this.parent[childIndex] = parentIndex;
        if (before === null) {
            const last = this.lastChild[parentIndex];
            if (last === 0) {
                this.firstChild[parentIndex] = childIndex;
                this.lastChild[parentIndex] = childIndex;
            } else {
                this.nextSibling[last] = childIndex;
                this.previousSibling[childIndex] = last;
                this.lastChild[parentIndex] = childIndex;
            }
        } else {
            const beforeIndex = before as number;
            const previous = this.previousSibling[beforeIndex];
            this.nextSibling[childIndex] = beforeIndex;
            this.previousSibling[beforeIndex] = childIndex;
            if (previous !== 0) {
                this.nextSibling[previous] = childIndex;
                this.previousSibling[childIndex] = previous;
            } else {
                this.firstChild[parentIndex] = childIndex;
            }
        }
        this.refreshDepths(childIndex, this.depth[parentIndex] + 1);
        this.markTreeChanged(childIndex);
        return this;
    }

    updateWidget<TProps extends Record<string, unknown> = Record<string, never>>(
        widget: WidgetId,
        patch: WidgetPatch<TProps, UIRuntime<TPayload>>
    ): this {
        this.ensureActive();
        const index = this.requireWidget(widget);
        const current = this.records[index];
        if (!current) {
            throw new WidgetNotFoundError(index);
        }
        const previousController = current.controller;
        const previousProps = current.props;
        const merged: StoredWidgetRecord<TPayload> = {
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
                patch.handlers as WidgetEventHandlers<Record<string, unknown>, UIRuntime<TPayload>> | undefined
            ),
        };
        this.records[index] = merged;
        this.applyRecord(index, previousProps, previousController, false);
        return this;
    }

    removeWidget(widget: WidgetId): this {
        this.ensureActive();
        const index = this.requireWidget(widget);
        if (index === this.rootId) {
            throw new WidgetTreeIntegrityError('The root widget cannot be removed.');
        }
        const traversal: number[] = [];
        const stack = [index];
        while (stack.length > 0) {
            const current = stack.pop()!;
            traversal.push(current);
            for (let child = this.firstChild[current]; child !== 0; child = this.nextSibling[child]) {
                stack.push(child);
            }
        }
        this.detachNode(index);
        for (let offset = traversal.length - 1; offset >= 0; offset -= 1) {
            this.destroyNode(traversal[offset]);
        }
        this.layoutDirty = true;
        this.focusDirty = true;
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
        const index = this.requireWidget(widget);
        const widgets: WidgetId[] = [];
        const stack = [index];

        while (stack.length > 0) {
            const current = stack.pop()!;
            widgets.push(current as WidgetId);
            for (let child = this.lastChild[current]; child !== 0; child = this.previousSibling[child]) {
                stack.push(child);
            }
        }

        return widgets;
    }

    commit(viewport?: Partial<SizeLike>): UIFrame<TPayload> {
        this.ensureActive();
        if (viewport) {
            this.setViewport(viewport.width ?? this.viewportWidth, viewport.height ?? this.viewportHeight);
        }
        if (this.layoutDirty) {
            this.layoutEngine.compute(
                {
                    root: this.rootId,
                    getLayout: (node) => this.layouts[node as number]!,
                    getFirstChild: (node) => {
                        const child = this.firstChild[node as number];
                        return child === 0 ? null : (child as WidgetId);
                    },
                    getNextSibling: (node) => {
                        const sibling = this.nextSibling[node as number];
                        return sibling === 0 ? null : (sibling as WidgetId);
                    },
                    measureContent: (node, constraints) => this.measureContent(node as number, constraints),
                    setBox: (node, box) => this.writeBox(node as number, box),
                    isVisible: (node) => this.isVisible(node as number),
                },
                { width: this.viewportWidth, height: this.viewportHeight }
            );
            this.layoutDirty = false;
            this.lastLayoutPasses = this.layoutEngine.getLayoutPassCount();
        }
        return this.renderFrame();
    }

    dispatchInput(event: Readonly<UIInputEvent>): boolean {
        this.ensureActive();
        switch (event.type) {
            case 'pointer':
                return this.dispatchPointer(event);
            case 'key':
                return this.dispatchKey(event);
            case 'text':
                return this.dispatchText(event);
            case 'focus':
                if (!event.focused && this.focused) {
                    this.setFocus(null, 'window');
                }
                return false;
            default:
                return false;
        }
    }

    setFocus(widget: WidgetId | null, reason: WidgetFocusChangeEvent['reason'] = 'api', direction?: FocusMoveDirection): boolean {
        this.ensureActive();
        if (widget !== null) {
            const target = this.requireWidget(widget);
            if (!this.isFocusable(target)) {
                return false;
            }
            widget = target as WidgetId;
        }
        if (this.focused === widget) {
            return true;
        }
        const previous = this.focused;
        this.focused = widget;
        if (previous !== null) {
            this.emitFocusChange(previous as number, false, reason, direction);
        }
        if (widget !== null) {
            this.emitFocusChange(widget as number, true, reason, direction);
        }
        return true;
    }

    moveFocus(direction: FocusMoveDirection): WidgetId | null {
        this.ensureActive();
        const candidates = this.getFocusableCandidates();
        if (candidates.length === 0) {
            return null;
        }
        const current = this.focused ? (this.focused as number) : 0;
        const scopeRoot = current === 0 ? this.rootId : this.findScopeRoot(current);
        const scoped = scopeRoot === this.rootId
            ? candidates
            : candidates.filter((candidate) => this.isAncestor(scopeRoot as number, candidate as number));
        const targetList = scoped.length > 0 ? scoped : candidates;
        let next: WidgetId | null = null;
        if (direction === 'forward' || direction === 'backward') {
            next = this.moveFocusLinear(targetList, direction, scopeRoot as number);
        } else {
            next = this.moveFocusDirectional(targetList, direction);
        }
        if (next) {
            this.setFocus(next, 'navigation', direction);
        }
        return next;
    }

    snapshot(): UIRuntimeSnapshot {
        this.ensureActive();
        return {
            viewportWidth: this.viewportWidth,
            viewportHeight: this.viewportHeight,
            locale: this.locale,
            root: this.snapshotNode(this.rootId),
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
        this.records[this.rootId] = this.normalizeRecord({
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
            this.restoreChildSnapshot(this.rootId, child);
        }
        return this;
    }

    dispose(): void {
        if (!this.disposed) {
            this.clear();
            this.fonts.dispose();
            this.textEngine.dispose();
            this.registry.clear();
            this.disposed = true;
        }
    }

    [Symbol.dispose](): void {
        this.dispose();
    }

    private ensureActive(): void {
        if (this.disposed) {
            throw new DisposedUIError('UIRuntime');
        }
    }

    private normalizeRecord(
        config: WidgetConfig<Record<string, unknown>, UIRuntime<TPayload>>
    ): StoredWidgetRecord<TPayload> {
        return {
            role: config.role ?? 'container',
            controller: config.controller ?? null,
            key: config.key,
            props: cloneData(config.props ?? EMPTY_RECORD_OBJECT),
            enabled: config.enabled ?? true,
            interactive: config.interactive ?? false,
            layoutInput: cloneData(config.layout ?? EMPTY_LAYOUT_INPUT),
            styleInput: cloneData(config.style ?? EMPTY_STYLE_INPUT),
            textInput: cloneData(config.text ?? null),
            imageInput: cloneData(config.image ?? null),
            focusInput: cloneData(config.focus ?? EMPTY_FOCUS_INPUT),
            handlers: (config.handlers as WidgetEventHandlers<Record<string, unknown>, UIRuntime<TPayload>>) ?? null,
        };
    }

    private applyRecord(
        index: number,
        previousProps: Readonly<Record<string, unknown>> | null,
        previousController: string | null,
        initial: boolean
    ): void {
        const record = this.records[index];
        if (!record) {
            throw new WidgetNotFoundError(index);
        }
        const previousResolvedController = previousController ? this.registry.resolve(previousController) : null;
        const nextResolvedController = record.controller ? this.registry.resolve(record.controller) : null;
        if (!initial && previousResolvedController && previousResolvedController !== nextResolvedController) {
            previousResolvedController.disposeState?.(this.states[index], this, index as WidgetId);
            this.states[index] = undefined;
        }
        this.layouts[index] = compileLayoutInput(record.layoutInput);
        this.styles[index] = this.compileStyle(record.styleInput);
        this.texts[index] = this.compileText(record.textInput, this.styles[index]!.color);
        this.images[index] = this.compileImage(record.imageInput);
        this.focuses[index] = this.compileFocus(record.focusInput, record.interactive);
        this.textLayouts[index] = null;
        this.textLayoutWidths[index] = Number.NaN;
        this.updateFlags(index);
        if (!initial && previousResolvedController === nextResolvedController && nextResolvedController && previousProps) {
            nextResolvedController.update?.(this.createControllerContext(index), previousProps);
        } else if (nextResolvedController) {
            this.states[index] = nextResolvedController.createState?.(record.props, this, index as WidgetId);
            nextResolvedController.mount?.(this.createControllerContext(index));
        }
        this.layoutDirty = true;
        this.focusDirty = true;
    }

    private compileStyle(input: WidgetStyleInput): ResolvedWidgetStyle {
        return {
            visible: input.visible ?? true,
            opacity: clamp(input.opacity ?? 1, 0, 1),
            clip: input.clip ?? false,
            background: normalizeColor(input.background, TRANSPARENT),
            borderColor: normalizeColor(input.borderColor, TRANSPARENT),
            borderWidth: Math.max(0, input.borderWidth ?? 0),
            radius: normalizeCorners(input.radius),
            color: normalizeColor(input.color, BLACK),
        };
    }

    private compileText(input: TextBlockInput | null, fallbackColor: ReadonlyColor): ResolvedTextBlock | null {
        if (!input) {
            return null;
        }
        return {
            value: input.value,
            family: input.family ?? this.fonts.getDefaultFamily() ?? '',
            size: Math.max(1, input.size ?? 16),
            weight: normalizeWeight(input.weight),
            style: input.style ?? 'normal',
            locale: input.locale ?? this.locale,
            direction: input.direction ?? 'auto',
            lineHeight: Math.max(0, input.lineHeight ?? 0),
            letterSpacing: input.letterSpacing ?? 0,
            wrap: input.wrap ?? 'word',
            overflow: input.overflow ?? 'clip',
            maxLines: Math.max(1, Math.floor(input.maxLines ?? Number.MAX_SAFE_INTEGER)),
            align: input.align ?? 'start',
            color: normalizeColor(input.color, fallbackColor),
            outlineColor: normalizeColor(input.outlineColor, TRANSPARENT),
            outlineWidth: Math.max(0, input.outlineWidth ?? 0),
            edgeSoftness: Math.max(0.5, input.edgeSoftness ?? 1),
            shadowColor: normalizeColor(input.shadowColor, TRANSPARENT),
            shadowOffsetX: input.shadowOffsetX ?? 0,
            shadowOffsetY: input.shadowOffsetY ?? 0,
            underline: input.underline ?? false,
            underlineColor: normalizeColor(input.underlineColor, TRANSPARENT),
            underlineThickness: Math.max(1, input.underlineThickness ?? 1),
            underlineOffset: input.underlineOffset ?? 1,
            strikeThrough: input.strikeThrough ?? false,
            strikeThroughColor: normalizeColor(input.strikeThroughColor, TRANSPARENT),
            strikeThroughThickness: Math.max(1, input.strikeThroughThickness ?? 1),
            selectionStart: normalizeIndex(input.selectionStart),
            selectionEnd: normalizeIndex(input.selectionEnd),
            selectionColor: normalizeColor(input.selectionColor, TRANSPARENT),
            caretIndex: normalizeIndex(input.caretIndex),
            caretColor: normalizeColor(input.caretColor, TRANSPARENT),
            caretWidth: Math.max(1, input.caretWidth ?? 1),
            caretInset: Math.max(0, input.caretInset ?? 1),
        };
    }

    private compileImage(input: WidgetImageInput | null): ResolvedWidgetImage | null {
        if (!input) {
            return null;
        }
        const source = input.source.kind === 'material'
            ? {
                  kind: 'material' as const,
                  materialId: input.source.materialId,
                  textureBinding: input.source.textureBinding,
                  width: Math.max(1, input.source.width),
                  height: Math.max(1, input.source.height),
              }
            : {
                  kind: 'texture' as const,
                  resourceId: input.source.resourceId,
                  width: Math.max(1, input.source.width),
                  height: Math.max(1, input.source.height),
              };
        return {
            source,
            fit: input.fit ?? 'fill',
            alignX: clamp(input.alignX ?? 0.5, 0, 1),
            alignY: clamp(input.alignY ?? 0.5, 0, 1),
            sampling: input.sampling ?? 'linear',
            tint: normalizeColor(input.tint, WHITE),
            uvRect: normalizeUvRect(input.uvRect),
        };
    }

    private compileFocus(input: WidgetFocusPolicyInput, interactive: boolean): ResolvedFocusPolicy {
        return {
            focusable: input.focusable ?? interactive,
            tabIndex: input.tabIndex ?? 0,
            scope: input.scope ?? false,
            cycle: input.cycle ?? false,
            order: input.order ?? 0,
        };
    }

    private updateFlags(index: number): void {
        const style = this.styles[index]!;
        const focus = this.focuses[index]!;
        const record = this.records[index]!;
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
        this.flags[index] = flags;
    }

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
        if (widget === null) {
            throw new WidgetNotFoundError(-1);
        }
        const index = widget as number;
        if ((this.flags[index] & NodeFlag.Allocated) === 0) {
            throw new WidgetNotFoundError(index);
        }
        return index;
    }

    private isVisible(index: number): boolean {
        return (this.flags[index] & NodeFlag.Visible) !== 0;
    }

    private isFocusable(index: number): boolean {
        return (
            (this.flags[index] & NodeFlag.Focusable) !== 0 &&
            (this.flags[index] & NodeFlag.Enabled) !== 0 &&
            (this.flags[index] & NodeFlag.Visible) !== 0
        );
    }

    private isAncestor(ancestor: number, candidate: number): boolean {
        for (let current = candidate; current !== 0; current = this.parent[current]) {
            if (current === ancestor) {
                return true;
            }
        }
        return false;
    }

    private detachNode(index: number): void {
        const parent = this.parent[index];
        if (parent === 0) {
            return;
        }
        const previous = this.previousSibling[index];
        const next = this.nextSibling[index];
        if (previous !== 0) {
            this.nextSibling[previous] = next;
        } else {
            this.firstChild[parent] = next;
        }
        if (next !== 0) {
            this.previousSibling[next] = previous;
        } else {
            this.lastChild[parent] = previous;
        }
        this.parent[index] = 0;
        this.previousSibling[index] = 0;
        this.nextSibling[index] = 0;
    }

    private refreshDepths(index: number, depth: number): void {
        const queue = [index];
        this.depth[index] = depth;
        while (queue.length > 0) {
            const current = queue.shift()!;
            const currentDepth = this.depth[current];
            for (let child = this.firstChild[current]; child !== 0; child = this.nextSibling[child]) {
                this.depth[child] = currentDepth + 1;
                queue.push(child);
            }
        }
    }

    private markTreeChanged(index: number): void {
        void index;
        this.layoutDirty = true;
        this.focusDirty = true;
    }

    private createControllerContext(index: number): WidgetEventContext<Record<string, unknown>, UIRuntime<TPayload>> & {
        readonly state: unknown;
    } {
        const record = this.records[index]!;
        return {
            runtime: this,
            widget: index as WidgetId,
            props: record.props,
            state: this.states[index],
        };
    }

    private measureContent(index: number, constraints: Readonly<SizeLike>): SizeLike {
        const text = this.texts[index];
        const image = this.images[index];
        const controllerType = this.records[index]?.controller;
        if (controllerType) {
            const controller = this.registry.resolve(controllerType);
            const measured = controller?.measure?.({
                runtime: this,
                widget: index as WidgetId,
                props: this.records[index]!.props,
                state: this.states[index],
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
            const imageSize = this.measureImageContent(image, constraints);
            measuredWidth = Math.max(measuredWidth, imageSize.width);
            measuredHeight = Math.max(measuredHeight, imageSize.height);
        }
        if (text && text.value.length > 0) {
            const width = Number.isFinite(constraints.width)
                ? Math.max(0, constraints.width)
                : Number.POSITIVE_INFINITY;
            if (!this.textLayouts[index] || this.textLayoutWidths[index] !== width) {
                this.textLayouts[index] = this.textEngine.measure(text, {
                    width,
                    height: constraints.height,
                });
                this.textLayoutWidths[index] = width;
            }
            measuredWidth = Math.max(measuredWidth, this.textLayouts[index]!.width);
            measuredHeight = Math.max(measuredHeight, this.textLayouts[index]!.height);
        }
        return { width: measuredWidth, height: measuredHeight };
    }

    private measureImageContent(image: ResolvedWidgetImage, constraints: Readonly<SizeLike>): SizeLike {
        const intrinsicWidth = image.source.width;
        const intrinsicHeight = image.source.height;
        const maxWidth = Number.isFinite(constraints.width) ? Math.max(0, constraints.width) : Number.POSITIVE_INFINITY;
        const maxHeight = Number.isFinite(constraints.height) ? Math.max(0, constraints.height) : Number.POSITIVE_INFINITY;
        if (!Number.isFinite(maxWidth) && !Number.isFinite(maxHeight)) {
            return { width: intrinsicWidth, height: intrinsicHeight };
        }
        if (image.fit === 'fill') {
            return {
                width: Number.isFinite(maxWidth) ? maxWidth : intrinsicWidth,
                height: Number.isFinite(maxHeight) ? maxHeight : intrinsicHeight,
            };
        }
        const widthScale = Number.isFinite(maxWidth) ? maxWidth / intrinsicWidth : Number.POSITIVE_INFINITY;
        const heightScale = Number.isFinite(maxHeight) ? maxHeight / intrinsicHeight : Number.POSITIVE_INFINITY;
        if (image.fit === 'none') {
            return {
                width: Number.isFinite(maxWidth) ? Math.min(intrinsicWidth, maxWidth) : intrinsicWidth,
                height: Number.isFinite(maxHeight) ? Math.min(intrinsicHeight, maxHeight) : intrinsicHeight,
            };
        }
        const containScale = Math.min(widthScale, heightScale);
        const coverScale = Math.max(widthScale, heightScale);
        const scale = image.fit === 'cover'
            ? coverScale
            : image.fit === 'scale-down'
              ? Math.min(1, containScale)
              : containScale;
        if (!Number.isFinite(scale) || scale <= 0) {
            return { width: intrinsicWidth, height: intrinsicHeight };
        }
        return {
            width: intrinsicWidth * scale,
            height: intrinsicHeight * scale,
        };
    }

    private writeBox(index: number, box: LayoutBox): void {
        this.boxX[index] = box.x;
        this.boxY[index] = box.y;
        this.boxWidth[index] = box.width;
        this.boxHeight[index] = box.height;
        this.contentX[index] = box.contentX;
        this.contentY[index] = box.contentY;
        this.contentWidth[index] = box.contentWidth;
        this.contentHeight[index] = box.contentHeight;
    }

    private readBox(index: number): LayoutBox {
        return {
            x: this.boxX[index],
            y: this.boxY[index],
            width: this.boxWidth[index],
            height: this.boxHeight[index],
            contentX: this.contentX[index],
            contentY: this.contentY[index],
            contentWidth: this.contentWidth[index],
            contentHeight: this.contentHeight[index],
        };
    }

    private renderFrame(): UIFrame<TPayload> {
        const commands: RenderCommand<TPayload>[] = [];
        let visibleWidgetCount = 0;
        let textCommandCount = 0;
        let imageCommandCount = 0;
        let customCommandCount = 0;
        let glyphCount = 0;
        const visit = (index: number, clip: LayoutBox | null): void => {
            if (!this.isVisible(index)) {
                return;
            }
            visibleWidgetCount += 1;
            const style = this.styles[index]!;
            const box = this.readBox(index);
            const nextClip = style.clip ? intersectRect(clip, box) : clip;
            if (style.clip && nextClip === null) {
                return;
            }
            const zIndex = this.layouts[index]!.zIndex;
            if (style.background.a > 0 || (style.borderWidth > 0 && style.borderColor.a > 0)) {
                const quad: QuadRenderCommand = {
                    kind: 'quad',
                    widget: index as WidgetId,
                    x: box.x,
                    y: box.y,
                    width: box.width,
                    height: box.height,
                    zIndex,
                    color: style.background,
                    borderColor: style.borderColor,
                    borderWidth: style.borderWidth,
                    radius: style.radius,
                    opacity: style.opacity,
                    clip: nextClip,
                };
                commands.push(quad);
            }
            const image = this.images[index];
            if (image) {
                const imageCommand = this.resolveImageCommand(index, box, image, style, nextClip, zIndex);
                if (imageCommand) {
                    imageCommandCount += 1;
                    commands.push(imageCommand);
                }
            }
            const textLayout = this.resolveTextLayoutForRender(index);
            if (textLayout) {
                const textStyle = this.texts[index]!;
                if (textStyle.selectionColor.a > 0) {
                    for (const quad of this.buildSelectionCommands(index, box, textStyle, textLayout, nextClip, zIndex, style.opacity)) {
                        commands.push(quad);
                    }
                }
                if (textLayout.glyphs.length > 0) {
                    if (textStyle.shadowColor.a > 0 && (textStyle.shadowOffsetX !== 0 || textStyle.shadowOffsetY !== 0)) {
                        const shadowCommand: TextRenderCommand = {
                            kind: 'text',
                            widget: index as WidgetId,
                            x: box.contentX + textStyle.shadowOffsetX,
                            y: box.contentY + textStyle.shadowOffsetY,
                            zIndex,
                            color: textStyle.shadowColor,
                            outlineColor: TRANSPARENT,
                            outlineWidth: 0,
                            edgeSoftness: textStyle.edgeSoftness,
                            opacity: style.opacity,
                            clip: nextClip,
                            layout: textLayout,
                        };
                        textCommandCount += 1;
                        glyphCount += textLayout.glyphs.length;
                        commands.push(shadowCommand);
                    }
                    for (const quad of this.buildLineDecorationCommands(index, box, textStyle, textLayout, nextClip, zIndex, style.opacity)) {
                        commands.push(quad);
                    }
                    const textCommand: TextRenderCommand = {
                        kind: 'text',
                        widget: index as WidgetId,
                        x: box.contentX,
                        y: box.contentY,
                        zIndex,
                        color: this.texts[index]!.color,
                        outlineColor: this.texts[index]!.outlineColor,
                        outlineWidth: this.texts[index]!.outlineWidth,
                        edgeSoftness: this.texts[index]!.edgeSoftness,
                        opacity: style.opacity,
                        clip: nextClip,
                        layout: textLayout,
                    };
                    textCommandCount += 1;
                    glyphCount += textLayout.glyphs.length;
                    commands.push(textCommand);
                }
                const caretCommand = this.buildCaretCommand(index, box, textStyle, textLayout, nextClip, zIndex, style.opacity);
                if (caretCommand) {
                    commands.push(caretCommand);
                }
            }
            const controller = this.records[index]!.controller
                ? this.registry.resolve(this.records[index]!.controller)
                : null;
            controller?.render?.({
                runtime: this,
                widget: index as WidgetId,
                props: this.records[index]!.props,
                state: this.states[index],
                push: (payload: TPayload) => {
                    const command: CustomRenderCommand<TPayload> = {
                        kind: 'custom',
                        widget: index as WidgetId,
                        zIndex,
                        clip: nextClip,
                        payload,
                    };
                    customCommandCount += 1;
                    commands.push(command);
                },
            });
            for (let child = this.firstChild[index]; child !== 0; child = this.nextSibling[child]) {
                visit(child, nextClip);
            }
        };
        visit(this.rootId, null);
        commands.sort((left, right) => {
            if (left.zIndex !== right.zIndex) {
                return left.zIndex - right.zIndex;
            }
            return this.sequence[left.widget as number] - this.sequence[right.widget as number];
        });
        const metrics: UIFrameMetrics = {
            widgetCount: this.getWidgetCount(),
            visibleWidgetCount,
            renderCount: commands.length,
            customCommandCount,
            imageCommandCount,
            textCommandCount,
            glyphCount,
            layoutPasses: this.lastLayoutPasses,
        };
        return {
            viewportWidth: this.viewportWidth,
            viewportHeight: this.viewportHeight,
            commands,
            metrics,
        };
    }

    private resolveTextLayoutForRender(index: number): TextLayoutResult | null {
        const text = this.texts[index];
        if (!text) {
            return null;
        }
        const width = this.contentWidth[index];
        if (!this.textLayouts[index] || this.textLayoutWidths[index] !== width) {
            this.textLayouts[index] = this.textEngine.measure(text, {
                width,
                height: this.contentHeight[index],
            });
            this.textLayoutWidths[index] = width;
        }
        return this.textLayouts[index];
    }

    private resolveImageCommand(
        index: number,
        box: LayoutBox,
        image: ResolvedWidgetImage,
        style: ResolvedWidgetStyle,
        clip: LayoutBox | null,
        zIndex: number
    ): ImageRenderCommand | null {
        const containerWidth = box.contentWidth;
        const containerHeight = box.contentHeight;
        if (containerWidth <= 0 || containerHeight <= 0) {
            return null;
        }
        const intrinsicWidth = image.source.width;
        const intrinsicHeight = image.source.height;
        let renderWidth = containerWidth;
        let renderHeight = containerHeight;
        if (image.fit === 'none') {
            renderWidth = intrinsicWidth;
            renderHeight = intrinsicHeight;
        } else if (image.fit !== 'fill') {
            const containScale = Math.min(containerWidth / intrinsicWidth, containerHeight / intrinsicHeight);
            const coverScale = Math.max(containerWidth / intrinsicWidth, containerHeight / intrinsicHeight);
            const scale = image.fit === 'cover'
                ? coverScale
                : image.fit === 'scale-down'
                  ? Math.min(1, containScale)
                  : containScale;
            renderWidth = intrinsicWidth * scale;
            renderHeight = intrinsicHeight * scale;
        }
        return {
            kind: 'image',
            widget: index as WidgetId,
            source: image.source,
            x: box.contentX + (containerWidth - renderWidth) * image.alignX,
            y: box.contentY + (containerHeight - renderHeight) * image.alignY,
            width: renderWidth,
            height: renderHeight,
            zIndex,
            tint: image.tint,
            opacity: style.opacity,
            sampling: image.sampling,
            radius: style.radius,
            clip,
            uvRect: image.uvRect,
        };
    }

    private buildSelectionCommands(
        index: number,
        box: LayoutBox,
        text: ResolvedTextBlock,
        layout: TextLayoutResult,
        clip: LayoutBox | null,
        zIndex: number,
        opacity: number
    ): QuadRenderCommand[] {
        if (text.selectionStart === null || text.selectionEnd === null || text.selectionStart === text.selectionEnd) {
            return [];
        }
        const start = Math.min(text.selectionStart, text.selectionEnd);
        const end = Math.max(text.selectionStart, text.selectionEnd);
        const selected = layout.clusters.filter((cluster) => cluster.index >= start && cluster.index < end);
        const perLine = new Map<number, { x0: number; x1: number; y: number; height: number }>();
        for (const cluster of selected) {
            const current = perLine.get(cluster.line);
            const x0 = cluster.x;
            const x1 = cluster.x + cluster.width;
            if (!current) {
                perLine.set(cluster.line, { x0, x1, y: cluster.y, height: cluster.height });
                continue;
            }
            current.x0 = Math.min(current.x0, x0);
            current.x1 = Math.max(current.x1, x1);
        }
        return [...perLine.values()].map((line) => ({
            kind: 'quad' as const,
            widget: index as WidgetId,
            x: box.contentX + line.x0,
            y: box.contentY + line.y,
            width: Math.max(1, line.x1 - line.x0),
            height: line.height,
            zIndex,
            color: text.selectionColor,
            borderColor: TRANSPARENT,
            borderWidth: 0,
            radius: { topLeft: 2, topRight: 2, bottomRight: 2, bottomLeft: 2 },
            opacity,
            clip,
        }));
    }

    private buildLineDecorationCommands(
        index: number,
        box: LayoutBox,
        text: ResolvedTextBlock,
        layout: TextLayoutResult,
        clip: LayoutBox | null,
        zIndex: number,
        opacity: number
    ): QuadRenderCommand[] {
        const commands: QuadRenderCommand[] = [];
        for (const line of layout.lines) {
            if (line.width <= 0) {
                continue;
            }
            if (text.underline && text.underlineColor.a > 0) {
                commands.push({
                    kind: 'quad',
                    widget: index as WidgetId,
                    x: box.contentX + line.x,
                    y: box.contentY + line.y + layout.baseline + text.underlineOffset,
                    width: Math.max(1, line.width),
                    height: text.underlineThickness,
                    zIndex,
                    color: text.underlineColor,
                    borderColor: TRANSPARENT,
                    borderWidth: 0,
                    radius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
                    opacity,
                    clip,
                });
            }
            if (text.strikeThrough && text.strikeThroughColor.a > 0) {
                commands.push({
                    kind: 'quad',
                    widget: index as WidgetId,
                    x: box.contentX + line.x,
                    y: box.contentY + line.y + line.ascent * 0.55,
                    width: Math.max(1, line.width),
                    height: text.strikeThroughThickness,
                    zIndex,
                    color: text.strikeThroughColor,
                    borderColor: TRANSPARENT,
                    borderWidth: 0,
                    radius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
                    opacity,
                    clip,
                });
            }
        }
        return commands;
    }

    private buildCaretCommand(
        index: number,
        box: LayoutBox,
        text: ResolvedTextBlock,
        layout: TextLayoutResult,
        clip: LayoutBox | null,
        zIndex: number,
        opacity: number
    ): QuadRenderCommand | null {
        if (text.caretIndex === null || text.caretColor.a <= 0) {
            return null;
        }
        const exact = layout.carets.find((caret) => caret.index === text.caretIndex);
        const fallback = exact ?? layout.carets.filter((caret) => caret.index <= text.caretIndex!).at(-1) ?? layout.carets[0];
        if (!fallback) {
            return null;
        }
        const caretHeight = Math.max(1, fallback.height - text.caretInset * 2);
        return {
            kind: 'quad',
            widget: index as WidgetId,
            x: box.contentX + fallback.x - text.caretWidth * 0.5,
            y: box.contentY + fallback.y + text.caretInset,
            width: text.caretWidth,
            height: caretHeight,
            zIndex,
            color: text.caretColor,
            borderColor: TRANSPARENT,
            borderWidth: 0,
            radius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
            opacity,
            clip,
        };
    }

    private dispatchPointer(event: Readonly<UIPointerEvent>): boolean {
        const target = this.hitTest(event.x, event.y);
        if (event.phase === 'move') {
            this.updateHover(target, event);
            if (this.pressed) {
                if (target && this.pressed !== target) {
                    return this.bubbleEvent(this.pressed as number, event) || this.bubbleEvent(target as number, event);
                }
                return this.bubbleEvent((target ?? this.pressed) as number, event);
            }
            if (target) {
                return this.bubbleEvent(target as number, event);
            }
            return false;
        }
        if (event.phase === 'down') {
            this.pressed = target;
            if (target) {
                if (this.isFocusable(target as number)) {
                    this.setFocus(target, 'pointer');
                }
                return this.bubbleEvent(target as number, event);
            }
            return false;
        }
        if (event.phase === 'up') {
            const resolved = target ?? this.pressed;
            this.pressed = null;
            return resolved ? this.bubbleEvent(resolved as number, event) : false;
        }
        if (event.phase === 'wheel') {
            return target ? this.bubbleEvent(target as number, event) : false;
        }
        return false;
    }

    private dispatchKey(event: Readonly<UIKeyEvent>): boolean {
        if (this.focused && this.bubbleEvent(this.focused as number, event)) {
            return true;
        }
        if (event.phase === 'down') {
            if (event.key === 'Tab') {
                const direction: FocusMoveDirection = event.shiftKey ? 'backward' : 'forward';
                return this.moveFocus(direction) !== null;
            }
            if (event.key === 'ArrowLeft') {
                return this.moveFocus('left') !== null;
            }
            if (event.key === 'ArrowRight') {
                return this.moveFocus('right') !== null;
            }
            if (event.key === 'ArrowUp') {
                return this.moveFocus('up') !== null;
            }
            if (event.key === 'ArrowDown') {
                return this.moveFocus('down') !== null;
            }
        }
        return false;
    }

    private dispatchText(event: Readonly<UITextInputEvent>): boolean {
        return this.focused ? this.bubbleEvent(this.focused as number, event) : false;
    }

    private hitTest(x: number, y: number): WidgetId | null {
        let bestId = 0;
        let bestZIndex = Number.NEGATIVE_INFINITY;
        let bestDepth = -1;
        let bestOrder = -1;
        const visit = (index: number, clip: LayoutBox | null): void => {
            if (!this.isVisible(index)) {
                return;
            }
            const box = this.readBox(index);
            const nextClip = this.styles[index]!.clip ? intersectRect(clip, box) : clip;
            if (this.styles[index]!.clip && nextClip === null) {
                return;
            }
            if (intersectsPoint(box, x, y) && (!nextClip || intersectsPoint(nextClip, x, y))) {
                if (
                    (this.flags[index] & NodeFlag.Interactive) !== 0 &&
                    (this.flags[index] & NodeFlag.Enabled) !== 0
                ) {
                    const candidateZIndex = this.layouts[index]!.zIndex;
                    const candidateDepth = this.depth[index];
                    const candidateOrder = this.sequence[index];
                    if (
                        bestId === 0 ||
                        candidateZIndex > bestZIndex ||
                        (candidateZIndex === bestZIndex && candidateDepth > bestDepth) ||
                        (candidateZIndex === bestZIndex &&
                            candidateDepth === bestDepth &&
                            candidateOrder > bestOrder)
                    ) {
                        bestId = index;
                        bestZIndex = candidateZIndex;
                        bestDepth = candidateDepth;
                        bestOrder = candidateOrder;
                    }
                }
                for (let child = this.firstChild[index]; child !== 0; child = this.nextSibling[child]) {
                    visit(child, nextClip);
                }
            }
        };
        visit(this.rootId, null);
        return bestId === 0 ? null : (bestId as WidgetId);
    }

    private updateHover(target: WidgetId | null, event: Readonly<UIPointerEvent>): void {
        if (this.hovered === target) {
            return;
        }
        const previous = this.hovered;
        this.hovered = target;
        if (previous) {
            this.invokeEvent(previous as number, { ...event, phase: 'leave' });
        }
        if (target) {
            this.invokeEvent(target as number, { ...event, phase: 'enter' });
        }
    }

    private bubbleEvent(index: number, event: Readonly<UIInputEvent>): boolean {
        for (let current = index; current !== 0; current = this.parent[current]) {
            if (this.invokeEvent(current, event)) {
                return true;
            }
        }
        return false;
    }

    private invokeEvent(index: number, event: Readonly<UIInputEvent>): boolean {
        const record = this.records[index];
        if (!record || !record.enabled) {
            return false;
        }
        const context: WidgetEventContext<Record<string, unknown>, UIRuntime<TPayload>> = {
            runtime: this,
            widget: index as WidgetId,
            props: record.props,
        };
        const handlers = record.handlers;
        let handled = false;
        switch (event.type) {
            case 'pointer':
                switch (event.phase) {
                    case 'move':
                        handled = Boolean(handlers?.pointerMove?.(event, context));
                        break;
                    case 'down':
                        handled = Boolean(handlers?.pointerDown?.(event, context));
                        break;
                    case 'up':
                        handled = Boolean(handlers?.pointerUp?.(event, context));
                        break;
                    case 'enter':
                        handled = Boolean(handlers?.pointerEnter?.(event, context));
                        break;
                    case 'leave':
                        handled = Boolean(handlers?.pointerLeave?.(event, context));
                        break;
                    case 'wheel':
                        handled = Boolean(handlers?.wheel?.(event, context));
                        break;
                    default:
                        break;
                }
                break;
            case 'key':
                handled = event.phase === 'down'
                    ? Boolean(handlers?.keyDown?.(event, context))
                    : Boolean(handlers?.keyUp?.(event, context));
                break;
            case 'text':
                handled = Boolean(handlers?.textInput?.(event, context));
                break;
            default:
                break;
        }
        const controller = record.controller ? this.registry.resolve(record.controller) : null;
        if (!handled && controller?.input) {
            handled = Boolean(
                controller.input(event, {
                    runtime: this,
                    widget: index as WidgetId,
                    props: record.props,
                    state: this.states[index],
                })
            );
        }
        return handled;
    }

    private emitFocusChange(
        index: number,
        focused: boolean,
        reason: WidgetFocusChangeEvent['reason'],
        direction?: FocusMoveDirection
    ): void {
        const record = this.records[index];
        if (!record) {
            return;
        }
        const event: WidgetFocusChangeEvent = {
            type: 'widget-focus',
            focused,
            reason,
        };
        const context: WidgetEventContext<Record<string, unknown>, UIRuntime<TPayload>> = {
            runtime: this,
            widget: index as WidgetId,
            props: record.props,
        };
        if (focused) {
            void record.handlers?.focus?.(event, context);
        } else {
            void record.handlers?.blur?.(event, context);
        }
        const controller = record.controller ? this.registry.resolve(record.controller) : null;
        if (controller) {
            const controllerContext = {
                runtime: this,
                widget: index as WidgetId,
                props: record.props,
                state: this.states[index],
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

    private getFocusableCandidates(): WidgetId[] {
        if (this.focusDirty) {
            const candidates: WidgetId[] = [];
            for (let index = 1; index < this.nextId; index += 1) {
                if ((this.flags[index] & NodeFlag.Allocated) === 0 || !this.isFocusable(index)) {
                    continue;
                }
                candidates.push(index as WidgetId);
            }
            candidates.sort((left, right) => {
                const leftIndex = left as number;
                const rightIndex = right as number;
                const leftFocus = this.focuses[leftIndex]!;
                const rightFocus = this.focuses[rightIndex]!;
                if (leftFocus.tabIndex !== rightFocus.tabIndex) {
                    return leftFocus.tabIndex - rightFocus.tabIndex;
                }
                if (leftFocus.order !== rightFocus.order) {
                    return leftFocus.order - rightFocus.order;
                }
                return this.sequence[leftIndex] - this.sequence[rightIndex];
            });
            this.focusOrder = candidates;
            this.focusDirty = false;
        }
        return this.focusOrder;
    }

    private findScopeRoot(index: number): WidgetId {
        for (let current = index; current !== 0; current = this.parent[current]) {
            if (this.focuses[current]?.scope) {
                return current as WidgetId;
            }
        }
        return this.rootId;
    }

    private moveFocusLinear(candidates: readonly WidgetId[], direction: FocusMoveDirection, scopeRoot: number): WidgetId | null {
        if (candidates.length === 0) {
            return null;
        }
        if (!this.focused) {
            return direction === 'backward' ? candidates[candidates.length - 1] : candidates[0];
        }
        const currentIndex = candidates.findIndex((candidate) => candidate === this.focused);
        const cycle = this.focuses[scopeRoot]?.cycle ?? false;
        if (currentIndex === -1) {
            return direction === 'backward' ? candidates[candidates.length - 1] : candidates[0];
        }
        const nextIndex = direction === 'backward' ? currentIndex - 1 : currentIndex + 1;
        if (nextIndex >= 0 && nextIndex < candidates.length) {
            return candidates[nextIndex];
        }
        return cycle ? (direction === 'backward' ? candidates[candidates.length - 1] : candidates[0]) : null;
    }

    private moveFocusDirectional(candidates: readonly WidgetId[], direction: Exclude<FocusMoveDirection, 'forward' | 'backward'>): WidgetId | null {
        if (candidates.length === 0) {
            return null;
        }
        const current = this.focused ? (this.focused as number) : candidates[0] as number;
        const origin = this.readBox(current);
        const originCenterX = origin.x + origin.width / 2;
        const originCenterY = origin.y + origin.height / 2;
        let best: { id: WidgetId; score: number } | null = null;
        for (const candidate of candidates) {
            const index = candidate as number;
            if (index === current) {
                continue;
            }
            const box = this.readBox(index);
            const centerX = box.x + box.width / 2;
            const centerY = box.y + box.height / 2;
            const deltaX = centerX - originCenterX;
            const deltaY = centerY - originCenterY;
            if (direction === 'left' && deltaX >= 0) {
                continue;
            }
            if (direction === 'right' && deltaX <= 0) {
                continue;
            }
            if (direction === 'up' && deltaY >= 0) {
                continue;
            }
            if (direction === 'down' && deltaY <= 0) {
                continue;
            }
            const primary = direction === 'left' || direction === 'right' ? Math.abs(deltaX) : Math.abs(deltaY);
            const secondary = direction === 'left' || direction === 'right' ? Math.abs(deltaY) : Math.abs(deltaX);
            const score = primary * primary + secondary * secondary * 0.25;
            if (!best || score < best.score) {
                best = { id: candidate, score };
            }
        }
        return best?.id ?? null;
    }

    private snapshotNode(index: number): WidgetSnapshot {
        const record = this.records[index]!;
        const children: WidgetSnapshot[] = [];
        for (let child = this.firstChild[index]; child !== 0; child = this.nextSibling[child]) {
            children.push(this.snapshotNode(child));
        }
        return {
            role: record.role,
            controller: record.controller ?? undefined,
            key: this.serializeKey(record.key),
            props: cloneData(record.props),
            enabled: record.enabled,
            interactive: record.interactive,
            layout: cloneData(record.layoutInput),
            style: cloneData(record.styleInput),
            text: cloneData(record.textInput),
            image: cloneData(record.imageInput),
            focus: cloneData(record.focusInput),
            children,
        };
    }

    private serializeKey(key: WidgetKey | undefined): WidgetSerializableKey | undefined {
        if (key === undefined) {
            return undefined;
        }
        if (typeof key === 'symbol') {
            return null;
        }
        return key;
    }

    private restoreChildSnapshot(parent: WidgetId, snapshot: WidgetSnapshot): WidgetId {
        const child = this.createWidget({
            role: snapshot.role,
            controller: snapshot.controller,
            key: snapshot.key ?? undefined,
            props: cloneData(snapshot.props ?? EMPTY_RECORD_OBJECT),
            enabled: snapshot.enabled,
            interactive: snapshot.interactive,
            layout: cloneData(snapshot.layout ?? EMPTY_LAYOUT_INPUT),
            style: cloneData(snapshot.style ?? EMPTY_STYLE_INPUT),
            text: cloneData(snapshot.text ?? null),
            image: cloneData(snapshot.image ?? null),
            focus: cloneData(snapshot.focus ?? EMPTY_FOCUS_INPUT),
        });
        this.appendChild(parent, child);
        for (const grandChild of snapshot.children) {
            this.restoreChildSnapshot(child, grandChild);
        }
        return child;
    }

    private destroyNode(index: number): void {
        if (this.focused && this.isAncestor(index, this.focused as number)) {
            this.focused = null;
        }
        if (this.hovered && this.isAncestor(index, this.hovered as number)) {
            this.hovered = null;
        }
        if (this.pressed && this.isAncestor(index, this.pressed as number)) {
            this.pressed = null;
        }
        const controller = this.records[index]?.controller
            ? this.registry.resolve(this.records[index]!.controller)
            : null;
        controller?.disposeState?.(this.states[index], this, index as WidgetId);
        this.records[index] = null;
        this.layouts[index] = null;
        this.styles[index] = null;
        this.texts[index] = null;
        this.images[index] = null;
        this.focuses[index] = null;
        this.states[index] = undefined;
        this.textLayouts[index] = null;
        this.textLayoutWidths[index] = Number.NaN;
        this.parent[index] = 0;
        this.firstChild[index] = 0;
        this.lastChild[index] = 0;
        this.previousSibling[index] = 0;
        this.nextSibling[index] = 0;
        this.flags[index] = 0;
        this.freeList.push(index);
        this.liveCount -= 1;
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