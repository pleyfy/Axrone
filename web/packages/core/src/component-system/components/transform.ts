import { Component } from '../core/component';
import { script } from '../decorators/script';
import { Mat4, Vec3, Quat } from '@axrone/numeric';
import type { Entity } from '../types/core';
import type { Actor } from '../core/actor';

@script({
    scriptName: 'Transform',
    priority: 1000,
    description: 'Core transform component for position, rotation, and scale',
    version: '1.0.0',
    author: 'Component System Team',
    tags: ['core', 'transform', 'hierarchy'],
    singleton: false,
    executeInEditMode: true,
    validateDependencies: true,
    enableMetrics: true,
    enableCaching: true,
})
export class Transform extends Component {
    private _position: Vec3 = Vec3.ZERO.clone();
    private _rotation: Quat = Quat.IDENTITY.clone();
    private _scale: Vec3 = Vec3.ONE.clone();

    private _parent?: Transform;
    private readonly _children = new Map<Entity, Transform>();
    private readonly _childrenArray: Transform[] = [];
    private _childrenDirty = false;

    private _localMatrix?: Mat4;
    private _worldMatrix?: Mat4;
    private _localDirty = true;
    private _worldDirty = true;

    private static readonly _tempVec3 = new Vec3();
    private static readonly _tempQuat = new Quat();
    private static readonly _tempMat4 = new Mat4();

    private _worldPosition?: Vec3;
    private _worldRotation?: Quat;
    private _worldScale?: Vec3;

    get position(): Vec3 {
        return this._position;
    }

    set position(value: Vec3) {
        if (!this._position.equals(value)) {
            this._position.x = value.x;
            this._position.y = value.y;
            this._position.z = value.z;
            this.markLocalDirty();
        }
    }

    get rotation(): Quat {
        return this._rotation;
    }

    set rotation(value: Quat) {
        if (!this._rotation.equals(value)) {
            this._rotation.x = value.x;
            this._rotation.y = value.y;
            this._rotation.z = value.z;
            this._rotation.w = value.w;
            this.markLocalDirty();
        }
    }

    get scale(): Vec3 {
        return this._scale;
    }

    set scale(value: Vec3) {
        if (!this._scale.equals(value)) {
            this._scale.x = value.x;
            this._scale.y = value.y;
            this._scale.z = value.z;
            this.markLocalDirty();
        }
    }

    get parent(): Transform | undefined {
        return this._parent;
    }

    set parent(value: Transform | undefined) {
        if (this._parent === value) return;

        if (this._parent) {
            this._parent.removeChild(this);
        }

        this._parent = value;

        if (value) {
            value.addChild(this);
        }

        this.markWorldDirty();
    }

    get children(): readonly Transform[] {
        if (this._childrenDirty) {
            this.updateChildrenArray();
        }
        return this._childrenArray;
    }

    get childCount(): number {
        return this._children.size;
    }

    get worldPosition(): Vec3 {
        if (this._worldDirty || !this._worldPosition) {
            this.updateWorldPosition();
        }
        return this._worldPosition!;
    }

    get worldRotation(): Quat {
        if (this._worldDirty || !this._worldRotation) {
            this.updateWorldRotation();
        }
        return this._worldRotation!;
    }

    get worldScale(): Vec3 {
        if (this._worldDirty || !this._worldScale) {
            this.updateWorldScale();
        }
        return this._worldScale!;
    }

    get localMatrix(): Mat4 {
        if (this._localDirty || !this._localMatrix) {
            this.updateLocalMatrix();
        }
        return this._localMatrix!;
    }

    get worldMatrix(): Mat4 {
        if (this._worldDirty || !this._worldMatrix) {
            this.updateWorldMatrix();
        }
        return this._worldMatrix!;
    }

    private addChild(child: Transform): void {
        if (!child.entity) return;

        this._children.set(child.entity, child);
        this._childrenDirty = true;

        if (this.world) {
            this.world.emitSync('TransformHierarchyChanged' as any, {
                entity: child.entity!,
                component: child,
                actor: child.actor!,
            });
        }
    }

