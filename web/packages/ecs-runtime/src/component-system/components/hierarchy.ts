import { Component } from '../core/component';
import { script } from '../decorators/script';
import type { Actor } from '../core/actor';
import type { Entity } from '../types/core';
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
    private readonly _children = new Map<Entity, Hierarchy>();
    private readonly _childrenArray: Hierarchy[] = [];
    private readonly _childActorsArray: Actor[] = [];
    private _childrenDirty = false;
    private _childActorsVersion = -1;
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

    get childActors(): readonly Actor[] {
        if (this._childActorsVersion !== this._version) {
            this._childActorsArray.length = 0;

            for (const child of this.children) {
                if (child.actor) {
                    this._childActorsArray.push(child.actor);
                }
            }

            this._childActorsVersion = this._version;
        }

        return this._childActorsArray;
    }

    get childCount(): number {
        return this._children.size;
    }

    get version(): number {
        return this._version;
    }

    get parentActor(): Actor | undefined {
        return this._parent?.actor;
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
        const children = [...this.children];

        for (const child of children) {
            child.parent = undefined;
        }

        if (this._parent) {
            this.parent = undefined;
        }

        this._children.clear();
        this._childrenArray.length = 0;
        this._childActorsArray.length = 0;
        this._childrenDirty = false;
        this._childActorsVersion = -1;
        this._version = 0;
    }

    private _linkChild(child: Hierarchy): void {
        if (!child.entity) {
            return;
        }

        if (this._children.get(child.entity) === child) {
            return;
        }

        this._children.set(child.entity, child);
        this._childrenDirty = true;
        this._touch();
    }

    private _unlinkChild(child: Hierarchy): void {
        if (!child.entity) {
            return;
        }

        if (!this._children.delete(child.entity)) {
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
        if (!this.world || !this.entity || !this.actor) {
            return;
        }

        const component = this._getTransform() ?? this;

        this.world.emitSync('TransformHierarchyChanged' as any, {
            entity: this.entity,
            component,
            actor: this.actor,
        });
    }

    private _getTransform(): Transform | undefined {
        if (!this.actor) {
            return undefined;
        }

        const worldAny = this.world as unknown as { registry?: { Transform?: typeof Transform } } | null;
        const TransformClass = worldAny?.registry?.Transform ?? (globalThis as unknown as { Transform?: typeof Transform }).Transform;

        if (!TransformClass) {
            return undefined;
        }

        return this.actor.getComponent(TransformClass);
    }
}
