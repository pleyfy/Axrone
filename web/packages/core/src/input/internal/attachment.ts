import { InputConfigurationError } from '../errors';
import { isEventTargetLike } from './shared';
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
    const listenerOptions = { capture, passive };

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

    add<MouseEvent>(
        pointerTarget,
        'mousedown',
        (event) => {
            preventIfNeeded(event);
            host.dispatch({
                type: 'mouse-button',
                button: event.button,
                pressed: true,
                x: event.clientX,
                y: event.clientY,
            });
        },
        listenerOptions
    );

    add<MouseEvent>(
        pointerTarget,
        'mouseup',
        (event) => {
            preventIfNeeded(event);
            host.dispatch({
                type: 'mouse-button',
                button: event.button,
                pressed: false,
                x: event.clientX,
                y: event.clientY,
            });
        },
        listenerOptions
    );

    add<MouseEvent>(
        pointerTarget,
        'mousemove',
        (event) => {
            preventIfNeeded(event);
            const position = host.getMousePosition();
            host.dispatch({
                type: 'mouse-move',
                x: event.clientX,
                y: event.clientY,
                deltaX:
                    typeof event.movementX === 'number' ? event.movementX : event.clientX - position.x,
                deltaY:
                    typeof event.movementY === 'number' ? event.movementY : event.clientY - position.y,
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
                deltaX: event.deltaX,
                deltaY: event.deltaY,
                deltaZ: event.deltaZ,
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

            result.push({
                id: touch.identifier,
                x: touch.clientX,
                y: touch.clientY,
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
        dispose: () => {
            if (disposed) {
                return;
            }

            disposed = true;

            for (const remove of removers.splice(0, removers.length)) {
                remove();
            }
        },
    };
};