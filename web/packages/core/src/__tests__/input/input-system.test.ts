import { describe, expect, it } from 'vitest';
import { createInputSystem, InputContextError } from '../../input';

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
