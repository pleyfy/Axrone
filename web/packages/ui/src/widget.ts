import { UIError, UIErrorCode } from './errors';
import type { FocusMoveDirection, SizeLike, UIInputEvent, WidgetId } from './types';
import type { WidgetConfig } from './types';

export interface WidgetControllerContext<
    TProps extends Record<string, unknown> = Record<string, never>,
    TState = unknown,
    TRuntime = unknown,
> {
    readonly runtime: TRuntime;
    readonly widget: WidgetId;
    readonly props: Readonly<TProps>;
    readonly state: TState;
}

export interface WidgetMeasureContext<
    TProps extends Record<string, unknown> = Record<string, never>,
    TState = unknown,
    TRuntime = unknown,
> extends WidgetControllerContext<TProps, TState, TRuntime> {
    readonly availableWidth: number;
    readonly availableHeight: number;
}

export interface WidgetRenderContext<
    TProps extends Record<string, unknown> = Record<string, never>,
    TState = unknown,
    TRuntime = unknown,
    TPayload = unknown,
> extends WidgetControllerContext<TProps, TState, TRuntime> {
    push(payload: TPayload): void;
}

export interface WidgetFocusContext<
    TProps extends Record<string, unknown> = Record<string, never>,
    TState = unknown,
    TRuntime = unknown,
> extends WidgetControllerContext<TProps, TState, TRuntime> {
    readonly reason: 'api' | 'pointer' | 'navigation' | 'window';
    readonly direction?: FocusMoveDirection;
}

export interface WidgetController<
    TType extends string = string,
    TProps extends Record<string, unknown> = Record<string, never>,
    TState = unknown,
    TRuntime = unknown,
    TPayload = unknown,
> {
    readonly type: TType;
    createState?(props: Readonly<TProps>, runtime: TRuntime, widget: WidgetId): TState;
    mount?(context: WidgetControllerContext<TProps, TState, TRuntime>): void;
    update?(
        context: WidgetControllerContext<TProps, TState, TRuntime>,
        previousProps: Readonly<TProps>
    ): void;
    measure?(context: WidgetMeasureContext<TProps, TState, TRuntime>): SizeLike | null;
    input?(event: Readonly<UIInputEvent>, context: WidgetControllerContext<TProps, TState, TRuntime>): boolean | void;
    focus?(context: WidgetFocusContext<TProps, TState, TRuntime>): void;
    blur?(context: WidgetFocusContext<TProps, TState, TRuntime>): void;
    render?(context: WidgetRenderContext<TProps, TState, TRuntime, TPayload>): void;
    disposeState?(state: TState, runtime: TRuntime, widget: WidgetId): void;
}

type AnyController<TRuntime, TPayload> = WidgetController<
    string,
    Record<string, unknown>,
    unknown,
    TRuntime,
    TPayload
>;

export class WidgetRegistry<TRuntime = unknown, TPayload = unknown> {
    private readonly controllers = new Map<string, AnyController<TRuntime, TPayload>>();

    register<
        TType extends string,
        TProps extends Record<string, unknown>,
        TState,
    >(controller: WidgetController<TType, TProps, TState, TRuntime, TPayload>): this {
        if (this.controllers.has(controller.type)) {
            throw new UIError(UIErrorCode.DuplicateController, `Widget controller \"${controller.type}\" already exists.`);
        }
        this.controllers.set(controller.type, controller as AnyController<TRuntime, TPayload>);
        return this;
    }

    replace<
        TType extends string,
        TProps extends Record<string, unknown>,
        TState,
    >(controller: WidgetController<TType, TProps, TState, TRuntime, TPayload>): this {
        this.controllers.set(controller.type, controller as AnyController<TRuntime, TPayload>);
        return this;
    }

    resolve(type: string | null | undefined): AnyController<TRuntime, TPayload> | null {
        if (!type) {
            return null;
        }
        return this.controllers.get(type) ?? null;
    }

    has(type: string): boolean {
        return this.controllers.has(type);
    }

    delete(type: string): boolean {
        return this.controllers.delete(type);
    }

    clear(): void {
        this.controllers.clear();
    }

    values(): IterableIterator<AnyController<TRuntime, TPayload>> {
        return this.controllers.values();
    }
}

export const defineWidget = <
    TType extends string,
    TProps extends Record<string, unknown>,
    TState,
    TRuntime,
    TPayload,
>(
    controller: WidgetController<TType, TProps, TState, TRuntime, TPayload>
): WidgetController<TType, TProps, TState, TRuntime, TPayload> => controller;

export const createWidgetFactory = <TType extends string, TProps extends Record<string, unknown>>(
    type: TType,
    defaults?: Readonly<Partial<TProps>>
) => {
    return (props?: Readonly<Partial<TProps>>): WidgetConfig<TProps> => ({
        controller: type,
        props: { ...(defaults ?? {}), ...(props ?? {}) } as Readonly<TProps>,
    });
};

export type {
    WidgetConfig,
    WidgetId,
    UIInputEvent,
    SizeLike,
    FocusMoveDirection,
};