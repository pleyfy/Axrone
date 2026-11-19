import { describe, expect, it, vi } from 'vitest';
import { HingeJoint2D } from '../components/hinge-joint2d';
import { Rigidbody2D } from '../components/rigidbody2d';

describe('Joint2D lifecycle', () => {
    it('adds a hinge joint without a rigidbody instead of throwing', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const joint = new HingeJoint2D();
        (joint as unknown as { getComponent: () => undefined }).getComponent = () => undefined;

        expect(() => joint.onLoad()).not.toThrow();
        expect(joint.constraintId).toBeNull();
        expect(warn).toHaveBeenCalledTimes(1);

        warn.mockRestore();
    });

    it('binds the body when it appears after load', () => {
        const joint = new HingeJoint2D();
        let body: Rigidbody2D | undefined;
        (joint as unknown as { getComponent: () => Rigidbody2D | undefined }).getComponent = () => body;

        joint.onLoad();
        body = new Rigidbody2D();

        expect(() => joint.update()).not.toThrow();
        expect((joint as unknown as { _rigidbodyA: Rigidbody2D | null })._rigidbodyA).toBe(body);
    });
});
