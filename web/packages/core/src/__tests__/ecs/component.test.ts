import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Component } from '../../component-system/core/component';
import { World } from '../../component-system/core/world';

class TestComponent extends Component {
    value: number = 0;
    name: string = '';

    constructor(value: number = 0, name: string = '') {
        super();
        this.value = value;
        this.name = name;
    }

    reset(): void {
        super.reset();
        this.value = 0;
        this.name = '';
    }

    validate(): boolean {
        return super.validate() && this.value >= 0;
    }

    awake(): void {
        this.value = 1;
    }

    start(): void {
        this.value = 2;
    }

    update(deltaTime: number): void {
        this.value += deltaTime;
    }

    onEnable(): void {
        this.name = 'enabled';
    }

    onDisable(): void {
        this.name = 'disabled';
    }

    onDestroy(): void {
        this.name = 'destroyed';
    }
}

class AsyncComponent extends Component {
    initialized = false;
    started = false;

    async awake(): Promise<void> {
        await new Promise((resolve) => setTimeout(resolve, 10));
        this.initialized = true;
    }

    async start(): Promise<void> {
        await new Promise((resolve) => setTimeout(resolve, 10));
        this.started = true;
    }

    async onEnable(): Promise<void> {
        await new Promise((resolve) => setTimeout(resolve, 5));
    }

    async onDisable(): Promise<void> {
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
}

class ValidatingComponent extends Component {
    isValid = true;

    protected _validateInternal(): boolean {
        return super._validateInternal() && this.isValid;
    }

    protected _getCustomValidationErrors(errors: string[]): string[] {
        if (!this.isValid) {
            errors.push('Component is marked as invalid');
        }
        return errors;
    }
}

class SerializableComponent extends Component {
    data: any = { x: 10, y: 20 };

    serialize(): Record<string, any> {
        const base = super.serialize();
        return { ...base, data: this.data };
    }

