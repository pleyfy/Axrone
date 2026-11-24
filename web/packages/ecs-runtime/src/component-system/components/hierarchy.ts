import { Component } from '../core/component';
import { script } from '../decorators/script';
import type { Entity } from '../core/entity';
import type { EntityId } from '../types/core';
import type { Transform } from './transform';

@script({
    scriptName: 'Hierarchy',
    priority: 999,
    description: 'Core hierarchy component for parent-child relationships',
    version: '0.1.0',
    author: 'Axrone, Mehmet Ekemen',
    tags: ['core', 'hierarchy'],
    singleton: false,
    executeInEditMode: true,
    validateDependencies: true,
    enableMetrics: true,
    enableCaching: true,
    trackInstances: false,
})
export class Hierarchy extends Component {
    private _parent?: Hierarchy;
    private readonly _children = new Map<EntityId, Hierarchy>();
    private readonly _childrenArray: Hierarchy[] = [];
    private readonly _childEntitiesArray: Entity[] = [];
    private _childrenDirty = false;
    private _childEntitiesVersion = -1;
    private _version = 0;

    get parent(): Hierarchy | undefined {
        return this._parent;
    }

    set parent(value: Hierarchy | undefined) {
        this.setParent(value);
    }

    get children(): readonly Hierarchy[] {
        if (this._childrenDirty) {
            this._rebuildChildrenArray();
        }
        return this._childrenArray;
    }

    get childEntities(): readonly Entity[] {
        if (this._childEntitiesVersion !== this._version) {
            this._childEntitiesArray.length = 0;

            for (const child of this.children) {
                if (child.entity) {
                    this._childEntitiesArray.push(child.entity);
                }
            }

            this._childEntitiesVersion = this._version;
        }

        return this._childEntitiesArray;
    }

    get childCount(): number {
        return this._children.size;
    }

    get version(): number {
        return this._version;
    }

    get parentEntity(): Entity | undefined {
        return this._parent?.entity;
    }

    setParent(value?: Hierarchy): void {
        if (this._parent === value || value === this) {
            return;
        }

        if (value && value.isDescendantOf(this)) {
            return;
        }

        const previousParent = this._parent;

        if (previousParent) {
            previousParent._unlinkChild(this);
        }

        this._parent = value;

        if (value) {
            value._linkChild(this);
        }

        this._touch();
        this._markSpatialTreeDirty();
        this._emitHierarchyChanged();
    }

    isAncestorOf(hierarchy: Hierarchy): boolean {
        let current = hierarchy.parent;

        while (current) {
            if (current === this) {
                return true;
            }

            current = current.parent;
        }

        return false;
    }

    isDescendantOf(hierarchy: Hierarchy): boolean {
        return hierarchy.isAncestorOf(this);
    }

    getRoot(): Hierarchy {
        let current: Hierarchy = this;

        while (current.parent) {
            current = current.parent;
        }

        return current;
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

    getAllDescendants(): Hierarchy[] {
        const descendants: Hierarchy[] = [];
        const queue = [...this.children];

        for (let index = 0; index < queue.length; index += 1) {
            const current = queue[index]!;
            descendants.push(current);
            queue.push(...current.children);
        }

        return descendants;
    }

    override onDestroy(): void {
        // Leaf nodes are the overwhelming majority; skip the snapshot array.
        if (this._children.size > 0) {
            const children = [...this.children];

            for (const child of children) {
                child.parent = undefined;
            }
        }

        if (this._parent) {
            this.parent = undefined;
        }

        this._children.clear();
        this._childrenArray.length = 0;
        this._childEntitiesArray.length = 0;
        this._childrenDirty = false;
        this._childEntitiesVersion = -1;
        this._version = 0;
    }

    private _linkChild(child: Hierarchy): void {
        if (!child.entityId) {
            return;
        }

        if (this._children.get(child.entityId) === child) {
            return;
        }

        this._children.set(child.entityId, child);
        this._childrenDirty = true;
        this._touch();
    }

    private _unlinkChild(child: Hierarchy): void {
        if (!child.entityId) {
            return;
        }

        if (!this._children.delete(child.entityId)) {
            return;
        }

        this._childrenDirty = true;
        this._touch();
    }

    private _rebuildChildrenArray(): void {
        this._childrenArray.length = 0;
        this._childrenArray.push(...this._children.values());
        this._childrenDirty = false;
    }

    private _touch(): void {
        this._version += 1;
    }

    private _markSpatialTreeDirty(): void {
        const transform = this._getTransform();
        if (transform && typeof transform.markHierarchyDirty === 'function') {
            transform.markHierarchyDirty();
        }
    }

    private _emitHierarchyChanged(): void {
        if (!this.world || !this.entityId || !this.entity) {
            return;
        }

        const component = this._getTransform() ?? this;

        this.world.emitSync('TransformHierarchyChanged' as any, {
            entityId: this.entityId,
            component,
            entity: this.entity,
        });
    }

    private _getTransform(): Transform | undefined {
        if (!this.entity) {
            return undefined;
        }

        const worldAny = this.world as unknown as { registry?: { Transform?: typeof Transform } } | null;
        const TransformClass = worldAny?.registry?.Transform ?? (globalThis as unknown as { Transform?: typeof Transform }).Transform;

        if (!TransformClass) {
            return undefined;
        }

        return this.entity.getComponent(TransformClass);
    }
}
