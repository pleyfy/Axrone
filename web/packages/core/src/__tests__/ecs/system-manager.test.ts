import { SystemManager, SystemPhase } from '../../component-system/systems/system-manager';
import { World } from '../../component-system/core/world';
import { Actor } from '../../component-system/core/actor';
import { Component } from '../../component-system/core/component';
import { Transform } from '../../component-system/components/transform';
import type { SystemId } from '../../component-system/types/core';
import type { System } from '../../component-system/types/system';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class TestComponent extends Component {
    value: number = 0;
    constructor(value: number = 0) {
        super();
        this.value = value;
    }
}

class PositionComponent extends Component {
    x: number = 0;
    y: number = 0;
    constructor(x: number = 0, y: number = 0) {
        super();
        this.x = x;
        this.y = y;
    }
}

class VelocityComponent extends Component {
    vx: number = 0;
    vy: number = 0;
    constructor(vx: number = 0, vy: number = 0) {
        super();
        this.vx = vx;
        this.vy = vy;
    }
}

describe('SystemManager', () => {
    const registry = {
        TestComponent,
        PositionComponent,
        VelocityComponent,
        Transform,
    };

    let world: World<typeof registry>;
    let systemManager: SystemManager<typeof registry>;

    beforeEach(() => {
        world = new World(registry);
        systemManager = new SystemManager(world);
    });

    afterEach(() => {
        world.clear();
    });

    describe('initialization', () => {
        it('should initialize with empty systems', () => {
            expect(systemManager.systemCount).toBe(0);
            expect(systemManager.getSystems()).toHaveLength(0);
        });

        it('should initialize all system phases', () => {
            Object.values(SystemPhase).forEach((phase) => {
                expect(systemManager.getSystemsInPhase(phase)).toHaveLength(0);
            });
        });

        it('should be enabled by default', () => {
            expect(systemManager.enabled).toBe(true);
        });
    });

    describe('system registration', () => {
        it('should add system successfully', () => {
            const mockExecute = vi.fn();
            const system: System<typeof registry, ['TestComponent']> = {
                id: 'TestSystem' as SystemId,
                query: ['TestComponent'],
                execute: mockExecute,
                priority: 100,
                enabled: true,
            };

            systemManager.addSystem(system);

            expect(systemManager.systemCount).toBe(1);
            expect(systemManager.hasSystem(system.id)).toBe(true);
            expect(systemManager.getSystem(system.id)).toBe(system);
        });

        it('should add system to specific phase', () => {
            const mockExecute = vi.fn();
            const system: System<typeof registry, ['TestComponent']> = {
                id: 'RenderSystem' as SystemId,
                query: ['TestComponent'],
                execute: mockExecute,
                priority: 100,
                enabled: true,
            };

            systemManager.addSystem(system, SystemPhase.Render);

            expect(systemManager.getSystemsInPhase(SystemPhase.Render)).toContain(system);
            expect(systemManager.getSystemsInPhase(SystemPhase.Update)).not.toContain(system);
        });

        it('should default to Update phase when no phase specified', () => {
            const mockExecute = vi.fn();
            const system: System<typeof registry, ['TestComponent']> = {
                id: 'DefaultSystem' as SystemId,
                query: ['TestComponent'],
                execute: mockExecute,
                priority: 100,
                enabled: true,
            };

            systemManager.addSystem(system);

            expect(systemManager.getSystemsInPhase(SystemPhase.Update)).toContain(system);
        });

        it('should call onEnable when system is added', () => {
            const mockExecute = vi.fn();
            const mockOnEnable = vi.fn();
            const system: System<typeof registry, ['TestComponent']> = {
                id: 'EnableSystem' as SystemId,
                query: ['TestComponent'],
                execute: mockExecute,
                priority: 100,
                enabled: true,
                onEnable: mockOnEnable,
            };

            systemManager.addSystem(system);

            expect(mockOnEnable).toHaveBeenCalledTimes(1);
        });

        it('should replace existing system with warning', () => {
            const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

            const system1: System<typeof registry, ['TestComponent']> = {
                id: 'DuplicateSystem' as SystemId,
                query: ['TestComponent'],
                execute: vi.fn(),
                priority: 100,
                enabled: true,
            };

            const system2: System<typeof registry, ['PositionComponent']> = {
                id: 'DuplicateSystem' as SystemId,
                query: ['PositionComponent'],
                execute: vi.fn(),
                priority: 200,
                enabled: true,
            };

            systemManager.addSystem(system1);
            systemManager.addSystem(system2);

            expect(consoleSpy).toHaveBeenCalledWith(
                'System DuplicateSystem already exists, replacing...'
            );
            expect(systemManager.systemCount).toBe(1);
            expect(systemManager.getSystem('DuplicateSystem' as SystemId)).toBe(system2);

            consoleSpy.mockRestore();
        });
    });

    describe('system removal', () => {
        it('should remove system successfully', () => {
            const mockExecute = vi.fn();
            const system: System<typeof registry, ['TestComponent']> = {
                id: 'RemoveSystem' as SystemId,
                query: ['TestComponent'],
                execute: mockExecute,
                priority: 100,
                enabled: true,
            };

            systemManager.addSystem(system);
            const removed = systemManager.removeSystem(system.id);

            expect(removed).toBe(true);
            expect(systemManager.systemCount).toBe(0);
            expect(systemManager.hasSystem(system.id)).toBe(false);
        });

        it('should call onDisable when system is removed', () => {
            const mockExecute = vi.fn();
            const mockOnDisable = vi.fn();
            const system: System<typeof registry, ['TestComponent']> = {
                id: 'DisableSystem' as SystemId,
                query: ['TestComponent'],
                execute: mockExecute,
                priority: 100,
                enabled: true,
                onDisable: mockOnDisable,
            };

            systemManager.addSystem(system);
            systemManager.removeSystem(system.id);

            expect(mockOnDisable).toHaveBeenCalledTimes(1);
        });

        it('should return false when removing non-existent system', () => {
            const removed = systemManager.removeSystem('NonExistent' as SystemId);
            expect(removed).toBe(false);
        });

        it('should remove system from all phases', () => {
            const mockExecute = vi.fn();
            const system: System<typeof registry, ['TestComponent']> = {
                id: 'PhaseSystem' as SystemId,
                query: ['TestComponent'],
                execute: mockExecute,
                priority: 100,
                enabled: true,
            };

            systemManager.addSystem(system, SystemPhase.Render);
            systemManager.removeSystem(system.id);

            Object.values(SystemPhase).forEach((phase) => {
                expect(systemManager.getSystemsInPhase(phase)).not.toContain(system);
            });
        });
    });

    describe('system priority and sorting', () => {
        it('should sort systems by priority in descending order', () => {
            const lowPrioritySystem: System<typeof registry, ['TestComponent']> = {
                id: 'LowPriority' as SystemId,
                query: ['TestComponent'],
                execute: vi.fn(),
                priority: 10,
                enabled: true,
            };

            const highPrioritySystem: System<typeof registry, ['TestComponent']> = {
                id: 'HighPriority' as SystemId,
                query: ['TestComponent'],
                execute: vi.fn(),
                priority: 100,
                enabled: true,
            };

            const mediumPrioritySystem: System<typeof registry, ['TestComponent']> = {
                id: 'MediumPriority' as SystemId,
                query: ['TestComponent'],
                execute: vi.fn(),
                priority: 50,
                enabled: true,
            };

            systemManager.addSystem(lowPrioritySystem);
            systemManager.addSystem(highPrioritySystem);
            systemManager.addSystem(mediumPrioritySystem);

            const systems = systemManager.getSystemsInPhase(SystemPhase.Update);
            expect(systems[0]).toBe(highPrioritySystem);
            expect(systems[1]).toBe(mediumPrioritySystem);
            expect(systems[2]).toBe(lowPrioritySystem);
        });

        it('should maintain sort order across phases', () => {
            const system1: System<typeof registry, ['TestComponent']> = {
                id: 'PreUpdateHigh' as SystemId,
                query: ['TestComponent'],
                execute: vi.fn(),
                priority: 100,
                enabled: true,
            };

            const system2: System<typeof registry, ['PositionComponent']> = {
                id: 'PreUpdateLow' as SystemId,
                query: ['PositionComponent'],
                execute: vi.fn(),
                priority: 10,
                enabled: true,
            };

            systemManager.addSystem(system2, SystemPhase.PreUpdate);
            systemManager.addSystem(system1, SystemPhase.PreUpdate);

            const preUpdateSystems = systemManager.getSystemsInPhase(SystemPhase.PreUpdate);
            expect(preUpdateSystems[0]).toBe(system1);
            expect(preUpdateSystems[1]).toBe(system2);
        });
    });

    describe('system execution', () => {
        it('should execute all enabled systems', () => {
            const mockExecute1 = vi.fn();
            const mockExecute2 = vi.fn();

            const system1: System<typeof registry, ['TestComponent']> = {
                id: 'System1' as SystemId,
                query: ['TestComponent'],
                execute: mockExecute1,
                priority: 100,
                enabled: true,
            };

            const system2: System<typeof registry, ['PositionComponent']> = {
                id: 'System2' as SystemId,
                query: ['PositionComponent'],
                execute: mockExecute2,
                priority: 50,
                enabled: true,
            };

            systemManager.addSystem(system1);
            systemManager.addSystem(system2);

            systemManager.executeAll(16.67);

            expect(mockExecute1).toHaveBeenCalledWith(expect.any(Array), 16.67);
            expect(mockExecute2).toHaveBeenCalledWith(expect.any(Array), 16.67);
        });

        it('should not execute disabled systems', () => {
            const mockExecute = vi.fn();
            const system: System<typeof registry, ['TestComponent']> = {
                id: 'DisabledSystem' as SystemId,
                query: ['TestComponent'],
                execute: mockExecute,
                priority: 100,
                enabled: false,
            };

            systemManager.addSystem(system);
            systemManager.executeAll(16.67);

            expect(mockExecute).not.toHaveBeenCalled();
        });

        it('should execute systems in correct phase order', () => {
            const executionOrder: string[] = [];

            const preUpdateSystem: System<typeof registry, ['TestComponent']> = {
                id: 'PreUpdate' as SystemId,
                query: ['TestComponent'],
                execute: () => executionOrder.push('pre-update'),
                priority: 100,
                enabled: true,
            };

            const updateSystem: System<typeof registry, ['TestComponent']> = {
                id: 'Update' as SystemId,
                query: ['TestComponent'],
                execute: () => executionOrder.push('update'),
                priority: 100,
                enabled: true,
            };

            const postUpdateSystem: System<typeof registry, ['TestComponent']> = {
                id: 'PostUpdate' as SystemId,
                query: ['TestComponent'],
                execute: () => executionOrder.push('post-update'),
                priority: 100,
                enabled: true,
            };

            const renderSystem: System<typeof registry, ['TestComponent']> = {
                id: 'Render' as SystemId,
                query: ['TestComponent'],
                execute: () => executionOrder.push('render'),
                priority: 100,
                enabled: true,
            };

            systemManager.addSystem(renderSystem, SystemPhase.Render);
            systemManager.addSystem(preUpdateSystem, SystemPhase.PreUpdate);
            systemManager.addSystem(postUpdateSystem, SystemPhase.PostUpdate);
            systemManager.addSystem(updateSystem, SystemPhase.Update);

            systemManager.executeAll(16.67);

            expect(executionOrder).toEqual(['pre-update', 'update', 'post-update', 'render']);
        });

        it('should execute specific phase only', () => {
            const mockUpdate = vi.fn();
            const mockRender = vi.fn();

            const updateSystem: System<typeof registry, ['TestComponent']> = {
                id: 'UpdateSystem' as SystemId,
                query: ['TestComponent'],
                execute: mockUpdate,
                priority: 100,
                enabled: true,
            };

            const renderSystem: System<typeof registry, ['PositionComponent']> = {
                id: 'RenderSystem' as SystemId,
                query: ['PositionComponent'],
                execute: mockRender,
                priority: 100,
                enabled: true,
            };

            systemManager.addSystem(updateSystem, SystemPhase.Update);
            systemManager.addSystem(renderSystem, SystemPhase.Render);

            systemManager.executePhase(SystemPhase.Update, 16.67);

            expect(mockUpdate).toHaveBeenCalledTimes(1);
            expect(mockRender).not.toHaveBeenCalled();
        });

        it('should pass query results to system execute function', () => {
            const mockExecute = vi.fn();
            const system: System<typeof registry, ['TestComponent']> = {
                id: 'QuerySystem' as SystemId,
                query: ['TestComponent'],
                execute: mockExecute,
                priority: 100,
                enabled: true,
            };

            const entity = world.createEntity();

            world.addComponent(entity, 'TestComponent');

            const entity2 = world.createEntity();
            world.addComponent(entity2, 'PositionComponent');
            systemManager.addSystem(system);
            systemManager.executeAll(16.67);

            expect(mockExecute).toHaveBeenCalledWith(expect.any(Array), 16.67);
        });

        it('should handle system execution errors gracefully', () => {
            const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            const errorSystem: System<typeof registry, ['TestComponent']> = {
                id: 'ErrorSystem' as SystemId,
                query: ['TestComponent'],
                execute: () => {
                    throw new Error('System error');
                },
                priority: 100,
                enabled: true,
            };

            const normalSystem: System<typeof registry, ['PositionComponent']> = {
                id: 'NormalSystem' as SystemId,
                query: ['PositionComponent'],
                execute: vi.fn(),
                priority: 100,
                enabled: true,
            };

            systemManager.addSystem(errorSystem);
            systemManager.addSystem(normalSystem);

            expect(() => systemManager.executeAll(16.67)).not.toThrow();
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                'Error executing system ErrorSystem:',
                expect.any(Error)
            );

            consoleErrorSpy.mockRestore();
        });
    });

    describe('manager state management', () => {
        it('should enable/disable manager', () => {
            expect(systemManager.enabled).toBe(true);

            systemManager.setEnabled(false);
            expect(systemManager.enabled).toBe(false);

            systemManager.setEnabled(true);
            expect(systemManager.enabled).toBe(true);
        });

        it('should not execute systems when manager is disabled', () => {
            const mockExecute = vi.fn();
            const system: System<typeof registry, ['TestComponent']> = {
                id: 'TestSystem' as SystemId,
                query: ['TestComponent'],
                execute: mockExecute,
                priority: 100,
                enabled: true,
            };

            systemManager.addSystem(system);
            systemManager.setEnabled(false);
            systemManager.executeAll(16.67);

            expect(mockExecute).not.toHaveBeenCalled();
        });

        it('should not execute specific phase when manager is disabled', () => {
            const mockExecute = vi.fn();
            const system: System<typeof registry, ['TestComponent']> = {
                id: 'TestSystem' as SystemId,
                query: ['TestComponent'],
                execute: mockExecute,
                priority: 100,
                enabled: true,
            };

            systemManager.addSystem(system);
            systemManager.setEnabled(false);
            systemManager.executePhase(SystemPhase.Update, 16.67);

            expect(mockExecute).not.toHaveBeenCalled();
        });

        it('should support method chaining', () => {
            const system: System<typeof registry, ['TestComponent']> = {
                id: 'ChainSystem' as SystemId,
                query: ['TestComponent'],
                execute: vi.fn(),
                priority: 100,
                enabled: true,
            };

            const result = systemManager.addSystem(system).setEnabled(false).setEnabled(true);

            expect(result).toBe(systemManager);
        });
    });

    describe('system queries and information', () => {
        it('should return all systems', () => {
            const system1: System<typeof registry, ['TestComponent']> = {
                id: 'System1' as SystemId,
                query: ['TestComponent'],
                execute: vi.fn(),
                priority: 100,
                enabled: true,
            };

            const system2: System<typeof registry, ['PositionComponent']> = {
                id: 'System2' as SystemId,
                query: ['PositionComponent'],
                execute: vi.fn(),
                priority: 50,
                enabled: true,
            };

            systemManager.addSystem(system1);
            systemManager.addSystem(system2);

            const allSystems = systemManager.getSystems();
            expect(allSystems).toHaveLength(2);
            expect(allSystems).toContain(system1);
            expect(allSystems).toContain(system2);
        });

        it('should return systems for specific phase', () => {
            const updateSystem: System<typeof registry, ['TestComponent']> = {
                id: 'UpdateSystem' as SystemId,
                query: ['TestComponent'],
                execute: vi.fn(),
                priority: 100,
                enabled: true,
            };

            const renderSystem: System<typeof registry, ['PositionComponent']> = {
                id: 'RenderSystem' as SystemId,
                query: ['PositionComponent'],
                execute: vi.fn(),
                priority: 50,
                enabled: true,
            };

            systemManager.addSystem(updateSystem, SystemPhase.Update);
            systemManager.addSystem(renderSystem, SystemPhase.Render);

            const updateSystems = systemManager.getSystemsInPhase(SystemPhase.Update);
            const renderSystems = systemManager.getSystemsInPhase(SystemPhase.Render);

            expect(updateSystems).toContain(updateSystem);
            expect(updateSystems).not.toContain(renderSystem);
            expect(renderSystems).toContain(renderSystem);
            expect(renderSystems).not.toContain(updateSystem);
        });

        it('should return empty array for empty phase', () => {
            const systems = systemManager.getSystemsInPhase(SystemPhase.PreUpdate);
            expect(systems).toEqual([]);
        });

        it('should track system count correctly', () => {
            expect(systemManager.systemCount).toBe(0);

            const system1: System<typeof registry, ['TestComponent']> = {
                id: 'System1' as SystemId,
                query: ['TestComponent'],
                execute: vi.fn(),
                priority: 100,
                enabled: true,
            };

            systemManager.addSystem(system1);
            expect(systemManager.systemCount).toBe(1);

            const system2: System<typeof registry, ['PositionComponent']> = {
                id: 'System2' as SystemId,
                query: ['PositionComponent'],
                execute: vi.fn(),
                priority: 50,
                enabled: true,
            };

            systemManager.addSystem(system2);
            expect(systemManager.systemCount).toBe(2);

            systemManager.removeSystem(system1.id);
            expect(systemManager.systemCount).toBe(1);

            systemManager.removeSystem(system2.id);
            expect(systemManager.systemCount).toBe(0);
        });
    });

    describe('edge cases and error handling', () => {
        it('should handle systems with complex queries', () => {
            const mockExecute = vi.fn();
            const complexSystem: System<typeof registry, ['TestComponent', 'PositionComponent']> = {
                id: 'ComplexSystem' as SystemId,
                query: ['TestComponent', 'PositionComponent'],
                execute: mockExecute,
                priority: 100,
                enabled: true,
            };

            systemManager.addSystem(complexSystem);

            const entity = world.createEntity();
            world.addComponent(entity, 'TestComponent');
            world.addComponent(entity, 'PositionComponent');

            systemManager.executeAll(16.67);

            expect(mockExecute).toHaveBeenCalledWith(
                expect.arrayContaining([
                    expect.objectContaining({
                        components: expect.objectContaining({
                            TestComponent: expect.any(TestComponent),
                            PositionComponent: expect.any(PositionComponent),
                        }),
                    }),
                ]),
                16.67
            );
        });

        it('should handle systems with minimal queries', () => {
            const mockExecute = vi.fn();
            const minimalQuerySystem: System<typeof registry, ['TestComponent']> = {
                id: 'MinimalQuerySystem' as SystemId,
                query: ['TestComponent'],
                execute: mockExecute,
                priority: 100,
                enabled: true,
            };

            systemManager.addSystem(minimalQuerySystem);

            const entity = world.createEntity();
            world.addComponent(entity, 'PositionComponent');

            systemManager.executeAll(16.67);

            expect(mockExecute).toHaveBeenCalledWith([], 16.67);

            world.destroyEntity(entity);
        });

        it('should handle systems with zero priority', () => {
            const zeroPrioritySystem: System<typeof registry, ['TestComponent']> = {
                id: 'ZeroPriority' as SystemId,
                query: ['TestComponent'],
                execute: vi.fn(),
                priority: 0,
                enabled: true,
            };

            expect(() => systemManager.addSystem(zeroPrioritySystem)).not.toThrow();
            expect(systemManager.hasSystem(zeroPrioritySystem.id)).toBe(true);
        });

        it('should handle systems with negative priority', () => {
            const negativePrioritySystem: System<typeof registry, ['TestComponent']> = {
                id: 'NegativePriority' as SystemId,
                query: ['TestComponent'],
                execute: vi.fn(),
                priority: -10,
                enabled: true,
            };

            expect(() => systemManager.addSystem(negativePrioritySystem)).not.toThrow();
            expect(systemManager.hasSystem(negativePrioritySystem.id)).toBe(true);
        });

        it('should handle execution with no deltaTime', () => {
            const mockExecute = vi.fn();
            const system: System<typeof registry, ['TestComponent']> = {
                id: 'NoDeltaSystem' as SystemId,
                query: ['TestComponent'],
                execute: mockExecute,
                priority: 100,
                enabled: true,
            };

            systemManager.addSystem(system);
            systemManager.executeAll();

            expect(mockExecute).toHaveBeenCalledWith(expect.any(Array), 0);
        });
    });

    describe('performance and memory', () => {
        it('should handle many systems efficiently', () => {
            const systemCount = 100;
            const systems: System<typeof registry, ['TestComponent']>[] = [];

            for (let i = 0; i < systemCount; i++) {
                const system: System<typeof registry, ['TestComponent']> = {
                    id: `System${i}` as SystemId,
                    query: ['TestComponent'],
                    execute: vi.fn(),
                    priority: i,
                    enabled: true,
                };
                systems.push(system);
                systemManager.addSystem(system);
            }

            expect(systemManager.systemCount).toBe(systemCount);

            const startTime = performance.now();
            systemManager.executeAll(16.67);
            const endTime = performance.now();

            expect(endTime - startTime).toBeLessThan(100);
        });

        it('should cleanup properly when systems are removed', () => {
            const systems: System<typeof registry, ['TestComponent']>[] = [];

            for (let i = 0; i < 10; i++) {
                const system: System<typeof registry, ['TestComponent']> = {
                    id: `CleanupSystem${i}` as SystemId,
                    query: ['TestComponent'],
                    execute: vi.fn(),
                    priority: i,
                    enabled: true,
                };
                systems.push(system);
                systemManager.addSystem(system);
            }

            systems.forEach((system) => {
                systemManager.removeSystem(system.id);
            });

            expect(systemManager.systemCount).toBe(0);
            Object.values(SystemPhase).forEach((phase) => {
                expect(systemManager.getSystemsInPhase(phase)).toHaveLength(0);
            });
        });
    });
});