    private removeChild(child: Transform): void {
        if (!child.entity) return;

        if (this._children.delete(child.entity)) {
            this._childrenDirty = true;

            if (this.world) {
                this.world.emitSync('TransformHierarchyChanged' as any, {
                    entity: child.entity!,
                    component: child,
                    actor: child.actor!,
                });
            }
        }
    }

    private updateChildrenArray(): void {
        this._childrenArray.length = 0;
        this._childrenArray.push(...this._children.values());
        this._childrenDirty = false;
    }

    private markLocalDirty(): void {
        this._localDirty = true;
        this.markWorldDirty();
    }

    private markWorldDirty(): void {
        if (this._worldDirty) return;

        this._worldDirty = true;
        this._worldPosition = undefined;
        this._worldRotation = undefined;
        this._worldScale = undefined;

        for (const child of this._children.values()) {
            child.markWorldDirty();
        }
    }

    private updateLocalMatrix(): void {
        if (!this._localMatrix) {
            this._localMatrix = new Mat4();
        }

        this._localMatrix = Mat4.fromTRS(
            this._position,
            this._rotation,
            this._scale,
            this._localMatrix
        );

        this._localDirty = false;
    }

    private updateWorldMatrix(): void {
        if (!this._worldMatrix) {
            this._worldMatrix = new Mat4();
        }

        const localMatrix = this.localMatrix;

        if (this._parent) {
            const parentWorldMatrix = this._parent.worldMatrix;
            this._worldMatrix = Mat4.multiply(parentWorldMatrix, localMatrix);
        } else {
            this._worldMatrix = localMatrix.clone();
        }

        this._worldDirty = false;
    }

    private updateWorldPosition(): void {
        if (!this._worldPosition) {
            this._worldPosition = new Vec3();
        }

        if (this._parent) {
            const parentWorldPos = this._parent.worldPosition;
            this._worldPosition = Vec3.add(parentWorldPos, this._position, this._worldPosition);
        } else {
            this._worldPosition.x = this._position.x;
            this._worldPosition.y = this._position.y;
            this._worldPosition.z = this._position.z;
        }
    }

    private updateWorldRotation(): void {
        if (!this._worldRotation) {
            this._worldRotation = new Quat();
        }

        if (this._parent) {
            this._worldRotation = Quat.multiply(
                this._parent.worldRotation,
                this._rotation,
                this._worldRotation
            );
        } else {
            this._worldRotation.x = this._rotation.x;
            this._worldRotation.y = this._rotation.y;
            this._worldRotation.z = this._rotation.z;
            this._worldRotation.w = this._rotation.w;
        }
    }

    private updateWorldScale(): void {
        if (!this._worldScale) {
            this._worldScale = new Vec3();
        }

        if (this._parent) {
            this._worldScale = Vec3.multiply(
                this._parent.worldScale,
                this._scale,
                this._worldScale
            );
        } else {
            this._worldScale.x = this._scale.x;
            this._worldScale.y = this._scale.y;
            this._worldScale.z = this._scale.z;
        }
    }

    translate(translation: Vec3, space: 'local' | 'world' = 'local'): void {
        if (space === 'local') {
            this._position.add(translation);
        } else {
            if (this._parent) {
                const localTranslation = translation.clone();
                this._position.add(localTranslation);
            } else {
                this._position.add(translation);
            }
        }
        this.markLocalDirty();
    }

    rotateEuler(x: number, y: number, z: number, space: 'local' | 'world' = 'local'): void {
        const eulerRotation = Quat.fromEuler(x, y, z, Transform._tempQuat);
        this.rotate(eulerRotation, space);
    }

    rotateAroundAxis(axis: Vec3, angle: number, space: 'local' | 'world' = 'local'): void {
        const axisRotation = Quat.fromAxisAngle(axis, angle, Transform._tempQuat);
        this.rotate(axisRotation, space);
    }

