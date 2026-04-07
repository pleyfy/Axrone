import type { ComponentRegistry, SystemId } from '../types/core';
import type { System, SystemQuery } from '../types/system';
import type { World } from '../core/world';

export enum SystemPhase {
    PreUpdate = 'pre-update',
    Update = 'update',
    PostUpdate = 'post-update',
    Render = 'render',
}

export class SystemManager<R extends ComponentRegistry> {
    private readonly systems = new Map<SystemId, System<R, any>>();
    private readonly systemsByPhase = new Map<SystemPhase, System<R, any>[]>();
    private readonly world: World<R>;
    private _dirty = true;
    private _enabled = true;

    constructor(world: World<R>) {
        this.world = world;

        Object.values(SystemPhase).forEach((phase) => {
            this.systemsByPhase.set(phase, []);
        });
    }

    addSystem<Q extends SystemQuery<R>>(
        system: System<R, Q>,
        phase: SystemPhase = SystemPhase.Update
    ): this {
        if (this.systems.has(system.id)) {
            console.warn(`System ${system.id} already exists, replacing...`);
            this.removeSystem(system.id);
        }

        this.systems.set(system.id, system);
        this._dirty = true;
        this.assignSystemToPhase(system, phase);

        if (system.onEnable) {
            system.onEnable();
        }

        return this;
    }

    removeSystem(systemId: SystemId): boolean {
        const system = this.systems.get(systemId);
        if (!system) return false;

        if (system.onDisable) {
            system.onDisable();
        }

        this.systems.delete(systemId);
        this._dirty = true;

        this.systemsByPhase.forEach((systems) => {
            const index = systems.indexOf(system);
            if (index !== -1) {
                systems.splice(index, 1);
            }
        });

        return true;
    }

    setEnabled(enabled: boolean): this {
        this._enabled = enabled;
        return this;
    }

    get enabled(): boolean {
        return this._enabled;
    }

    executeAll(deltaTime: number = 0): void {
        if (!this._enabled) return;

        if (this._dirty) {
            this.sortAllSystems();
        }

        for (const phase of Object.values(SystemPhase)) {
            this.executePhase(phase, deltaTime);
        }
    }

    executePhase(phase: SystemPhase, deltaTime: number = 0): void {
        if (!this._enabled) return;

        const systems = this.systemsByPhase.get(phase);
        if (!systems) return;

        for (const system of systems) {
            if (system.enabled) {
                this.executeSystem(system, deltaTime);
            }
        }
    }

    private executeSystem(system: System<R, any>, deltaTime: number): void {
        try {
            const entities = this.world.query(...system.query);
            system.execute(entities, deltaTime);
        } catch (error) {
            console.error(`Error executing system ${system.id}:`, error);
        }
    }

    private sortAllSystems(): void {
        this.systemsByPhase.forEach((systems) => {
            systems.sort((a, b) => b.priority - a.priority);
        });
        this._dirty = false;
    }

    private assignSystemToPhase(system: System<R, any>, phase: SystemPhase): void {
        const systems = this.systemsByPhase.get(phase)!;
        systems.push(system);
        systems.sort((a, b) => b.priority - a.priority);
    }

    getSystem(systemId: SystemId): System<R, any> | undefined {
        return this.systems.get(systemId);
    }

    getSystems(): readonly System<R, any>[] {
        return Array.from(this.systems.values());
    }

    getSystemsInPhase(phase: SystemPhase): readonly System<R, any>[] {
        return this.systemsByPhase.get(phase) || [];
    }

    get systemCount(): number {
        return this.systems.size;
    }

    hasSystem(systemId: SystemId): boolean {
        return this.systems.has(systemId);
    }
}
