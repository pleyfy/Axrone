import type {
    LayoutBox,
    ReadonlyColor,
    ResolvedFocusPolicy,
    ResolvedTextBlock,
    ResolvedWidgetImage,
    ResolvedWidgetStyle,
    SizeLike,
    UIFrame,
    WidgetConfig,
    WidgetId,
} from '../../types';
import type { StoredWidgetRecord } from '../records';

export interface WidgetLifecycleHost<TPayload = unknown, TRuntime = unknown> {
    allocate(): WidgetId;
    requireWidget(widget: WidgetId | null): number;
    isAncestor(ancestor: number, candidate: number): boolean;
    detachNode(index: number): void;
    refreshDepths(index: number, depth: number): void;
    markTreeChanged(index: number): void;
    destroyNode(index: number): void;
    normalizeRecord(config: WidgetConfig<Record<string, unknown>, TRuntime>): StoredWidgetRecord<TRuntime>;
    applyRecord(
        index: number,
        previousProps: Readonly<Record<string, unknown>> | null,
        previousController: string | null,
        initial: boolean
    ): void;
    updateFlags(index: number): void;
    compileStyle(input: StoredWidgetRecord<TRuntime>['styleInput']): ResolvedWidgetStyle;
    compileText(
        input: StoredWidgetRecord<TRuntime>['textInput'],
        fallbackColor: ReadonlyColor
    ): ResolvedTextBlock | null;
    compileImage(input: StoredWidgetRecord<TRuntime>['imageInput']): ResolvedWidgetImage | null;
    compileFocus(input: StoredWidgetRecord<TRuntime>['focusInput'], interactive: boolean): ResolvedFocusPolicy;
    createControllerContext(index: number): unknown;
    measureContent(index: number, constraints: Readonly<SizeLike>): SizeLike;
    measureImageContent(image: ResolvedWidgetImage, constraints: Readonly<SizeLike>): SizeLike;
    writeBox(index: number, box: LayoutBox): void;
    readBox(index: number): LayoutBox;
    renderFrame(): UIFrame<TPayload>;
    resolveImageCommand(
        index: number,
        box: LayoutBox,
        image: ResolvedWidgetImage,
        style: ResolvedWidgetStyle,
        clip: LayoutBox | null,
        zIndex: number
    ): UIFrame<TPayload>['commands'][number] | null;
}

/**
 * Thin lifecycle facade for runtimes that expose widget allocation, tree
 * mutation, record application, and frame rendering as a single host contract.
 */
export class WidgetLifecycleManager<TPayload = unknown, TRuntime = unknown> {
    private readonly runtime: WidgetLifecycleHost<TPayload, TRuntime>;

    constructor(runtime: WidgetLifecycleHost<TPayload, TRuntime>) {
        this.runtime = runtime;
    }

    allocate(): WidgetId {
        return this.runtime.allocate();
    }

    requireWidget(widget: WidgetId | null): number {
        return this.runtime.requireWidget(widget);
    }

    isAncestor(ancestor: number, candidate: number): boolean {
        return this.runtime.isAncestor(ancestor, candidate);
    }

    detachNode(index: number): void {
        this.runtime.detachNode(index);
    }

    refreshDepths(index: number, depth: number): void {
        this.runtime.refreshDepths(index, depth);
    }

    markTreeChanged(index: number): void {
        this.runtime.markTreeChanged(index);
    }

    destroyNode(index: number): void {
        this.runtime.destroyNode(index);
    }

    normalizeRecord(config: WidgetConfig<Record<string, unknown>, TRuntime>): StoredWidgetRecord<TRuntime> {
        return this.runtime.normalizeRecord(config);
    }

    applyRecord(
        index: number,
        previousProps: Readonly<Record<string, unknown>> | null,
        previousController: string | null,
        initial: boolean
    ): void {
        this.runtime.applyRecord(index, previousProps, previousController, initial);
    }

    updateFlags(index: number): void {
        this.runtime.updateFlags(index);
    }

    compileStyle(input: StoredWidgetRecord<TRuntime>['styleInput']): ResolvedWidgetStyle {
        return this.runtime.compileStyle(input);
    }

    compileText(
        input: StoredWidgetRecord<TRuntime>['textInput'],
        fallbackColor: ReadonlyColor
    ): ResolvedTextBlock | null {
        return this.runtime.compileText(input, fallbackColor);
    }

    compileImage(input: StoredWidgetRecord<TRuntime>['imageInput']): ResolvedWidgetImage | null {
        return this.runtime.compileImage(input);
    }

    compileFocus(input: StoredWidgetRecord<TRuntime>['focusInput'], interactive: boolean): ResolvedFocusPolicy {
        return this.runtime.compileFocus(input, interactive);
    }

    createControllerContext(index: number): unknown {
        return this.runtime.createControllerContext(index);
    }

    measureContent(index: number, constraints: Readonly<SizeLike>): SizeLike {
        return this.runtime.measureContent(index, constraints);
    }

    measureImageContent(image: ResolvedWidgetImage, constraints: Readonly<SizeLike>): SizeLike {
        return this.runtime.measureImageContent(image, constraints);
    }

    writeBox(index: number, box: LayoutBox): void {
        this.runtime.writeBox(index, box);
    }

    readBox(index: number): LayoutBox {
        return this.runtime.readBox(index);
    }

    renderFrame(): UIFrame<TPayload> {
        return this.runtime.renderFrame();
    }

    resolveImageCommand(
        index: number,
        box: LayoutBox,
        image: ResolvedWidgetImage,
        style: ResolvedWidgetStyle,
        clip: LayoutBox | null,
        zIndex: number
    ): UIFrame<TPayload>['commands'][number] | null {
        return this.runtime.resolveImageCommand(index, box, image, style, clip, zIndex);
    }
}
