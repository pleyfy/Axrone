import { describe, it, expect, beforeEach } from 'vitest';
import { ConstraintManager2D } from '@axrone/physics';
import { ConstraintType } from '@axrone/physics';

describe('ConstraintManager2D', () => {
    let manager: ConstraintManager2D;
    const bodyIdA = 1 as any;
    const bodyIdB = 2 as any;

    beforeEach(() => {
        manager = new ConstraintManager2D(64);
    });

    describe('Distance Constraints', () => {
        it('creates distance constraint', () => {
            const constraintId = manager.createDistanceConstraint({
                bodyIdA,
                bodyIdB,
                localAnchorA: { x: 0, y: 0 },
                localAnchorB: { x: 0, y: 0 },
                length: 5,
            });

            expect(manager.hasConstraint(constraintId)).toBe(true);
            expect(manager.constraintCount).toBe(1);
            expect(manager.getConstraintType(constraintId)).toBe(ConstraintType.Distance);
        });

        it('creates distance constraint with min/max length', () => {
            const constraintId = manager.createDistanceConstraint({
                bodyIdA,
                bodyIdB,
                localAnchorA: { x: 0, y: 0 },
                localAnchorB: { x: 0, y: 0 },
                length: 5,
                minLength: 3,
                maxLength: 7,
            });

            expect(manager.hasConstraint(constraintId)).toBe(true);
        });

        it('creates distance constraint with stiffness and damping', () => {
            const constraintId = manager.createDistanceConstraint({
                bodyIdA,
                bodyIdB,
                localAnchorA: { x: 0, y: 0 },
                localAnchorB: { x: 0, y: 0 },
                length: 5,
                stiffness: 0.8,
                damping: 0.1,
            });

            expect(manager.hasConstraint(constraintId)).toBe(true);
        });
    });

    describe('Revolute Constraints', () => {
        it('creates revolute constraint', () => {
            const constraintId = manager.createRevoluteConstraint({
                bodyIdA,
                bodyIdB,
                localAnchorA: { x: 0, y: 0 },
                localAnchorB: { x: 0, y: 0 },
            });

            expect(manager.getConstraintType(constraintId)).toBe(ConstraintType.Revolute);
        });

        it('creates revolute constraint with limits', () => {
            const constraintId = manager.createRevoluteConstraint({
                bodyIdA,
                bodyIdB,
                localAnchorA: { x: 0, y: 0 },
                localAnchorB: { x: 0, y: 0 },
                enableLimit: true,
                lowerAngle: -Math.PI / 2,
                upperAngle: Math.PI / 2,
            });

            expect(manager.hasConstraint(constraintId)).toBe(true);
        });

        it('creates revolute constraint with motor', () => {
            const constraintId = manager.createRevoluteConstraint({
                bodyIdA,
                bodyIdB,
                localAnchorA: { x: 0, y: 0 },
                localAnchorB: { x: 0, y: 0 },
                enableMotor: true,
                motorSpeed: 1.0,
                maxMotorTorque: 100 as any,
            });

            expect(manager.hasConstraint(constraintId)).toBe(true);
        });
    });

    describe('Prismatic Constraints', () => {
        it('creates prismatic constraint', () => {
            const constraintId = manager.createPrismaticConstraint({
                bodyIdA,
                bodyIdB,
                localAnchorA: { x: 0, y: 0 },
                localAnchorB: { x: 0, y: 0 },
                localAxisA: { x: 1, y: 0 },
            });

            expect(manager.getConstraintType(constraintId)).toBe(ConstraintType.Prismatic);
        });

        it('creates prismatic constraint with limits', () => {
            const constraintId = manager.createPrismaticConstraint({
                bodyIdA,
                bodyIdB,
                localAnchorA: { x: 0, y: 0 },
                localAnchorB: { x: 0, y: 0 },
                localAxisA: { x: 1, y: 0 },
                enableLimit: true,
                lowerTranslation: -2,
                upperTranslation: 2,
            });

            expect(manager.hasConstraint(constraintId)).toBe(true);
        });

        it('creates prismatic constraint with motor', () => {
            const constraintId = manager.createPrismaticConstraint({
                bodyIdA,
                bodyIdB,
                localAnchorA: { x: 0, y: 0 },
                localAnchorB: { x: 0, y: 0 },
                localAxisA: { x: 1, y: 0 },
                enableMotor: true,
                motorSpeed: 1.0,
                maxMotorForce: 100 as any,
            });

            expect(manager.hasConstraint(constraintId)).toBe(true);
        });
    });

    describe('Weld Constraints', () => {
        it('creates weld constraint', () => {
            const constraintId = manager.createWeldConstraint({
                bodyIdA,
                bodyIdB,
                localAnchorA: { x: 0, y: 0 },
                localAnchorB: { x: 0, y: 0 },
            });

            expect(manager.getConstraintType(constraintId)).toBe(ConstraintType.Weld);
        });

        it('creates weld constraint with stiffness', () => {
            const constraintId = manager.createWeldConstraint({
                bodyIdA,
                bodyIdB,
                localAnchorA: { x: 0, y: 0 },
                localAnchorB: { x: 0, y: 0 },
                stiffness: 0.9,
                damping: 0.1,
            });

            expect(manager.hasConstraint(constraintId)).toBe(true);
        });
    });

    describe('Motor Constraints', () => {
        it('creates motor constraint', () => {
            const constraintId = manager.createMotorConstraint({
                bodyIdA,
                bodyIdB,
                linearOffset: { x: 1, y: 0 },
            });

            expect(manager.getConstraintType(constraintId)).toBe(ConstraintType.Motor);
        });

        it('creates motor constraint with torque', () => {
            const constraintId = manager.createMotorConstraint({
                bodyIdA,
                bodyIdB,
                linearOffset: { x: 1, y: 0 },
                angularOffset: 0.5,
                maxForce: 50 as any,
                maxTorque: 20 as any,
            });

            expect(manager.hasConstraint(constraintId)).toBe(true);
        });
    });

    describe('Mouse Constraints', () => {
        it('creates mouse constraint', () => {
            const constraintId = manager.createMouseConstraint({
                bodyIdA,
                bodyIdB,
                target: { x: 5, y: 5 },
            });

            expect(manager.getConstraintType(constraintId)).toBe(ConstraintType.Mouse);
        });

        it('creates mouse constraint with force', () => {
            const constraintId = manager.createMouseConstraint({
                bodyIdA,
                bodyIdB,
                target: { x: 5, y: 5 },
                maxForce: 1000 as any,
                stiffness: 5,
                damping: 0.7,
            });

            expect(manager.hasConstraint(constraintId)).toBe(true);
        });
    });

    describe('Constraint Destruction', () => {
        it('destroys constraint', () => {
            const constraintId = manager.createDistanceConstraint({
                bodyIdA,
                bodyIdB,
                localAnchorA: { x: 0, y: 0 },
                localAnchorB: { x: 0, y: 0 },
                length: 5,
            });

            expect(manager.constraintCount).toBe(1);
            manager.destroyConstraint(constraintId);
            expect(manager.constraintCount).toBe(0);
            expect(manager.hasConstraint(constraintId)).toBe(false);
        });

        it('throws on destroying non-existent constraint', () => {
            expect(() => {
                manager.destroyConstraint(9999 as any);
            }).toThrow();
        });
    });

    describe('Constraint Enable/Disable', () => {
        it('gets enabled state', () => {
            const constraintId = manager.createDistanceConstraint({
                bodyIdA,
                bodyIdB,
                localAnchorA: { x: 0, y: 0 },
                localAnchorB: { x: 0, y: 0 },
                length: 5,
            });

            expect(manager.isEnabled(constraintId)).toBe(true);
        });

        it('disables constraint', () => {
            const constraintId = manager.createDistanceConstraint({
                bodyIdA,
                bodyIdB,
                localAnchorA: { x: 0, y: 0 },
                localAnchorB: { x: 0, y: 0 },
                length: 5,
            });

            manager.setEnabled(constraintId, false);
            expect(manager.isEnabled(constraintId)).toBe(false);
        });

        it('enables constraint', () => {
            const constraintId = manager.createDistanceConstraint({
                bodyIdA,
                bodyIdB,
                localAnchorA: { x: 0, y: 0 },
                localAnchorB: { x: 0, y: 0 },
                length: 5,
            });

            manager.setEnabled(constraintId, false);
            manager.setEnabled(constraintId, true);
            expect(manager.isEnabled(constraintId)).toBe(true);
        });
    });

    describe('Body Constraint Queries', () => {
        it('gets constraints for body', () => {
            const id1 = manager.createDistanceConstraint({
                bodyIdA,
                bodyIdB,
                localAnchorA: { x: 0, y: 0 },
                localAnchorB: { x: 0, y: 0 },
                length: 5,
            });

            const id2 = manager.createRevoluteConstraint({
                bodyIdA,
                bodyIdB: 3 as any,
                localAnchorA: { x: 0, y: 0 },
                localAnchorB: { x: 0, y: 0 },
            });

            const constraints = manager.getConstraintsForBody(bodyIdA);
            expect(constraints).toHaveLength(2);
            expect(constraints).toContain(id1);
            expect(constraints).toContain(id2);
        });

        it('returns empty for body with no constraints', () => {
            const constraints = manager.getConstraintsForBody(999 as any);
            expect(constraints).toHaveLength(0);
        });
    });

    describe('Capacity Management', () => {
        it('throws when capacity exceeded', () => {
            const smallManager = new ConstraintManager2D(2);
            smallManager.createDistanceConstraint({
                bodyIdA,
                bodyIdB,
                localAnchorA: { x: 0, y: 0 },
                localAnchorB: { x: 0, y: 0 },
                length: 5,
            });
            smallManager.createRevoluteConstraint({
                bodyIdA,
                bodyIdB,
                localAnchorA: { x: 0, y: 0 },
                localAnchorB: { x: 0, y: 0 },
            });

            expect(() => {
                smallManager.createWeldConstraint({
                    bodyIdA,
                    bodyIdB,
                    localAnchorA: { x: 0, y: 0 },
                    localAnchorB: { x: 0, y: 0 },
                });
            }).toThrow();
        });
    });

    describe('Disposal', () => {
        it('disposes manager', () => {
            manager[Symbol.dispose]();
        });

        it('throws when using after disposal', () => {
            manager[Symbol.dispose]();
            expect(() => {
                manager.createDistanceConstraint({
                    bodyIdA,
                    bodyIdB,
                    localAnchorA: { x: 0, y: 0 },
                    localAnchorB: { x: 0, y: 0 },
                    length: 5,
                });
            }).toThrow();
        });
    });

    describe('Edge Cases', () => {
        it('handles many constraints', () => {
            for (let i = 0; i < 30; i++) {
                manager.createDistanceConstraint({
                    bodyIdA: (i + 1) as any,
                    bodyIdB: (i + 2) as any,
                    localAnchorA: { x: 0, y: 0 },
                    localAnchorB: { x: 0, y: 0 },
                    length: 5,
                });
            }
            expect(manager.constraintCount).toBe(30);
        });

        it('handles constraint creation and destruction cycle', () => {
            for (let i = 0; i < 20; i++) {
                const id = manager.createDistanceConstraint({
                    bodyIdA,
                    bodyIdB,
                    localAnchorA: { x: 0, y: 0 },
                    localAnchorB: { x: 0, y: 0 },
                    length: 5,
                });
                manager.destroyConstraint(id);
            }
            expect(manager.constraintCount).toBe(0);
        });
    });
});