    deserialize(data: Record<string, any>): void {
        super.deserialize(data);
        if (data.data) {
            this.data = data.data;
        }
    }
}

describe('Component', () => {
    let component: TestComponent;
    let world: World<any>;
    let registry: any;

    beforeEach(() => {
        registry = {
            TestComponent: TestComponent,
            AsyncComponent: AsyncComponent,
            ValidatingComponent: ValidatingComponent,
            SerializableComponent: SerializableComponent,
        };
        world = new World(registry);
        component = new TestComponent(5, 'test');
    });

    afterEach(() => {
        if (component && component.state !== 'destroyed') {
            component._internalDestroy();
        }
        if (world && !world.isDisposed) {
            world.clear();
        }
    });

    describe('initialization', () => {
        it('should initialize with correct default state', () => {
            const comp = new TestComponent();

            expect(comp.state).toBe('uninitialized');
            expect(comp.enabled).toBe(true);
            expect(comp.persistent).toBe(false);
            expect(comp.executeInEditMode).toBe(false);
            expect(comp.id).toBeDefined();
            expect(comp.priority).toBe(0);
        });

        it('should initialize with custom configuration', () => {
            const comp = new TestComponent(10, 'custom');

            expect(comp.value).toBe(10);
            expect(comp.name).toBe('custom');
        });

        it('should generate unique IDs', () => {
            const comp1 = new TestComponent();
            const comp2 = new TestComponent();

            expect(comp1.id).not.toBe(comp2.id);

            comp1._internalDestroy();
            comp2._internalDestroy();
        });
    });

    describe('state management', () => {
        it('should transition through lifecycle states correctly', async () => {
            expect(component.state).toBe('uninitialized');

            await component._internalAwake();
            expect(component.state).toBe('awake');
            expect(component.value).toBe(1);

            await component._internalStart();
            expect(component.state).toBe('enabled');
            expect(component.value).toBe(2);
            expect(component.name).toBe('enabled');
        });

        it('should handle async lifecycle methods', async () => {
            const asyncComp = new AsyncComponent();

            expect(asyncComp.initialized).toBe(false);
            expect(asyncComp.started).toBe(false);

            await asyncComp._internalAwake();
            expect(asyncComp.initialized).toBe(true);

            await asyncComp._internalStart();
            expect(asyncComp.started).toBe(true);

            asyncComp._internalDestroy();
        });

        it('should handle enable/disable correctly', async () => {
            await component._internalAwake();
            await component._internalStart();

            expect(component.enabled).toBe(true);
            expect(component.name).toBe('enabled');

            component.enabled = false;
            expect(component.enabled).toBe(false);
            expect(component.name).toBe('disabled');

            component.enabled = true;
            expect(component.enabled).toBe(true);
            expect(component.name).toBe('enabled');
        });

        it('should prevent state changes on destroyed component', async () => {
            await component._internalDestroy();

            expect(() => {
                component.enabled = true;
            }).toThrow();
        });
    });

    describe('priority management', () => {
        it('should set and get priority correctly', () => {
            expect(component.priority).toBe(0);

            component.priority = 100;
            expect(component.priority).toBe(100);

            component.priority = -50;
            expect(component.priority).toBe(-50);
        });

        it('should validate priority values', () => {
            expect(() => {
                component.priority = 1.5;
            }).toThrow();

            expect(() => {
                component.priority = NaN;
            }).toThrow();
        });
    });

    describe('update lifecycle', () => {
        it('should call update when enabled', async () => {
            await component._internalAwake();
            await component._internalStart();

            const initialValue = component.value;
            component._internalUpdate(0.016);

            expect(component.value).toBeCloseTo(initialValue + 0.016, 5);
        });

        it('should not call update when disabled', async () => {
            await component._internalAwake();
            await component._internalStart();

            component.enabled = false;
            const initialValue = component.value;
            component._internalUpdate(0.016);

            expect(component.value).toBe(initialValue);
        });

        it('should handle update errors gracefully', async () => {
            const errorComponent = new (class extends Component {
                update(): void {
                    throw new Error('Update error');
                }
            })();

            await errorComponent._internalAwake();
            await errorComponent._internalStart();

            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

            errorComponent._internalUpdate(0.016);

            expect(consoleSpy).toHaveBeenCalled();
            consoleSpy.mockRestore();

            errorComponent._internalDestroy();
        });
    });

    describe('validation', () => {
        it('should validate correctly', () => {
            const validComp = new ValidatingComponent();
            validComp.isValid = true;

            expect(validComp.validate()).toBe(true);
            expect(validComp.getValidationErrors()).toHaveLength(0);
        });

        it('should handle validation failures', () => {
            const invalidComp = new ValidatingComponent();
            invalidComp.isValid = false;

            expect(invalidComp.validate()).toBe(false);
            expect(invalidComp.getValidationErrors()).toContain('Component is marked as invalid');

            invalidComp._internalDestroy();
        });

        it('should validate destroyed components as invalid', async () => {
            await component._internalDestroy();

            expect(component.validate()).toBe(false);
            expect(component.getValidationErrors()).toContain('Component is destroyed');
        });
    });

    describe('serialization', () => {
        it('should serialize basic component data', () => {
            const serialized = component.serialize();

            expect(serialized).toHaveProperty('id');
            expect(serialized).toHaveProperty('type');
            expect(serialized).toHaveProperty('priority');
            expect(serialized).toHaveProperty('enabled');
            expect(serialized).toHaveProperty('persistent');
            expect(serialized).toHaveProperty('state');
        });

        it('should serialize custom component data', () => {
            const serializableComp = new SerializableComponent();
            const serialized = serializableComp.serialize();

            expect(serialized).toHaveProperty('data');
            expect(serialized.data).toEqual({ x: 10, y: 20 });

            serializableComp._internalDestroy();
        });

        it('should deserialize component data', () => {
            const serializableComp = new SerializableComponent();
            const data = {
                priority: 50,
                enabled: false,
                persistent: true,
                data: { x: 100, y: 200 },
            };

            serializableComp.deserialize(data);

            expect(serializableComp.priority).toBe(50);
            expect(serializableComp.enabled).toBe(false);
            expect(serializableComp.persistent).toBe(true);
            expect(serializableComp.data).toEqual({ x: 100, y: 200 });

            serializableComp._internalDestroy();
        });

        it('should clone component correctly', () => {
            component.priority = 25;
            component.enabled = false;

            const cloned = component.clone();

            expect(cloned).not.toBe(component);
            expect(cloned.priority).toBe(25);
            expect(cloned.enabled).toBe(false);
            expect(cloned.value).toBe(5);
            expect(cloned.name).toBe('test');

            cloned._internalDestroy();
        });
    });

    describe('reset functionality', () => {
        it('should reset component to initial state', async () => {
            await component._internalAwake();
            await component._internalStart();

            component.enabled = false;
            component.priority = 100;
            component.value = 999;
            component.name = 'modified';

            component.reset();

            expect(component.state).toBe('uninitialized');
            expect(component.enabled).toBe(true);
            expect(component.priority).toBe(100); // Priority is not reset
            expect(component.value).toBe(0);
            expect(component.name).toBe('');
        });

        it('should not reset destroyed component', async () => {
            await component._internalDestroy();

            expect(() => component.reset()).not.toThrow();
            expect(component.state).toBe('destroyed');
        });
    });

    describe('metrics and debugging', () => {
        it('should provide metrics when enabled', () => {
            const metricsComp = new TestComponent();
            (metricsComp as any)._enableMetrics = true;

            const metrics = metricsComp.metrics;

            expect(metrics).toBeDefined();
            expect(metrics).toHaveProperty('creationTime');
            expect(metrics).toHaveProperty('lastUpdateTime');
            expect(metrics).toHaveProperty('updateCallCount');
            expect(metrics).toHaveProperty('averageUpdateTime');
            expect(metrics).toHaveProperty('memoryUsage');

            metricsComp._internalDestroy();
        });

        it('should return null metrics when disabled', () => {
            expect(component.metrics).toBeNull();
        });

        it('should provide debug information', () => {
            const debugInfo = component.getDebugInfo();

            expect(debugInfo).toHaveProperty('id');
            expect(debugInfo).toHaveProperty('type');
            expect(debugInfo).toHaveProperty('state');
            expect(debugInfo).toHaveProperty('enabled');
            expect(debugInfo).toHaveProperty('priority');
            expect(debugInfo).toHaveProperty('validationErrors');
        });

        it('should provide string representation', () => {
            const str = component.toString();

            expect(str).toContain('TestComponent');
            expect(str).toContain(component.id);
            expect(str).toContain('uninitialized');
            expect(str).toContain('enabled');
        });
    });

    describe('cleanup and memory management', () => {
        it('should cleanup properly on destroy', async () => {
            await component._internalAwake();
            await component._internalStart();

            const cleanupSpy = vi.fn();
            component.addCleanupTask(cleanupSpy);

            await component._internalDestroy();

            expect(component.state).toBe('destroyed');
            expect(component.name).toBe('destroyed');
            expect(cleanupSpy).toHaveBeenCalled();
        });

        it('should handle cleanup task management', async () => {
            const task1 = vi.fn();
            const task2 = vi.fn();

            component.addCleanupTask(task1);
            component.addCleanupTask(task2);
            component.removeCleanupTask(task1);

            await component._internalDestroy();

            expect(task1).not.toHaveBeenCalled();
            expect(task2).toHaveBeenCalled();
        });

        it('should handle multiple destroy calls', async () => {
            await component._internalDestroy();

            expect(() => component._internalDestroy()).not.toThrow();
            expect(component.state).toBe('destroyed');
        });
    });

    describe('error handling', () => {
        it('should handle lifecycle errors gracefully', async () => {
            const errorComponent = new (class extends Component {
                awake(): void {
                    throw new Error('Awake error');
                }
            })();

            await expect(errorComponent._internalAwake()).rejects.toThrow('Awake failed');
            expect(errorComponent.state).toBe('uninitialized');

            errorComponent._internalDestroy();
        });

        it('should handle async lifecycle errors', async () => {
            const asyncErrorComponent = new (class extends Component {
                async start(): Promise<void> {
                    throw new Error('Async start error');
                }
            })();

            await asyncErrorComponent._internalAwake();
            await expect(asyncErrorComponent._internalStart()).rejects.toThrow('Start failed');
            expect(asyncErrorComponent.state).toBe('awake');

            asyncErrorComponent._internalDestroy();
        });

        it('should handle enable/disable errors', async () => {
            const errorComponent = new (class extends Component {
                onEnable(): void {
                    throw new Error('Enable error');
                }
            })();

            await errorComponent._internalAwake();

            // Start should fail because onEnable throws
            await expect(errorComponent._internalStart()).rejects.toThrow('Start failed');

            errorComponent._internalDestroy();
        });
    });

    describe('performance', () => {
        it('should handle rapid state changes', async () => {
            await component._internalAwake();
            await component._internalStart();

            const iterations = 1000;
            const startTime = performance.now();

            for (let i = 0; i < iterations; i++) {
                component.enabled = i % 2 === 0;
                component.priority = i;
                component._internalUpdate(0.001);
            }

            const endTime = performance.now();
            expect(endTime - startTime).toBeLessThan(100);
        });

        it('should handle many components efficiently', () => {
            const components: Component[] = [];
            const count = 1000;

            const startTime = performance.now();

            for (let i = 0; i < count; i++) {
                const comp = new TestComponent(i, `component_${i}`);
                components.push(comp);
            }

            const endTime = performance.now();
            expect(endTime - startTime).toBeLessThan(100);

            components.forEach((comp) => comp._internalDestroy());
        });
    });

    describe('edge cases', () => {
        it('should handle null and undefined values gracefully', () => {
            expect(() => {
                component.priority = null as any;
            }).toThrow();

            expect(() => {
                component.enabled = null as any;
            }).not.toThrow();

            expect(component.enabled).toBe(false);
        });

        it('should handle extreme priority values', () => {
            component.priority = Number.MAX_SAFE_INTEGER;
            expect(component.priority).toBe(Number.MAX_SAFE_INTEGER);

            component.priority = Number.MIN_SAFE_INTEGER;
            expect(component.priority).toBe(Number.MIN_SAFE_INTEGER);
        });

        it('should handle concurrent lifecycle operations', async () => {
            const promises = [
                component._internalAwake(),
                component._internalAwake(),
                component._internalAwake(),
            ];

            await Promise.all(promises);
            expect(component.state).toBe('awake');
        });
    });
});
