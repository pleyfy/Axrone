import { describe, expect, it } from 'vitest';
import * as inputPackage from '@axrone/input';

describe('input entry', () => {
    it('surfaces input orchestration primitives without leaking unrelated package APIs', () => {
        expect(inputPackage.InputSystem).toBeDefined();
        expect(inputPackage.createInputSystem).toBeDefined();
        expect(inputPackage.parseInputControlPath).toBeDefined();
        expect(inputPackage.normalizeInputControlPath).toBeDefined();
        expect(inputPackage.InputContextError).toBeDefined();
        expect('EventEmitter' in inputPackage).toBe(false);
        expect('PhysicsWorld2D' in inputPackage).toBe(false);
    });
});