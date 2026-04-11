import { describe, expect, it } from 'vitest';
import * as observerPackage from '@axrone/observer';

describe('observer entry', () => {
    it('surfaces subject primitives without leaking event emitters or tween helpers', () => {
        expect(observerPackage.Subject).toBeDefined();
        expect(observerPackage.BehaviorSubject).toBeDefined();
        expect(observerPackage.ReplaySubject).toBeDefined();
        expect(observerPackage.AsyncSubject).toBeDefined();
        expect(observerPackage.createSubject).toBeDefined();
        expect(observerPackage.createBehaviorSubject).toBeDefined();
        expect(observerPackage.createReplaySubject).toBeDefined();
        expect(observerPackage.ObserverUtils).toBeDefined();
        expect('EventEmitter' in observerPackage).toBe(false);
        expect('tween' in observerPackage).toBe(false);
    });
});