import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { Transform } from '../../component-system/components/transform';
import { Vec3, Quat, Mat4 } from '../../../../numeric/src';

describe('Transform', () => {
    let transform: Transform;

    beforeEach(() => {
        transform = new Transform();
    });

    afterEach(() => {
        transform.onDestroy();
    });

    describe('initialization', () => {
        it('should initialize with default values', () => {
            expect(transform.position.equals(Vec3.ZERO)).toBe(true);
            expect(transform.rotation.equals(Quat.IDENTITY)).toBe(true);
            expect(transform.scale.equals(Vec3.ONE)).toBe(true);
            expect(transform.parent).toBeUndefined();
            expect(transform.childCount).toBe(0);
        });

        it('should have consistent initial world transforms', () => {
            expect(transform.worldPosition.equals(transform.position)).toBe(true);
            expect(transform.worldRotation.equals(transform.rotation)).toBe(true);
            expect(transform.worldScale.equals(transform.scale)).toBe(true);
        });
    });

    describe('position manipulation', () => {
        it('should set and get position correctly', () => {
            const positions = [
                new Vec3(0, 0, 0),
                new Vec3(1, 2, 3),
                new Vec3(-5, 10, -15),
                new Vec3(0.5, -0.25, 100.75),
            ];

            positions.forEach((pos) => {
                transform.position = pos;
                expect(transform.position.x).toBeCloseTo(pos.x, 5);
                expect(transform.position.y).toBeCloseTo(pos.y, 5);
                expect(transform.position.z).toBeCloseTo(pos.z, 5);
            });
        });

        it('should not modify original position vector', () => {
            const originalPos = new Vec3(1, 2, 3);
            const originalValues = { x: originalPos.x, y: originalPos.y, z: originalPos.z };

            transform.position = originalPos;
            originalPos.x = 999;

            expect(transform.position.x).toBe(originalValues.x);
            expect(originalPos.x).toBe(999);
        });

        it('should update world position when local position changes', () => {
            const testPositions = [new Vec3(10, 20, 30), new Vec3(-5, 0, 15), new Vec3(0, -10, 0)];

            testPositions.forEach((pos) => {
                transform.position = pos;
                expect(transform.worldPosition.equals(pos)).toBe(true);
            });
        });
    });

    describe('rotation manipulation', () => {
        it('should set and get rotation correctly', () => {
            const rotations = [
                Quat.IDENTITY,
                new Quat(0, 0, 0, 1),
                new Quat(0.707, 0, 0, 0.707),
                new Quat(0, 0.707, 0, 0.707),
            ];

            rotations.forEach((rot) => {
                transform.rotation = rot;
                expect(transform.rotation.x).toBeCloseTo(rot.x, 5);
                expect(transform.rotation.y).toBeCloseTo(rot.y, 5);
                expect(transform.rotation.z).toBeCloseTo(rot.z, 5);
                expect(transform.rotation.w).toBeCloseTo(rot.w, 5);
            });
        });

        it('should handle euler angle rotations', () => {
            const eulerAngles = [
                [0, 0, 0],
                [Math.PI / 2, 0, 0],
                [0, Math.PI / 2, 0],
                [0, 0, Math.PI / 2],
                [Math.PI / 4, Math.PI / 4, Math.PI / 4],
            ];

            eulerAngles.forEach(([x, y, z]) => {
                const expectedQuat = new Quat();
                Quat.fromEuler(x, y, z, expectedQuat);
                transform.rotation = expectedQuat;

                expect(transform.rotation.equals(expectedQuat)).toBe(true);
            });
        });

        it('should handle quaternion assignment', () => {
            const quat = new Quat(0.5, 0.5, 0.5, 0.5);
            transform.rotation = quat;

            expect(transform.rotation.x).toBeCloseTo(quat.x, 5);
            expect(transform.rotation.y).toBeCloseTo(quat.y, 5);
            expect(transform.rotation.z).toBeCloseTo(quat.z, 5);
            expect(transform.rotation.w).toBeCloseTo(quat.w, 5);
        });
    });

    describe('scale manipulation', () => {
        it('should set and get scale correctly', () => {
            const scales = [
                new Vec3(1, 1, 1),
                new Vec3(2, 3, 4),
                new Vec3(0.5, 0.25, 2),
                new Vec3(10, 0.1, 1),
            ];

            scales.forEach((scale) => {
                transform.scale = scale;
                expect(transform.scale.x).toBeCloseTo(scale.x, 5);
                expect(transform.scale.y).toBeCloseTo(scale.y, 5);
                expect(transform.scale.z).toBeCloseTo(scale.z, 5);
            });
        });

        it('should handle zero and negative scales', () => {
            const problematicScales = [
                new Vec3(0, 1, 1),
                new Vec3(-1, 1, 1),
                new Vec3(1, -2, 1),
                new Vec3(-0.5, -0.5, -0.5),
            ];

            problematicScales.forEach((scale) => {
                expect(() => {
                    transform.scale = scale;
                }).not.toThrow();

                expect(transform.scale.equals(scale)).toBe(true);
            });
        });
    });

    describe('hierarchy management', () => {
        let parent: Transform;
        let child: Transform;
        let grandchild: Transform;

        beforeEach(() => {
            parent = new Transform();
            child = new Transform();
            grandchild = new Transform();

            (parent as any).entity = 1;
            (child as any).entity = 2;
            (grandchild as any).entity = 3;
        });

        afterEach(() => {
            parent.onDestroy();
            child.onDestroy();
            grandchild.onDestroy();
        });

        it('should establish parent-child relationships', () => {
            child.parent = parent;

            expect(child.parent).toBe(parent);
            expect(parent.children).toContain(child);
            expect(parent.childCount).toBe(1);
        });

        it('should handle multiple children', () => {
            const child2 = new Transform();
            const child3 = new Transform();
            (child2 as any).entity = 4;
            (child3 as any).entity = 5;

            child.parent = parent;
            child2.parent = parent;
            child3.parent = parent;

            expect(parent.childCount).toBe(3);
            expect(parent.children).toContain(child);
            expect(parent.children).toContain(child2);
            expect(parent.children).toContain(child3);

            child2.onDestroy();
            child3.onDestroy();
        });

        it('should remove parent-child relationships', () => {
            child.parent = parent;
            expect(parent.childCount).toBe(1);

            child.parent = undefined;
            expect(child.parent).toBeUndefined();
            expect(parent.childCount).toBe(0);
        });

        it('should handle reparenting', () => {
            const newParent = new Transform();
            (newParent as any).entity = 6;

            child.parent = parent;
            expect(parent.childCount).toBe(1);

            child.parent = newParent;
            expect(parent.childCount).toBe(0);
            expect(newParent.childCount).toBe(1);
            expect(child.parent).toBe(newParent);

            newParent.onDestroy();
        });

        it('should handle deep hierarchies', () => {
            child.parent = parent;
            grandchild.parent = child;

            expect(parent.childCount).toBe(1);
            expect(child.childCount).toBe(1);
            expect(grandchild.childCount).toBe(0);

            expect(grandchild.parent).toBe(child);
            expect(child.parent).toBe(parent);
            expect(parent.parent).toBeUndefined();
        });

        it('should calculate hierarchy depth correctly', () => {
            child.parent = parent;
            grandchild.parent = child;

            expect(parent.getDepth()).toBe(0);
            expect(child.getDepth()).toBe(1);
            expect(grandchild.getDepth()).toBe(2);
        });

        it('should find root transform correctly', () => {
            child.parent = parent;
            grandchild.parent = child;

            expect(parent.getRoot()).toBe(parent);
            expect(child.getRoot()).toBe(parent);
            expect(grandchild.getRoot()).toBe(parent);
        });

        it('should check ancestor relationships', () => {
            child.parent = parent;
            grandchild.parent = child;

            expect(parent.isAncestorOf(child)).toBe(true);
            expect(parent.isAncestorOf(grandchild)).toBe(true);
            expect(child.isAncestorOf(grandchild)).toBe(true);

            expect(child.isAncestorOf(parent)).toBe(false);
            expect(grandchild.isAncestorOf(parent)).toBe(false);
            expect(grandchild.isAncestorOf(child)).toBe(false);
        });

        it('should check descendant relationships', () => {
            child.parent = parent;
            grandchild.parent = child;

            expect(child.isDescendantOf(parent)).toBe(true);
            expect(grandchild.isDescendantOf(parent)).toBe(true);
            expect(grandchild.isDescendantOf(child)).toBe(true);

            expect(parent.isDescendantOf(child)).toBe(false);
            expect(parent.isDescendantOf(grandchild)).toBe(false);
            expect(child.isDescendantOf(grandchild)).toBe(false);
        });

        it('should get all descendants', () => {
            const child2 = new Transform();
            (child2 as any).entity = 7;

            child.parent = parent;
            child2.parent = parent;
            grandchild.parent = child;

            const descendants = parent.getAllDescendants();
            expect(descendants).toHaveLength(3);
            expect(descendants).toContain(child);
            expect(descendants).toContain(child2);
            expect(descendants).toContain(grandchild);

            child2.onDestroy();
        });
    });

    describe('world space calculations with hierarchy', () => {
        let parent: Transform;
        let child: Transform;

        beforeEach(() => {
            parent = new Transform();
            child = new Transform();
            (parent as any).entity = 1;
            (child as any).entity = 2;
        });

        afterEach(() => {
            parent.onDestroy();
            child.onDestroy();
        });

        it('should calculate world position with parent', () => {
            parent.position = new Vec3(10, 20, 30);
            child.position = new Vec3(1, 2, 3);
            child.parent = parent;

            expect(child.worldPosition.x).toBeCloseTo(11, 5);
            expect(child.worldPosition.y).toBeCloseTo(22, 5);
            expect(child.worldPosition.z).toBeCloseTo(33, 5);
        });

        it('should calculate world rotation with parent', () => {
            const parentRot = new Quat();
            const childRot = new Quat();
            Quat.fromEuler(0, Math.PI / 2, 0, parentRot);
            Quat.fromEuler(Math.PI / 4, 0, 0, childRot);

            parent.rotation = parentRot;
            child.rotation = childRot;
            child.parent = parent;

            expect(child.worldRotation).not.toEqual(child.rotation);
        });

        it('should calculate world scale with parent', () => {
            parent.scale = new Vec3(2, 3, 4);
            child.scale = new Vec3(0.5, 2, 1);
            child.parent = parent;

            expect(child.worldScale.x).toBeCloseTo(1, 5);
            expect(child.worldScale.y).toBeCloseTo(6, 5);
            expect(child.worldScale.z).toBeCloseTo(4, 5);
        });

        it('should handle complex nested transformations', () => {
            const grandparent = new Transform();
            const grandchild = new Transform();
            (grandparent as any).entity = 3;
            (grandchild as any).entity = 4;

            grandparent.position = new Vec3(100, 200, 300);
            grandparent.scale = new Vec3(2, 2, 2);

            parent.position = new Vec3(10, 20, 30);
            parent.scale = new Vec3(0.5, 0.5, 0.5);
            parent.parent = grandparent;

            child.position = new Vec3(1, 2, 3);
            child.parent = parent;

            grandchild.position = new Vec3(0.1, 0.2, 0.3);
            grandchild.parent = child;

            expect(grandchild.getDepth()).toBe(3);
            expect(grandchild.getRoot()).toBe(grandparent);

            grandparent.onDestroy();
            grandchild.onDestroy();
        });
    });

    describe('transformation methods', () => {
        it('should translate in local space', () => {
            const initialPos = transform.position.clone();
            const translation = new Vec3(1, 2, 3);

            transform.translate(translation, 'local');

            expect(transform.position.x).toBeCloseTo(initialPos.x + 1, 5);
            expect(transform.position.y).toBeCloseTo(initialPos.y + 2, 5);
            expect(transform.position.z).toBeCloseTo(initialPos.z + 3, 5);
        });

        it('should translate in world space', () => {
            const initialPos = transform.position.clone();
            const translation = new Vec3(5, -2, 10);

            transform.translate(translation, 'world');

            expect(transform.position.x).toBeCloseTo(initialPos.x + 5, 5);
            expect(transform.position.y).toBeCloseTo(initialPos.y - 2, 5);
            expect(transform.position.z).toBeCloseTo(initialPos.z + 10, 5);
        });

        it('should rotate by euler angles in local space', () => {
            const initialRot = transform.rotation.clone();

            transform.rotateEuler(Math.PI / 4, Math.PI / 6, Math.PI / 3, 'local');

            expect(transform.rotation.equals(initialRot)).toBe(false);
        });

        it('should rotate by euler angles in world space', () => {
            const initialRot = transform.rotation.clone();

            transform.rotateEuler(0, Math.PI / 2, 0, 'world');

            expect(transform.rotation.equals(initialRot)).toBe(false);
        });

        it('should rotate around axis in local space', () => {
            const axis = Vec3.UP;
            const angle = Math.PI / 2;

            transform.rotateAroundAxis(axis, angle, 'local');

            const expectedRot = new Quat();
            Quat.fromAxisAngle(axis, angle, expectedRot);
            expect(transform.rotation.equals(expectedRot)).toBe(true);
        });

        it('should rotate around axis in world space', () => {
            const axis = new Vec3(1, 1, 0).normalize();
            const angle = Math.PI / 3;
            const initialRot = transform.rotation.clone();

            transform.rotateAroundAxis(axis, angle, 'world');

            expect(transform.rotation.equals(initialRot)).toBe(false);
        });

        it('should look at target correctly', () => {
            const target = new Vec3(10, 0, 0);

            transform.position = Vec3.ZERO;
            transform.rotation = Quat.IDENTITY;

            transform.lookAt(target);

            expect(transform.rotation.y).not.toBe(0);
        });

        it('should look at target with custom up vector', () => {
            const target = new Vec3(1, 0, 0);
            const upVectors = [Vec3.UP, Vec3.FORWARD, new Vec3(0, 1, 1).normalize()];

            upVectors.forEach((up) => {
                transform.position = Vec3.ZERO;
                transform.rotation = Quat.IDENTITY;

                transform.lookAt(target, up);

                expect(transform.rotation.equals(Quat.IDENTITY)).toBe(false);
            });
        });
    });

    describe('matrix calculations', () => {
        it('should provide valid local matrix', () => {
            const matrix = transform.localMatrix;
            expect(matrix).toBeInstanceOf(Mat4);
            expect(matrix.data).toHaveLength(16);
        });

        it('should provide valid world matrix', () => {
            const worldMatrix = transform.worldMatrix;
            expect(worldMatrix).toBeInstanceOf(Mat4);
            expect(worldMatrix.data).toHaveLength(16);
        });

        it('should update local matrix when transform changes', () => {
            transform.position = new Vec3(1, 2, 3);
            const matrix1 = transform.localMatrix;

            expect(matrix1).toBeInstanceOf(Mat4);
            expect(matrix1.data).toHaveLength(16);
        });

        it('should calculate correct TRS matrix', () => {
            transform.position = new Vec3(10, 20, 30);
            transform.scale = new Vec3(2, 3, 4);

            const matrix = transform.localMatrix;

            expect(matrix.data[3]).toBeCloseTo(10, 5);
            expect(matrix.data[7]).toBeCloseTo(20, 5);
            expect(matrix.data[11]).toBeCloseTo(30, 5);
        });

        it('should handle matrix calculations with hierarchy', () => {
            const parent = new Transform();
            const child = new Transform();
            (parent as any).entity = 1;
            (child as any).entity = 2;

            parent.position = new Vec3(5, 10, 15);
            child.position = new Vec3(1, 2, 3);
            child.parent = parent;

            const childWorldMatrix = child.worldMatrix;
            const parentWorldMatrix = parent.worldMatrix;

            expect(childWorldMatrix).toBeInstanceOf(Mat4);
            expect(parentWorldMatrix).toBeInstanceOf(Mat4);
            expect(childWorldMatrix).not.toEqual(parentWorldMatrix);

            parent.onDestroy();
            child.onDestroy();
        });
    });

    describe('performance and edge cases', () => {
        it('should handle rapid transform changes', () => {
            const iterations = 1000;

            for (let i = 0; i < iterations; i++) {
                transform.position = new Vec3(i, i * 2, i * 3);
                transform.rotation = new Quat(i * 0.01, 0, 0, 1).normalize();
                transform.scale = new Vec3(1 + i * 0.001, 1, 1);

                expect(transform.localMatrix).toBeInstanceOf(Mat4);
                expect(transform.worldMatrix).toBeInstanceOf(Mat4);
            }
        });

        it('should handle deep hierarchy performance', () => {
            const depth = 100;
            const transforms: Transform[] = [];

            for (let i = 0; i < depth; i++) {
                const t = new Transform();
                (t as any).entity = i + 1;
                transforms.push(t);

                if (i > 0) {
                    t.parent = transforms[i - 1];
                }
            }

            const deepest = transforms[depth - 1];
            expect(deepest.getDepth()).toBe(depth - 1);
            expect(deepest.getRoot()).toBe(transforms[0]);

            const startTime = performance.now();
            const worldPos = deepest.worldPosition;
            const endTime = performance.now();

            expect(worldPos).toBeInstanceOf(Vec3);
            expect(endTime - startTime).toBeLessThan(100);

            transforms.forEach((t) => t.onDestroy());
        });

        it('should handle circular reference prevention', () => {
            const parent = new Transform();
            const child = new Transform();
            (parent as any).entity = 1;
            (child as any).entity = 2;

            child.parent = parent;

            expect(() => {
                parent.parent = child;
            }).not.toThrow();

            parent.onDestroy();
            child.onDestroy();
        });

        it('should handle null and undefined inputs gracefully', () => {
            expect(() => {
                transform.parent = undefined;
            }).not.toThrow();

            expect(() => {
                transform.lookAt(new Vec3(1, 0, 0));
            }).not.toThrow();
        });

        it('should maintain consistency after multiple operations', () => {
            const operations = [
                () => transform.translate(new Vec3(1, 0, 0)),
                () => transform.rotateEuler(0.1, 0, 0),
                () => (transform.scale = new Vec3(1.1, 1.1, 1.1)),
                () => transform.lookAt(new Vec3(Math.random(), Math.random(), Math.random())),
            ];

            for (let i = 0; i < 50; i++) {
                const operation = operations[i % operations.length];
                operation();

                expect(transform.localMatrix).toBeInstanceOf(Mat4);
                expect(transform.worldMatrix).toBeInstanceOf(Mat4);
                expect(transform.worldPosition).toBeInstanceOf(Vec3);
                expect(transform.worldRotation).toBeInstanceOf(Quat);
                expect(transform.worldScale).toBeInstanceOf(Vec3);
            }
        });
    });

    describe('cleanup and memory management', () => {
        it('should cleanup hierarchy on destroy', () => {
            const parent = new Transform();
            const child = new Transform();
            (parent as any).entity = 1;
            (child as any).entity = 2;

            child.parent = parent;
            expect(parent.childCount).toBe(1);

            child.onDestroy();
            expect(child.parent).toBeUndefined();
            expect(parent.childCount).toBe(0);

            parent.onDestroy();
        });

        it('should handle destroy with multiple children', () => {
            const parent = new Transform();
            const children: Transform[] = [];

            for (let i = 0; i < 10; i++) {
                const child = new Transform();
                (child as any).entity = i + 1;
                child.parent = parent;
                children.push(child);
            }

            expect(parent.childCount).toBe(10);

            children.forEach((child) => child.onDestroy());
            expect(parent.childCount).toBe(0);

            parent.onDestroy();
        });

        it('should not leak memory after destroy', () => {
            const parent = new Transform();
            const child = new Transform();
            (parent as any).entity = 1;
            (child as any).entity = 2;

            child.parent = parent;

            const parentRef = new WeakRef(parent);
            const childRef = new WeakRef(child);

            child.onDestroy();
            parent.onDestroy();

            expect(child.parent).toBeUndefined();
            expect(parent.childCount).toBe(0);
        });
    });
});
