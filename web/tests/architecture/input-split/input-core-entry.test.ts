import { describe, expect, it } from 'vitest';
import * as inputCore from '@axrone/input-core';

describe('input-core entry', () => {
    it('exposes the input capability seam while keeping the public input facade intact', () => {
        expect(inputCore.INPUT_CORE_CAPABILITY_ID).toBe('input/core');
        expect(inputCore.getInputCoreCapability().ownerPackage).toBe('@axrone/input');
        expect(inputCore.InputSystem).toBeDefined();
        expect(inputCore.createInputSystem).toBeDefined();
        expect('EventEmitter' in inputCore).toBe(false);
    });
});