import { describe, expect, it } from 'vitest';
import { createInputSystem, InputContextError } from '@axrone/input';

describe('InputSystem', () => {
    it('honors context priority and capture rules', () => {
        const input = createInputSystem({
            schema: {
                jump: { kind: 'button' },
                confirm: { kind: 'button' },
            },
            contexts: [
                {
                    id: 'gameplay',
                    priority: 0,
                    bindings: {
                        jump: [{ type: 'control', control: 'keyboard/Space' }],
                    },
                },
                {
                    id: 'ui',
                    priority: 10,
                    capture: 'used',
                    bindings: {
                        confirm: [{ type: 'control', control: 'keyboard/Space' }],
                    },
                },
            ],
        });

        input.dispatch({
            type: 'keyboard',
            code: 'Space',
            pressed: true,
        });
        input.update(1);

        expect(input.read('confirm')).toBe(true);
        expect(input.read('jump')).toBe(false);

        input.deactivateContext('ui');
        input.update(2);

        expect(input.read('confirm')).toBe(false);
        expect(input.read('jump')).toBe(true);
        expect(input.isPressed('jump')).toBe(true);
    });

    it('supports transient mouse and touch input alongside gamepad state', () => {
        const input = createInputSystem({
            schema: {
                look: { kind: 'vector2' },
                zoom: { kind: 'axis' },
                move: { kind: 'vector2' },
                fire: { kind: 'button' },
            },
            contexts: [
                {
                    id: 'gameplay',
                    bindings: {
                        look: [{ type: 'dual-axis', x: 'mouse/move/x', y: 'mouse/move/y' }],
                        zoom: [{ type: 'control', control: 'touch/pinch' }],
                        move: [{ type: 'dual-axis', x: 'gamepad/0/axis/0', y: 'gamepad/0/axis/1' }],
                        fire: [{ type: 'control', control: 'gamepad/0/button/0' }],
                    },
                },
            ],
        });

        input.dispatch({
            type: 'mouse-move',
            x: 12,
            y: 8,
            deltaX: 12,
            deltaY: -4,
        });
        input.update(1);

        expect(input.read('look')).toEqual({ x: 12, y: -4 });

        input.update(2);
        expect(input.read('look')).toEqual({ x: 0, y: 0 });

        input.dispatch({
            type: 'touch',
            phase: 'start',
            touches: [
                { id: 1, x: 0, y: 0 },
                { id: 2, x: 10, y: 0 },
            ],
            changed: [
                { id: 1, x: 0, y: 0 },
                { id: 2, x: 10, y: 0 },
            ],
        });
        input.dispatch({
            type: 'touch',
            phase: 'move',
            touches: [
                { id: 1, x: 0, y: 0 },
                { id: 2, x: 18, y: 0 },
            ],
            changed: [{ id: 2, x: 18, y: 0 }],
        });
        input.update(3);

        expect(input.read('zoom')).toBe(8);

        input.dispatch({
            type: 'gamepad',
            gamepads: [
                {
                    index: 0,
                    connected: true,
                    buttons: [1],
                    axes: [0.5, -0.25],
                },
            ],
        });
        input.update(4);

        expect(input.read('move')).toEqual({ x: 0.5, y: -0.25 });
        expect(input.read('fire')).toBe(true);
    });

    it('supports semantic gamepad paths with user ownership and hot-swapping', () => {
        const input = createInputSystem({
            schema: {
                moveP1: { kind: 'vector2' },
                moveP2: { kind: 'vector2' },
                fireP1: { kind: 'button' },
                fireP2: { kind: 'button' },
            },
            users: [
                {
                    id: 'player-1',
                    devices: [{ device: 'gamepad', index: 0 }],
                },
                {
                    id: 'player-2',
                    devices: [{ device: 'gamepad', index: 1 }],
                },
            ],
            contexts: [
                {
                    id: 'player-1-gameplay',
                    user: 'player-1',
                    bindings: {
                        moveP1: [
                            {
                                type: 'dual-axis',
                                x: 'gamepad/any/left-stick/x',
                                y: 'gamepad/any/left-stick/y',
                            },
                        ],
                        fireP1: [{ type: 'control', control: 'gamepad/any/south' }],
                    },
                },
                {
                    id: 'player-2-gameplay',
                    user: 'player-2',
                    bindings: {
                        moveP2: [
                            {
                                type: 'dual-axis',
                                x: 'gamepad/any/left-stick/x',
                                y: 'gamepad/any/left-stick/y',
                            },
                        ],
                        fireP2: [{ type: 'control', control: 'gamepad/any/south' }],
                    },
                },
            ],
        });

        input.dispatch({
            type: 'gamepad',
            gamepads: [
                {
                    index: 0,
                    connected: true,
                    buttons: [1],
                    axes: [0.5, -0.25],
                },
                {
                    index: 1,
                    connected: true,
                    buttons: [0],
                    axes: [-0.75, 0.4],
                },
            ],
        });
        input.update(1);

        expect(input.read('moveP1')).toEqual({ x: 0.5, y: -0.25 });
        expect(input.read('fireP1')).toBe(true);
        expect(input.read('moveP2')).toEqual({ x: -0.75, y: 0.4 });
        expect(input.read('fireP2')).toBe(false);

        input.assignGamepad('player-1', 1);
        input.dispatch({
            type: 'gamepad',
            gamepads: [
                {
                    index: 0,
                    connected: true,
                    buttons: [0],
                    axes: [0, 0],
                },
                {
                    index: 1,
                    connected: true,
                    buttons: [1],
                    axes: [0.2, -0.9],
                },
            ],
        });
        input.update(2);

        expect(input.read('moveP1')).toEqual({ x: 0.2, y: -0.9 });
        expect(input.read('fireP1')).toBe(true);
        expect(input.read('moveP2')).toEqual({ x: 0, y: 0 });
        expect(input.read('fireP2')).toBe(false);
        expect(input.user('player-1')?.devices).toEqual(
            expect.arrayContaining([
                { device: 'gamepad', index: 0 },
                { device: 'gamepad', index: 1 },
            ])
        );
    });

    it('attaches DOM targets and forwards browser events into the system', () => {
        const input = createInputSystem({
            schema: {
                jump: { kind: 'button' },
                look: { kind: 'vector2' },
            },
            contexts: [
                {
                    id: 'gameplay',
                    bindings: {
                        jump: [{ type: 'control', control: 'keyboard/Space' }],
                        look: [{ type: 'dual-axis', x: 'mouse/move/x', y: 'mouse/move/y' }],
                    },
                },
            ],
        });

        const attachment = input.attach({ document, window });
        const keyDown = new Event('keydown') as KeyboardEvent;
        Object.defineProperty(keyDown, 'code', { value: 'Space' });
        Object.defineProperty(keyDown, 'repeat', { value: false });
        document.dispatchEvent(keyDown);
        input.update(1);
        expect(input.read('jump')).toBe(true);

        const move = new Event('mousemove') as MouseEvent;
        Object.defineProperty(move, 'clientX', { value: 10 });
        Object.defineProperty(move, 'clientY', { value: 5 });
        window.dispatchEvent(move);
        input.update(2);
        expect(input.read('look')).toEqual({ x: 10, y: 5 });

        const keyUp = new Event('keyup') as KeyboardEvent;
        Object.defineProperty(keyUp, 'code', { value: 'Space' });
        Object.defineProperty(keyUp, 'repeat', { value: false });
        document.dispatchEvent(keyUp);
        input.update(3);
        expect(input.read('jump')).toBe(false);

        attachment.dispose();
        expect(attachment.isDisposed).toBe(true);
    });

    it('normalizes browser coordinates, wheel deltas, pointer lock, and text composition events', () => {
        const input = createInputSystem({
            schema: {
                look: { kind: 'vector2' },
                cursor: { kind: 'vector2' },
                zoom: { kind: 'axis' },
            },
            contexts: [
                {
                    id: 'gameplay',
                    bindings: {
                        look: [{ type: 'dual-axis', x: 'mouse/move/x', y: 'mouse/move/y' }],
                        cursor: [{ type: 'dual-axis', x: 'mouse/position/x', y: 'mouse/position/y' }],
                        zoom: [{ type: 'control', control: 'mouse/wheel/y' }],
                    },
                },
            ],
        });

        const surface = new EventTarget() as EventTarget & {
            getBoundingClientRect(): DOMRect;
            requestPointerLock(): void;
        };
        const doc = document as Document & {
            pointerLockElement?: EventTarget | null;
            exitPointerLock?: () => void;
        };
        doc.pointerLockElement = null;
        doc.exitPointerLock = () => {
            doc.pointerLockElement = null;
        };
        surface.getBoundingClientRect = () =>
            ({
                left: 100,
                top: 50,
                width: 200,
                height: 100,
            }) as DOMRect;
        surface.requestPointerLock = () => {
            doc.pointerLockElement = surface;
        };

        const attachment = input.attach({
            document: doc,
            element: surface,
            coordinateSpace: 'element',
            wheelPixelsPerLine: 20,
            pointerLock: {
                enabled: true,
                requestOnMouseDown: true,
                useRawMovement: true,
            },
        });

        const down = new Event('mousedown') as MouseEvent;
        Object.defineProperty(down, 'button', { value: 0 });
        Object.defineProperty(down, 'clientX', { value: 110 });
        Object.defineProperty(down, 'clientY', { value: 70 });
        Object.defineProperty(down, 'movementX', { value: 0 });
        Object.defineProperty(down, 'movementY', { value: 0 });
        surface.dispatchEvent(down);

        const move = new Event('mousemove') as MouseEvent;
        Object.defineProperty(move, 'clientX', { value: 999 });
        Object.defineProperty(move, 'clientY', { value: 999 });
        Object.defineProperty(move, 'movementX', { value: 4 });
        Object.defineProperty(move, 'movementY', { value: -2 });
        surface.dispatchEvent(move);

        const wheel = new Event('wheel') as WheelEvent;
        Object.defineProperty(wheel, 'deltaMode', { value: 1 });
        Object.defineProperty(wheel, 'deltaX', { value: 0 });
        Object.defineProperty(wheel, 'deltaY', { value: 3 });
        Object.defineProperty(wheel, 'deltaZ', { value: 0 });
        surface.dispatchEvent(wheel);

        const compositionStart = new Event('compositionstart') as CompositionEvent;
        Object.defineProperty(compositionStart, 'data', { value: 'ya' });
        document.dispatchEvent(compositionStart);
        const compositionUpdate = new Event('compositionupdate') as CompositionEvent;
        Object.defineProperty(compositionUpdate, 'data', { value: 'yaz' });
        document.dispatchEvent(compositionUpdate);
        const beforeInput = new Event('beforeinput') as InputEvent;
        Object.defineProperty(beforeInput, 'data', { value: 'ğ' });
        document.dispatchEvent(beforeInput);
        input.update(1);

        expect(attachment.isPointerLocked).toBe(true);
        expect(input.read('look')).toEqual({ x: 4, y: -2 });
        expect(input.read('cursor')).toEqual({ x: 14, y: 18 });
        expect(input.read('zoom')).toBe(60);
        expect(input.textEntries()).toEqual([
            expect.objectContaining({
                text: 'ğ',
                frame: 0,
            }),
        ]);
        expect(input.composition()).toEqual(
            expect.objectContaining({
                active: true,
                text: 'yaz',
                frame: 0,
            })
        );

        const compositionEnd = new Event('compositionend') as CompositionEvent;
        Object.defineProperty(compositionEnd, 'data', { value: 'yaz' });
        document.dispatchEvent(compositionEnd);
        input.update(2);
        expect(input.textEntries()).toEqual([]);
        expect(input.composition().active).toBe(false);

        attachment.dispose();
        expect(attachment.isDisposed).toBe(true);
        expect(doc.pointerLockElement).toBe(null);
    });

    it('applies binding and action processor chains', () => {
        const input = createInputSystem({
            schema: {
                throttle: {
                    kind: 'axis',
                    processors: [{ type: 'curve', exponent: 2 }],
                },
                look: {
                    kind: 'vector2',
                    processors: [{ type: 'clamp-magnitude', max: 1 }],
                },
            },
            contexts: [
                {
                    id: 'gameplay',
                    bindings: {
                        throttle: [
                            {
                                type: 'control',
                                control: 'gamepad/0/axis/0',
                                processors: [{ type: 'invert' }],
                            },
                        ],
                        look: [
                            {
                                type: 'dual-axis',
                                x: 'mouse/move/x',
                                y: 'mouse/move/y',
                                processors: [{ type: 'scale-vector2', x: 2, y: 0.5 }],
                            },
                        ],
                    },
                },
            ],
        });

        input.dispatch({
            type: 'gamepad',
            gamepads: [
                {
                    index: 0,
                    connected: true,
                    buttons: [],
                    axes: [0.5],
                },
            ],
        });
        input.dispatch({
            type: 'mouse-move',
            x: 1,
            y: 4,
            deltaX: 1,
            deltaY: 4,
        });
        input.update(1);

        expect(input.read('throttle')).toBeCloseTo(-0.25, 6);
        const look = input.read('look');
        expect(look.x).toBeCloseTo(Math.SQRT1_2, 6);
        expect(look.y).toBeCloseTo(Math.SQRT1_2, 6);
    });

    it('tracks hold repeat tap and multi-tap interaction states', () => {
        const input = createInputSystem({
            schema: {
                charge: {
                    kind: 'button',
                    interactions: [
                        { type: 'hold', durationMs: 30 },
                        { type: 'repeat', delayMs: 20, intervalMs: 10 },
                    ],
                },
                dash: {
                    kind: 'button',
                    interactions: [
                        { type: 'tap', maxDurationMs: 40 },
                        { type: 'multi-tap', tapCount: 2, maxDelayMs: 80, maxDurationMs: 40 },
                    ],
                },
            },
            contexts: [
                {
                    id: 'gameplay',
                    bindings: {
                        charge: [{ type: 'control', control: 'keyboard/KeyQ' }],
                        dash: [{ type: 'control', control: 'keyboard/KeyE' }],
                    },
                },
            ],
        });

        input.dispatch({
            type: 'keyboard',
            code: 'KeyQ',
            pressed: true,
        });
        input.update(0);

        let charge = input.state('charge');
        expect(charge.pressed).toBe(true);
        expect(charge.holdTriggered).toBe(false);
        expect(charge.repeatTriggered).toBe(false);

        input.update(20);
        charge = input.state('charge');
        expect(charge.repeatTriggered).toBe(true);
        expect(charge.repeatCount).toBe(1);
        expect(charge.holdTriggered).toBe(false);

        input.update(30);
        charge = input.state('charge');
        expect(charge.holdTriggered).toBe(true);
        expect(charge.heldDurationMs).toBe(30);
        expect(charge.repeatTriggered).toBe(true);
        expect(charge.repeatCount).toBe(2);

        input.update(40);
        charge = input.state('charge');
        expect(charge.holdTriggered).toBe(false);
        expect(charge.repeatTriggered).toBe(true);
        expect(charge.repeatCount).toBe(3);

        input.dispatch({
            type: 'keyboard',
            code: 'KeyQ',
            pressed: false,
        });
        input.update(50);

        charge = input.state('charge');
        expect(charge.released).toBe(true);
        expect(charge.heldDurationMs).toBe(50);
        expect(charge.repeatCount).toBe(3);

        input.dispatch({
            type: 'keyboard',
            code: 'KeyE',
            pressed: true,
        });
        input.update(60);

        input.dispatch({
            type: 'keyboard',
            code: 'KeyE',
            pressed: false,
        });
        input.update(80);

        let dash = input.state('dash');
        expect(dash.tapTriggered).toBe(true);
        expect(dash.multiTapTriggered).toBe(false);
        expect(dash.tapSequenceCount).toBe(1);

        input.dispatch({
            type: 'keyboard',
            code: 'KeyE',
            pressed: true,
        });
        input.update(100);

        input.dispatch({
            type: 'keyboard',
            code: 'KeyE',
            pressed: false,
        });
        input.update(120);

        dash = input.state('dash');
        expect(dash.tapTriggered).toBe(true);
        expect(dash.multiTapTriggered).toBe(true);
        expect(dash.tapSequenceCount).toBe(2);

        input.update(121);
        expect(input.state('dash').tapSequenceCount).toBe(0);
    });

    it('emits action lifecycle events with stable button snapshots', () => {
        const input = createInputSystem({
            schema: {
                jump: {
                    kind: 'button',
                    interactions: [{ type: 'tap', maxDurationMs: 40 }],
                },
            },
            contexts: [
                {
                    id: 'gameplay',
                    bindings: {
                        jump: [{ type: 'control', control: 'keyboard/Space' }],
                    },
                },
            ],
        });
        const phases: string[] = [];
        const snapshots: boolean[] = [];
        const subscription = input.subscribeAction('jump', (event) => {
            phases.push(`${event.phase}:${event.trigger}`);
            snapshots.push(event.state.value);
            expect(Object.isFrozen(event)).toBe(true);
            expect(Object.isFrozen(event.state)).toBe(true);
        });

        expect(input.events.listenerCountAll()).toBe(1);

        input.dispatch({
            type: 'keyboard',
            code: 'Space',
            pressed: true,
        });
        input.update(0);

        input.dispatch({
            type: 'keyboard',
            code: 'Space',
            pressed: false,
        });
        input.update(20);

        expect(phases).toEqual([
            'started:press',
            'performed:press',
            'changed:change',
            'performed:tap',
            'changed:change',
            'canceled:release',
        ]);
        expect(snapshots).toEqual([true, true, true, false, false, false]);

        subscription.dispose();
        expect(subscription.isDisposed).toBe(true);
        expect(input.events.listenerCountAll()).toBe(0);

        input.dispatch({
            type: 'keyboard',
            code: 'Space',
            pressed: true,
        });
        input.update(40);

        expect(phases).toHaveLength(6);
    });

    it('exposes action channels through the shared core event emitter', () => {
        const input = createInputSystem({
            schema: {
                jump: {
                    kind: 'button',
                    interactions: [{ type: 'tap', maxDurationMs: 40 }],
                },
            },
            contexts: [
                {
                    id: 'gameplay',
                    bindings: {
                        jump: [{ type: 'control', control: 'keyboard/Space' }],
                    },
                },
            ],
        });
        const allEvents: string[] = [];
        const actionEvents: string[] = [];
        const performedEvents: string[] = [];
        const unsubscribeAll = input.events.on('action:*', (event) => {
            allEvents.push(`${event.action}:${event.phase}`);
        });
        const unsubscribeAction = input.events.on('action:jump', (event) => {
            actionEvents.push(event.trigger);
        });
        const unsubscribePerformed = input.events.on('phase:performed', (event) => {
            performedEvents.push(`${event.action}:${event.trigger}`);
        });

        expect(input.events.listenerCountAll()).toBe(3);

        input.dispatch({
            type: 'keyboard',
            code: 'Space',
            pressed: true,
        });
        input.update(0);

        input.dispatch({
            type: 'keyboard',
            code: 'Space',
            pressed: false,
        });
        input.update(20);

        expect(allEvents).toEqual([
            'jump:started',
            'jump:performed',
            'jump:changed',
            'jump:performed',
            'jump:changed',
            'jump:canceled',
        ]);
        expect(actionEvents).toEqual(['press', 'press', 'change', 'tap', 'change', 'release']);
        expect(performedEvents).toEqual(['jump:press', 'jump:tap']);

        expect(unsubscribeAll()).toBe(true);
        expect(unsubscribeAction()).toBe(true);
        expect(unsubscribePerformed()).toBe(true);
        expect(input.events.listenerCountAll()).toBe(0);
    });

    it('supports phase-filtered global subscriptions for analog actions', () => {
        const input = createInputSystem({
            schema: {
                moveX: { kind: 'axis' },
            },
            contexts: [
                {
                    id: 'gameplay',
                    bindings: {
                        moveX: [{ type: 'control', control: 'gamepad/0/axis/0' }],
                    },
                },
            ],
        });
        const phases: string[] = [];

        input.subscribe(
            (event) => {
                phases.push(`${event.phase}:${event.trigger}:${event.kind}`);
            },
            {
                phases: ['started', 'canceled'],
            }
        );

        input.dispatch({
            type: 'gamepad',
            gamepads: [
                {
                    index: 0,
                    connected: true,
                    buttons: [],
                    axes: [0.5],
                },
            ],
        });
        input.update(0);

        input.dispatch({
            type: 'gamepad',
            gamepads: [
                {
                    index: 0,
                    connected: true,
                    buttons: [],
                    axes: [0],
                },
            ],
        });
        input.update(10);

        expect(phases).toEqual(['started:activate:axis', 'canceled:deactivate:axis']);
    });

    it('rebinding updates bindings and survives snapshot restore', () => {
        const input = createInputSystem({
            schema: {
                jump: { kind: 'button' },
            },
            contexts: [
                {
                    id: 'gameplay',
                    bindings: {
                        jump: [{ type: 'control', control: 'keyboard/Space' }],
                    },
                },
            ],
        });

        input.beginRebinding({
            context: 'gameplay',
            action: 'jump',
            index: 0,
        });

        input.dispatch({
            type: 'keyboard',
            code: 'KeyF',
            pressed: true,
        });
        input.update(1);

        expect(input.bindings('gameplay', 'jump')).toEqual([
            expect.objectContaining({
                type: 'control',
                control: 'keyboard/KeyF',
            }),
        ]);
        expect(input.read('jump')).toBe(true);

        const snapshot = input.snapshot();
        const restored = createInputSystem({
            schema: {
                jump: { kind: 'button' },
            },
            contexts: [
                {
                    id: 'gameplay',
                    bindings: {
                        jump: [{ type: 'control', control: 'keyboard/Space' }],
                    },
                },
            ],
        });

        restored.restore(snapshot);
        restored.dispatch({
            type: 'keyboard',
            code: 'KeyF',
            pressed: true,
        });
        restored.update(2);

        expect(restored.read('jump')).toBe(true);
        expect(restored.bindings('gameplay', 'jump')).toEqual([
            expect.objectContaining({
                type: 'control',
                control: 'keyboard/KeyF',
            }),
        ]);
    });

    it('restores user ownership snapshots alongside contexts', () => {
        const input = createInputSystem({
            schema: {
                fire: { kind: 'button' },
            },
            users: [
                {
                    id: 'player-1',
                    devices: [{ device: 'gamepad', index: 0 }],
                },
            ],
            contexts: [
                {
                    id: 'player-1-gameplay',
                    user: 'player-1',
                    bindings: {
                        fire: [{ type: 'control', control: 'gamepad/any/south' }],
                    },
                },
            ],
        });
        const snapshot = input.snapshot();

        const restored = createInputSystem({
            schema: {
                fire: { kind: 'button' },
            },
        });
        restored.restore(snapshot);
        restored.dispatch({
            type: 'gamepad',
            gamepads: [
                {
                    index: 0,
                    connected: true,
                    buttons: [1],
                    axes: [],
                },
            ],
        });
        restored.update(1);

        expect(restored.read('fire')).toBe(true);
        expect(restored.context('player-1-gameplay')).toEqual(
            expect.objectContaining({
                user: 'player-1',
            })
        );
    });

    it('cancels rebinding timeouts without breaking the update loop', () => {
        const reasons: string[] = [];
        const input = createInputSystem({
            now: () => 0,
            schema: {
                jump: { kind: 'button' },
            },
            contexts: [
                {
                    id: 'gameplay',
                    bindings: {
                        jump: [{ type: 'control', control: 'keyboard/Space' }],
                    },
                },
            ],
        });

        input.beginRebinding(
            {
                context: 'gameplay',
                action: 'jump',
                index: 0,
                timeoutMs: 5,
            },
            {
                cancel(reason) {
                    reasons.push(reason);
                },
            }
        );

        expect(() => input.update(10)).not.toThrow();
        expect(reasons).toEqual(['timeout']);
    });

    it('resets gamepad state on focus loss', () => {
        const input = createInputSystem({
            schema: {
                move: { kind: 'vector2' },
                fire: { kind: 'button' },
            },
            contexts: [
                {
                    id: 'gameplay',
                    bindings: {
                        move: [{ type: 'dual-axis', x: 'gamepad/0/axis/0', y: 'gamepad/0/axis/1' }],
                        fire: [{ type: 'control', control: 'gamepad/0/button/0' }],
                    },
                },
            ],
        });

        input.dispatch({
            type: 'gamepad',
            gamepads: [
                {
                    index: 0,
                    connected: true,
                    buttons: [1],
                    axes: [0.75, -0.5],
                },
            ],
        });
        input.update(1);

        expect(input.read('fire')).toBe(true);
        expect(input.read('move')).toEqual({ x: 0.75, y: -0.5 });

        input.dispatch({
            type: 'focus',
            focused: false,
        });
        input.update(2);

        expect(input.read('fire')).toBe(false);
        expect(input.read('move')).toEqual({ x: 0, y: 0 });
    });

    it('does not misfire tap interactions when a context interrupts an active action', () => {
        const input = createInputSystem({
            schema: {
                interact: {
                    kind: 'button',
                    interactions: [{ type: 'tap', maxDurationMs: 80 }],
                },
            },
            contexts: [
                {
                    id: 'gameplay',
                    bindings: {
                        interact: [{ type: 'control', control: 'keyboard/KeyF' }],
                    },
                },
            ],
        });

        input.dispatch({
            type: 'keyboard',
            code: 'KeyF',
            pressed: true,
        });
        input.update(0);

        input.deactivateContext('gameplay');
        input.update(20);

        const state = input.state('interact');
        expect(state.released).toBe(true);
        expect(state.tapTriggered).toBe(false);
        expect(state.tapSequenceCount).toBe(0);
    });

    it('keeps public vector state views immutable', () => {
        const input = createInputSystem({
            schema: {
                look: { kind: 'vector2' },
            },
            contexts: [
                {
                    id: 'gameplay',
                    bindings: {
                        look: [{ type: 'dual-axis', x: 'mouse/move/x', y: 'mouse/move/y' }],
                    },
                },
            ],
        });

        input.dispatch({
            type: 'mouse-move',
            x: 4,
            y: 6,
            deltaX: 4,
            deltaY: 6,
        });
        input.update(1);

        const state = input.state('look');
        expect(Object.isFrozen(state)).toBe(true);
        expect(Object.isFrozen(state.value)).toBe(true);
        expect(() => {
            (state.value as { x: number }).x = 999;
        }).toThrow();
        expect(input.read('look')).toEqual({ x: 4, y: 6 });
    });

    it('throws on duplicate context registration and supports explicit upsert', () => {
        const input = createInputSystem({
            schema: {
                jump: { kind: 'button' },
            },
            contexts: [
                {
                    id: 'gameplay',
                    bindings: {
                        jump: [{ type: 'control', control: 'keyboard/Space' }],
                    },
                },
            ],
        });

        expect(() =>
            input.registerContext({
                id: 'gameplay',
                bindings: {
                    jump: [{ type: 'control', control: 'keyboard/KeyJ' }],
                },
            })
        ).toThrow(InputContextError);

        input.upsertContext({
            id: 'gameplay',
            bindings: {
                jump: [{ type: 'control', control: 'keyboard/KeyJ' }],
            },
        });

        input.dispatch({
            type: 'keyboard',
            code: 'KeyJ',
            pressed: true,
        });
        input.update(1);

        expect(input.read('jump')).toBe(true);
    });
});

