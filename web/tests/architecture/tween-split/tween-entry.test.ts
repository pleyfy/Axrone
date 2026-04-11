import { describe, expect, it } from 'vitest';
import * as tweenPackage from '@axrone/tween';

describe('tween entry', () => {
    it('surfaces tween orchestration primitives without leaking event or observer APIs', () => {
        expect(tweenPackage.tween).toBeDefined();
        expect(tweenPackage.to).toBeDefined();
        expect(tweenPackage.from).toBeDefined();
        expect(tweenPackage.fromTo).toBeDefined();
        expect(tweenPackage.TWEEN).toBeDefined();
        expect(tweenPackage.chain).toBeDefined();
        expect(tweenPackage.group).toBeDefined();
        expect(tweenPackage.timeline).toBeDefined();
        expect(tweenPackage.spring).toBeDefined();
        expect(tweenPackage.waitFor).toBeDefined();
        expect('EventEmitter' in tweenPackage).toBe(false);
        expect('Subject' in tweenPackage).toBe(false);
    });
});