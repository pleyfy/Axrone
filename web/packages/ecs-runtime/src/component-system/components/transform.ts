import { Component } from '../core/component';
import { script } from '../decorators/script';
import { Mat4, Vec3, Quat } from '@axrone/numeric';
import type { Hierarchy } from './hierarchy';
import type { ComponentType } from '../types/component';

const WORLD_TRANSLATION_EPSILON = 1e-8;

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

    private _detachedParent?: Transform;
    private readonly _detachedChildren = new Set<Transform>();
    private readonly _detachedChildrenArray: Transform[] = [];
    private _detachedChildrenDirty = false;

    private readonly _attachedChildrenArray: Transform[] = [];
    private _attachedHierarchyVersion = -1;

    private _localMatrix?: Mat4;
    private _worldMatrix?: Mat4;
    private _localDirty = true;
    private _worldDirty = true;

    private static readonly _tempVec3 = new Vec3();
    private static readonly _tempVec3B = new Vec3();
    private static readonly _tempQuat = new Quat();

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
        const hierarchy = this._getHierarchy();
        if (hierarchy) {
            return this._resolveTransformFromHierarchy(hierarchy.parent);
        }

        return this._detachedParent;
    }

    set parent(value: Transform | undefined) {
        const hierarchy = this._getHierarchy();

        if (hierarchy) {
            if (!value) {
                hierarchy.parent = undefined;
                return;
            }

            const parentHierarchy = value._getHierarchy();
            if (parentHierarchy) {
                hierarchy.parent = parentHierarchy;
            }

            return;
        }

        if (value?._getHierarchy()) {
            return;
        }

        this._setDetachedParent(value);
    }

    get children(): readonly Transform[] {
        const hierarchy = this._getHierarchy();

        if (hierarchy) {
            if (this._attachedHierarchyVersion !== hierarchy.version) {
                this._rebuildAttachedChildrenArray(hierarchy);
            }

            return this._attachedChildrenArray;
        }

        if (this._detachedChildrenDirty) {
            this._rebuildDetachedChildrenArray();
        }

        return this._detachedChildrenArray;
    }

    get childCount(): number {
        return this.children.length;
    }

    get worldPosition(): Vec3 {
        if (this._worldDirty || !this._worldPosition) {
            this.updateWorldState();
        }
        return this._worldPosition!;
    }

    get worldRotation(): Quat {
        if (this._worldDirty || !this._worldRotation) {
            this.updateWorldState();
        }
        return this._worldRotation!;
    }

    get worldScale(): Vec3 {
        if (this._worldDirty || !this._worldScale) {
            this.updateWorldState();
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
            this.updateWorldState();
        }
        return this._worldMatrix!;
    }

    markHierarchyDirty(): void {
        this._attachedHierarchyVersion = -1;
        this.markWorldDirty();
    }

    translate(translation: Vec3, space: 'local' | 'world' = 'local'): void {
        if (space === 'local') {
            this._position.add(translation);
            this.markLocalDirty();
            return;
        }

        const parent = this.parent;
        if (!parent) {
            this._position.add(translation);
            this.markLocalDirty();
            return;
        }

        const inverseParentRotation = parent.worldRotation.clone().inverse();
        const localDelta = inverseParentRotation.rotateVector(
            translation,
            Transform._tempVec3
        ) as Vec3;
        const parentScale = parent.worldScale;

        this._position.x +=
            Math.abs(parentScale.x) > WORLD_TRANSLATION_EPSILON
                ? localDelta.x / parentScale.x
                : 0;
        this._position.y +=
            Math.abs(parentScale.y) > WORLD_TRANSLATION_EPSILON
                ? localDelta.y / parentScale.y
                : 0;
        this._position.z +=
            Math.abs(parentScale.z) > WORLD_TRANSLATION_EPSILON
                ? localDelta.z / parentScale.z
                : 0;

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
            this.markLocalDirty();
            return;
        }

        const parent = this.parent;
        if (parent) {
            const parentInverse = parent.worldRotation.clone().inverse();
            const localRotation = Quat.multiply(parentInverse, rotation, Transform._tempQuat);
            this._rotation = Quat.multiply(localRotation, this._rotation, this._rotation);
        } else {
            this._rotation = Quat.multiply(this._rotation, rotation, this._rotation);
        }

        this.markLocalDirty();
    }

    lookAt(target: Vec3, up: Vec3 = Vec3.UP): void {
        const direction = Vec3.subtract(target, this.worldPosition, Transform._tempVec3);
        Vec3.normalize(direction, direction);

        const lookRotation = Quat.lookRotation(direction, up, Transform._tempQuat);
        const parent = this.parent;

        if (parent) {
            const parentInverse = parent.worldRotation.clone().inverse();
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
        for (const child of this.children) {
            if (child.actor?.name === name) {
                return child;
            }
        }

        return undefined;
    }

    findChildByTag(tag: string): Transform | undefined {
        for (const child of this.children) {
            if (child.actor?.tag === tag) {
                return child;
            }
        }

        return undefined;
    }

    findChildrenByTag(tag: string): Transform[] {
        const results: Transform[] = [];

        for (const child of this.children) {
            if (child.actor?.tag === tag) {
                results.push(child);
            }
        }

        return results;
    }

    findChildWithComponent<T extends Component>(
        componentType: ComponentType<T>
    ): Transform | undefined {
        for (const child of this.children) {
            if (child.actor?.hasComponent(componentType)) {
                return child;
            }
        }

        return undefined;
    }

    findChildrenWithComponent<T extends Component>(
        componentType: ComponentType<T>
    ): Transform[] {
        const results: Transform[] = [];

        for (const child of this.children) {
            if (child.actor?.hasComponent(componentType)) {
                results.push(child);
            }
        }

        return results;
    }

    findInChildren(name: string): Transform | undefined {
        const queue: Transform[] = [this];

        for (let index = 0; index < queue.length; index += 1) {
            const current = queue[index]!;

            if (current !== this && current.actor?.name === name) {
                return current;
            }

            queue.push(...current.children);
        }

        return undefined;
    }

    findInChildrenByTag(tag: string): Transform | undefined {
        const queue: Transform[] = [this];

        for (let index = 0; index < queue.length; index += 1) {
            const current = queue[index]!;

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

        for (let index = 0; index < queue.length; index += 1) {
            const current = queue[index]!;
            descendants.push(current);
            queue.push(...current.children);
        }

        return descendants;
    }

    isAncestorOf(transform: Transform): boolean {
        let current = transform.parent;

        while (current) {
            if (current === this) {
                return true;
            }

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
            depth += 1;
            current = current.parent;
        }

        return depth;
    }

    override serialize(): Record<string, any> {
        return {
            position: [this._position.x, this._position.y, this._position.z],
            rotation: [this._rotation.x, this._rotation.y, this._rotation.z, this._rotation.w],
            scale: [this._scale.x, this._scale.y, this._scale.z],
        };
    }

    override deserialize(data: Record<string, any>): void {
        if (Array.isArray(data.position) && data.position.length === 3) {
            this._position.x = Number(data.position[0]);
            this._position.y = Number(data.position[1]);
            this._position.z = Number(data.position[2]);
        }

        if (Array.isArray(data.rotation) && data.rotation.length === 4) {
            this._rotation.x = Number(data.rotation[0]);
            this._rotation.y = Number(data.rotation[1]);
            this._rotation.z = Number(data.rotation[2]);
            this._rotation.w = Number(data.rotation[3]);
        }

        if (Array.isArray(data.scale) && data.scale.length === 3) {
            this._scale.x = Number(data.scale[0]);
            this._scale.y = Number(data.scale[1]);
            this._scale.z = Number(data.scale[2]);
        }

        this._localDirty = true;
        this.markWorldDirty();
    }

    override onDestroy(): void {
        const detachedChildren = [...this._detachedChildren];

        for (const child of detachedChildren) {
            child.parent = undefined;
        }

        if (this._detachedParent) {
            this.parent = undefined;
        }

        this._detachedChildren.clear();
        this._detachedChildrenArray.length = 0;
        this._attachedChildrenArray.length = 0;
        this._attachedHierarchyVersion = -1;
        this._detachedChildrenDirty = false;

        this._localMatrix = undefined;
        this._worldMatrix = undefined;
        this._worldPosition = undefined;
        this._worldRotation = undefined;
        this._worldScale = undefined;
        this._worldDirty = true;
        this._localDirty = true;
    }

    private static _copyMatrix(source: Mat4, target: Mat4): void {
        const sourceData = source.data;
        const targetData = (target as any).data as number[];

        targetData[0] = sourceData[0];
        targetData[1] = sourceData[1];
        targetData[2] = sourceData[2];
        targetData[3] = sourceData[3];
        targetData[4] = sourceData[4];
        targetData[5] = sourceData[5];
        targetData[6] = sourceData[6];
        targetData[7] = sourceData[7];
        targetData[8] = sourceData[8];
        targetData[9] = sourceData[9];
        targetData[10] = sourceData[10];
        targetData[11] = sourceData[11];
        targetData[12] = sourceData[12];
        targetData[13] = sourceData[13];
        targetData[14] = sourceData[14];
        targetData[15] = sourceData[15];
    }

    private _getHierarchy(): Hierarchy | undefined {
        if (!this.actor) {
            return undefined;
        }

        const HierarchyClass =
            (this.world as any)?.registry?.Hierarchy || (globalThis as any).Hierarchy;

        if (!HierarchyClass) {
            return undefined;
        }

        return this.actor.getComponent(HierarchyClass) as Hierarchy | undefined;
    }

    private _resolveTransformFromHierarchy(hierarchy?: Hierarchy): Transform | undefined {
        const actor = (hierarchy as any)?.actor;
        if (!actor) {
            return undefined;
        }

        const TransformClass =
            ((hierarchy as any)?.world as any)?.registry?.Transform ||
            (globalThis as any).Transform;

        if (!TransformClass) {
            return undefined;
        }

        return actor.getComponent(TransformClass) as Transform | undefined;
    }

    private _setDetachedParent(value?: Transform): void {
        if (this._detachedParent === value || value === this) {
            return;
        }

        if (value && value.isDescendantOf(this)) {
            return;
        }

        if (this._detachedParent) {
            this._detachedParent._removeDetachedChild(this);
        }

        this._detachedParent = value;

        if (value) {
            value._addDetachedChild(this);
        }

        this.markHierarchyDirty();
    }

    private _addDetachedChild(child: Transform): void {
        if (this._detachedChildren.has(child)) {
            return;
        }

        this._detachedChildren.add(child);
        this._detachedChildrenDirty = true;
    }

    private _removeDetachedChild(child: Transform): void {
        if (!this._detachedChildren.delete(child)) {
            return;
        }

        this._detachedChildrenDirty = true;
    }

    private _rebuildDetachedChildrenArray(): void {
        this._detachedChildrenArray.length = 0;
        this._detachedChildrenArray.push(...this._detachedChildren);
        this._detachedChildrenDirty = false;
    }

    private _rebuildAttachedChildrenArray(hierarchy: Hierarchy): void {
        this._attachedChildrenArray.length = 0;

        for (const childHierarchy of hierarchy.children) {
            const childTransform = this._resolveTransformFromHierarchy(childHierarchy);
            if (childTransform) {
                this._attachedChildrenArray.push(childTransform);
            }
        }

        this._attachedHierarchyVersion = hierarchy.version;
    }

    private markLocalDirty(): void {
        this._localDirty = true;
        this.markWorldDirty();
    }

    private markWorldDirty(): void {
        this._worldDirty = true;
        this._worldPosition = undefined;
        this._worldRotation = undefined;
        this._worldScale = undefined;

        for (const child of this.children) {
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

    private updateWorldState(): void {
        if (!this._worldMatrix) {
            this._worldMatrix = new Mat4();
        }

        if (!this._worldPosition) {
            this._worldPosition = new Vec3();
        }

        if (!this._worldRotation) {
            this._worldRotation = new Quat();
        }

        if (!this._worldScale) {
            this._worldScale = new Vec3();
        }

        const parent = this.parent;
        const localMatrix = this.localMatrix;

        if (parent) {
            Mat4.multiply(parent.worldMatrix, localMatrix, this._worldMatrix);

            const scaled = Vec3.multiply(
                parent.worldScale,
                this._position,
                Transform._tempVec3
            ) as Vec3;
            parent.worldRotation.rotateVector(scaled, Transform._tempVec3B);
            Vec3.add(parent.worldPosition, Transform._tempVec3B, this._worldPosition);

            Quat.multiply(parent.worldRotation, this._rotation, this._worldRotation);
            Vec3.multiply(parent.worldScale, this._scale, this._worldScale);
        } else {
            Transform._copyMatrix(localMatrix, this._worldMatrix);

            this._worldPosition.x = this._position.x;
            this._worldPosition.y = this._position.y;
            this._worldPosition.z = this._position.z;

            this._worldRotation.x = this._rotation.x;
            this._worldRotation.y = this._rotation.y;
            this._worldRotation.z = this._rotation.z;
            this._worldRotation.w = this._rotation.w;

            this._worldScale.x = this._scale.x;
            this._worldScale.y = this._scale.y;
            this._worldScale.z = this._scale.z;
        }

        this._worldDirty = false;
    }
}
