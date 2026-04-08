import { InputConfigurationError } from '../errors';
import { isEventTargetLike, toFiniteNumber } from './shared';
import type {
    InputAttachment,
    InputBrowserTarget,
    InputMessageDescriptor,
    InputSourceEvent,
    InputTouchPoint,
} from '../types';

interface InputBrowserAttachmentHost {
    dispatch(event: Readonly<InputSourceEvent>): void;
    getMousePosition(): Readonly<{ x: number; y: number }>;
    resolveMessage(descriptor: Readonly<InputMessageDescriptor>): string;
}

interface PointerLockCapableTarget extends EventTarget {
    requestPointerLock?(): Promise<void> | void;
}

type PointerLockDocument = Document & {
    pointerLockElement?: Element | null;
    exitPointerLock?: (() => Promise<void> | void) | undefined;
};

const DEFAULT_LINE_PIXELS = 16;
const DEFAULT_PAGE_PIXELS = 800;

export const attachInputBrowserTarget = (
    host: InputBrowserAttachmentHost,
    target: InputBrowserTarget = {}
): InputAttachment => {
    const resolvedWindow =
        target.window ??
        (typeof window !== 'undefined' ? (window as Window & typeof globalThis) : undefined);
    const resolvedDocument = target.document ?? resolvedWindow?.document;
    const keyboardTarget = resolvedDocument ?? resolvedWindow ?? target.element;
    const pointerTarget = target.element ?? resolvedWindow ?? resolvedDocument;

    if (!isEventTargetLike(keyboardTarget) || !isEventTargetLike(pointerTarget)) {
        throw new InputConfigurationError(
            'input.invalid-target',
            host.resolveMessage({
                code: 'input.invalid-target',
                value: target,
            })
        );
    }

    const removers: Array<() => void> = [];
    let disposed = false;
    const capture = target.capture ?? false;
    const passive = target.passive ?? false;
    const coordinateSpace = target.coordinateSpace ?? 'client';
    const linePixels = Math.max(1, toFiniteNumber(target.wheelPixelsPerLine, DEFAULT_LINE_PIXELS));
    const pagePixels = Math.max(1, toFiniteNumber(target.wheelPixelsPerPage, DEFAULT_PAGE_PIXELS));
    const rawPointerLock = target.pointerLock;
    const pointerLock =
        rawPointerLock === true
            ? {
                  enabled: true,
                  requestOnMouseDown: true,
                  exitOnDispose: true,
                  useRawMovement: true,
              }
            : {
                  enabled:
                      rawPointerLock !== false && typeof rawPointerLock === 'object'
                          ? rawPointerLock.enabled ?? false
                          : false,
                  requestOnMouseDown:
                      rawPointerLock !== false && typeof rawPointerLock === 'object'
                          ? rawPointerLock.requestOnMouseDown ?? false
                          : false,
                  exitOnDispose:
                      rawPointerLock !== false && typeof rawPointerLock === 'object'
                          ? rawPointerLock.exitOnDispose ?? true
                          : true,
                  useRawMovement:
                      rawPointerLock !== false && typeof rawPointerLock === 'object'
                          ? rawPointerLock.useRawMovement ?? true
                          : true,
              };
    const listenerOptions = { capture, passive };
    const pointerLockElement = isPointerLockCapable(pointerTarget) ? pointerTarget : undefined;
    const pointerLockDocument = isPointerLockDocument(resolvedDocument) ? resolvedDocument : undefined;

    const add = <TEvent extends Event>(
        source: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>,
        type: string,
        handler: (event: TEvent) => void,
        options?: AddEventListenerOptions | boolean
    ): void => {
        const listener = handler as EventListener;
        source.addEventListener(type, listener, options);
        removers.push(() => {
            source.removeEventListener(type, listener, options);
        });
    };

    const preventIfNeeded = (event: Event): void => {
        if (target.preventDefault) {
            event.preventDefault();
        }
    };

    const isPointerLocked = (): boolean =>
        !!pointerLock.enabled &&
        !!pointerLockElement &&
        !!pointerLockDocument &&
        pointerLockDocument.pointerLockElement === pointerLockElement;

    const requestPointerLock = (): boolean => {
        if (!pointerLock.enabled || !pointerLockElement?.requestPointerLock) {
            return false;
        }

        pointerLockElement.requestPointerLock();
        return true;
    };

    const exitPointerLock = (): boolean => {
        if (!pointerLockDocument?.exitPointerLock || !isPointerLocked()) {
            return false;
        }

        pointerLockDocument.exitPointerLock();
        return true;
    };

    const resolveClientSize = (): { width: number; height: number } => {
        if (hasBoundingRect(pointerTarget)) {
            const rect = pointerTarget.getBoundingClientRect();
            return {
                width: Math.max(rect.width, 1),
                height: Math.max(rect.height, 1),
            };
        }

        return {
            width: Math.max(resolvedWindow?.innerWidth ?? 1, 1),
            height: Math.max(resolvedWindow?.innerHeight ?? 1, 1),
        };
    };

    const resolvePoint = (
        clientX: number,
        clientY: number,
        deltaX?: number,
        deltaY?: number
    ): { x: number; y: number } => {
        const previous = host.getMousePosition();

        if (isPointerLocked() && pointerLock.useRawMovement) {
            const nextX = previous.x + (deltaX ?? 0);
            const nextY = previous.y + (deltaY ?? 0);

            if (coordinateSpace === 'viewport') {
                const size = resolveClientSize();
                return {
                    x: nextX / size.width,
                    y: nextY / size.height,
                };
            }

            return {
                x: nextX,
                y: nextY,
            };
        }

        let nextX = clientX;
        let nextY = clientY;

        if (hasBoundingRect(pointerTarget)) {
            const rect = pointerTarget.getBoundingClientRect();
            if (coordinateSpace === 'element' || coordinateSpace === 'viewport') {
                nextX -= rect.left;
                nextY -= rect.top;
            }

            if (coordinateSpace === 'viewport') {
                nextX /= Math.max(rect.width, 1);
                nextY /= Math.max(rect.height, 1);
            }
        } else if (coordinateSpace === 'viewport') {
            const size = resolveClientSize();
            nextX /= size.width;
            nextY /= size.height;
        }

        return {
            x: nextX,
            y: nextY,
        };
    };

    const resolveWheelDelta = (value: number, deltaMode: number): number => {
        if (deltaMode === 1) {
            return value * linePixels;
        }

        if (deltaMode === 2) {
            return value * pagePixels;
        }

        return value;
    };

    add<KeyboardEvent>(keyboardTarget, 'keydown', (event) => {
        preventIfNeeded(event);
        host.dispatch({
            type: 'keyboard',
            code: event.code,
            pressed: true,
            repeat: event.repeat,
        });
    });

    add<KeyboardEvent>(keyboardTarget, 'keyup', (event) => {
        preventIfNeeded(event);
        host.dispatch({
            type: 'keyboard',
            code: event.code,
            pressed: false,
            repeat: event.repeat,
        });
    });

    add<InputEvent>(
        keyboardTarget,
        'beforeinput',
        (event) => {
            if (typeof event.data !== 'string' || !event.data) {
                return;
            }

            preventIfNeeded(event);
            host.dispatch({
                type: 'text',
                text: event.data,
            });
        },
        listenerOptions
    );

    add<CompositionEvent>(
        keyboardTarget,
        'compositionstart',
        (event) => {
            host.dispatch({
                type: 'composition',
                phase: 'start',
                text: event.data ?? '',
            });
        },
        listenerOptions
    );

    add<CompositionEvent>(
        keyboardTarget,
        'compositionupdate',
        (event) => {
            host.dispatch({
                type: 'composition',
                phase: 'update',
                text: event.data ?? '',
            });
        },
        listenerOptions
    );

    add<CompositionEvent>(
        keyboardTarget,
        'compositionend',
        (event) => {
            host.dispatch({
                type: 'composition',
                phase: 'end',
                text: event.data ?? '',
            });
        },
        listenerOptions
    );

    add<MouseEvent>(
        pointerTarget,
        'mousedown',
        (event) => {
            preventIfNeeded(event);
            const point = resolvePoint(event.clientX, event.clientY, event.movementX, event.movementY);
            if (pointerLock.requestOnMouseDown) {
                requestPointerLock();
            }

            host.dispatch({
                type: 'mouse-button',
                button: event.button,
                pressed: true,
                x: point.x,
                y: point.y,
            });
        },
        listenerOptions
    );

    add<MouseEvent>(
        pointerTarget,
        'mouseup',
        (event) => {
            preventIfNeeded(event);
            const point = resolvePoint(event.clientX, event.clientY, event.movementX, event.movementY);
            host.dispatch({
                type: 'mouse-button',
                button: event.button,
                pressed: false,
                x: point.x,
                y: point.y,
            });
        },
        listenerOptions
    );

    add<MouseEvent>(
        pointerTarget,
        'mousemove',
        (event) => {
            preventIfNeeded(event);
            const previous = host.getMousePosition();
            const point = resolvePoint(event.clientX, event.clientY, event.movementX, event.movementY);
            host.dispatch({
                type: 'mouse-move',
                x: point.x,
                y: point.y,
                deltaX:
                    typeof event.movementX === 'number'
                        ? event.movementX
                        : point.x - previous.x,
                deltaY:
                    typeof event.movementY === 'number'
                        ? event.movementY
                        : point.y - previous.y,
            });
        },
        listenerOptions
    );

    add<WheelEvent>(
        pointerTarget,
        'wheel',
        (event) => {
            preventIfNeeded(event);
            host.dispatch({
                type: 'mouse-wheel',
                deltaX: resolveWheelDelta(event.deltaX, event.deltaMode),
                deltaY: resolveWheelDelta(event.deltaY, event.deltaMode),
                deltaZ: resolveWheelDelta(event.deltaZ, event.deltaMode),
            });
        },
        { capture, passive: false }
    );

    const toTouchPoints = (touches: TouchList): InputTouchPoint[] => {
        const result: InputTouchPoint[] = [];

        for (let index = 0; index < touches.length; index += 1) {
            const touch = touches.item(index);
            if (!touch) {
                continue;
            }

            const point = resolvePoint(touch.clientX, touch.clientY);
            result.push({
                id: touch.identifier,
                x: point.x,
                y: point.y,
                force: typeof touch.force === 'number' ? touch.force : undefined,
            });
        }

        return result;
    };

    add<TouchEvent>(
        pointerTarget,
        'touchstart',
        (event) => {
            preventIfNeeded(event);
            host.dispatch({
                type: 'touch',
                phase: 'start',
                touches: toTouchPoints(event.touches),
                changed: toTouchPoints(event.changedTouches),
            });
        },
        listenerOptions
    );

    add<TouchEvent>(
        pointerTarget,
        'touchmove',
        (event) => {
            preventIfNeeded(event);
            host.dispatch({
                type: 'touch',
                phase: 'move',
                touches: toTouchPoints(event.touches),
                changed: toTouchPoints(event.changedTouches),
            });
        },
        listenerOptions
    );

    add<TouchEvent>(
        pointerTarget,
        'touchend',
        (event) => {
            preventIfNeeded(event);
            host.dispatch({
                type: 'touch',
                phase: 'end',
                touches: toTouchPoints(event.touches),
                changed: toTouchPoints(event.changedTouches),
            });
        },
        listenerOptions
    );

    add<TouchEvent>(
        pointerTarget,
        'touchcancel',
        (event) => {
            preventIfNeeded(event);
            host.dispatch({
                type: 'touch',
                phase: 'cancel',
                touches: toTouchPoints(event.touches),
                changed: toTouchPoints(event.changedTouches),
            });
        },
        listenerOptions
    );

    if (isEventTargetLike(resolvedWindow)) {
        add<Event>(resolvedWindow, 'blur', () => {
            host.dispatch({
                type: 'focus',
                focused: false,
            });
        });
    }

    return {
        get isDisposed(): boolean {
            return disposed;
        },
        get isPointerLocked(): boolean | undefined {
            return pointerLock.enabled ? isPointerLocked() : undefined;
        },
        requestPointerLock,
        exitPointerLock,
        dispose: () => {
            if (disposed) {
                return;
            }

            disposed = true;

            for (const remove of removers.splice(0, removers.length)) {
                remove();
            }

            if (pointerLock.exitOnDispose) {
                exitPointerLock();
            }
        },
    };
};

const hasBoundingRect = (value: unknown): value is EventTarget & { getBoundingClientRect(): DOMRect } =>
    isEventTargetLike(value) &&
    typeof (value as { getBoundingClientRect?: unknown }).getBoundingClientRect === 'function';

const isPointerLockCapable = (value: unknown): value is PointerLockCapableTarget =>
    isEventTargetLike(value) &&
    typeof (value as PointerLockCapableTarget).requestPointerLock === 'function';

const isPointerLockDocument = (value: unknown): value is PointerLockDocument =>
    isRecordLike(value) &&
    typeof (value as unknown as PointerLockDocument).exitPointerLock === 'function';

const isRecordLike = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object';
