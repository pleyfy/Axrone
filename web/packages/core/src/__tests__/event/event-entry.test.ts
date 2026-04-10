import { describe, expect, it } from 'vitest';
import * as eventPackage from '@axrone/event';

describe('event entry', () => {
    it('surfaces emitter primitives without leaking observer or tween APIs', () => {
        expect(eventPackage.EventEmitter).toBeDefined();
        expect(eventPackage.createEmitter).toBeDefined();
        expect(eventPackage.createTypedEmitter).toBeDefined();
        expect(eventPackage.EventGroup).toBeDefined();
        expect(eventPackage.EventScheduler).toBeDefined();
        expect(eventPackage.EventUtils).toBeDefined();
        expect('Subject' in eventPackage).toBe(false);
        expect('BehaviorSubject' in eventPackage).toBe(false);
        expect('tween' in eventPackage).toBe(false);
    });
});