    rotate(rotation: Quat, space: 'local' | 'world' = 'local'): void {
        if (space === 'local') {
            this._rotation = Quat.multiply(this._rotation, rotation, this._rotation);
        } else {
            if (this._parent) {
                const parentWorldRotation = this._parent.worldRotation;
                const parentInverse = parentWorldRotation.clone().inverse();
                const localRotation = Quat.multiply(parentInverse, rotation, Transform._tempQuat);
                this._rotation = Quat.multiply(localRotation, this._rotation, this._rotation);
            } else {
                this._rotation = Quat.multiply(this._rotation, rotation, this._rotation);
            }
        }
        this.markLocalDirty();
    }

    lookAt(target: Vec3, up: Vec3 = Vec3.UP): void {
        const worldPos = this.worldPosition;
        const direction = Vec3.subtract(target, worldPos, Transform._tempVec3);
        Vec3.normalize(direction, direction);

        const lookRotation = Quat.lookRotation(direction, up, Transform._tempQuat);

        if (this._parent) {
            const parentWorldRotation = this._parent.worldRotation;
            const parentInverse = parentWorldRotation.clone().inverse();
            this._rotation = Quat.multiply(parentInverse, lookRotation, this._rotation);
        } else {
            this._rotation.x = lookRotation.x;
            this._rotation.y = lookRotation.y;
            this._rotation.z = lookRotation.z;
            this._rotation.w = lookRotation.w;
        }

        this.markLocalDirty();
    }

    findChild(name: string): Transform | undefined {
        for (const child of this._children.values()) {
            if (child.actor?.name === name) {
                return child;
            }
        }
        return undefined;
    }

    findChildByTag(tag: string): Transform | undefined {
        for (const child of this._children.values()) {
            if (child.actor?.tag === tag) {
                return child;
            }
        }
        return undefined;
    }

    findChildrenByTag(tag: string): Transform[] {
        const results: Transform[] = [];
        for (const child of this._children.values()) {
            if (child.actor?.tag === tag) {
                results.push(child);
            }
        }
        return results;
    }

    findChildWithComponent<T extends Component>(
        componentType: new (...args: any[]) => T
    ): Transform | undefined {
        for (const child of this._children.values()) {
            if (child.actor?.hasComponent(componentType)) {
                return child;
            }
        }
        return undefined;
    }

    findChildrenWithComponent<T extends Component>(
        componentType: new (...args: any[]) => T
    ): Transform[] {
        const results: Transform[] = [];
        for (const child of this._children.values()) {
            if (child.actor?.hasComponent(componentType)) {
                results.push(child);
            }
        }
        return results;
    }

    findInChildren(name: string): Transform | undefined {
        const queue: Transform[] = [this];

        while (queue.length > 0) {
            const current = queue.shift()!;

            if (current !== this && current.actor?.name === name) {
                return current;
            }

            queue.push(...current.children);
        }

        return undefined;
    }

    findInChildrenByTag(tag: string): Transform | undefined {
        const queue: Transform[] = [this];

        while (queue.length > 0) {
            const current = queue.shift()!;

            if (current !== this && current.actor?.tag === tag) {
                return current;
            }

            queue.push(...current.children);
        }

        return undefined;
    }

    getAllDescendants(): Transform[] {
        const descendants: Transform[] = [];
        const queue: Transform[] = [...this.children];

        while (queue.length > 0) {
            const current = queue.shift()!;
            descendants.push(current);
            queue.push(...current.children);
        }

        return descendants;
    }

    isAncestorOf(transform: Transform): boolean {
        let current = transform.parent;
        while (current) {
            if (current === this) return true;
            current = current.parent;
        }
        return false;
    }

    isDescendantOf(transform: Transform): boolean {
        return transform.isAncestorOf(this);
    }

    getRoot(): Transform {
        let root: Transform = this;
        while (root.parent) {
            root = root.parent;
        }
        return root;
    }

    getDepth(): number {
        let depth = 0;
        let current = this.parent;
        while (current) {
            depth++;
            current = current.parent;
        }
        return depth;
    }

    onDestroy(): void {
        if (this._parent) {
            this.parent = undefined;
        }

        this._children.clear();
        this._childrenArray.length = 0;

        this._localMatrix = undefined;
        this._worldMatrix = undefined;
        this._worldPosition = undefined;
        this._worldRotation = undefined;
        this._worldScale = undefined;
    }
}
