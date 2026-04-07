import { ECSObservables } from '../../component-system/observers/ecs-observer';
import type { Entity, ComponentRegistry } from '../../component-system/types/core';
import { Actor } from '../../component-system/core/actor';
import { World } from '../../component-system/core/world';
import { Component } from '../../component-system/core/component';
import { Transform } from '../../component-system/components/transform';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

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

describe('ECSObservables', () => {
    let observables: ECSObservables<any>;
    let world: World<any>;
    let mockEntity: Entity;
    let mockActor: Actor;

    beforeEach(() => {
        const registry = {
            TestComponent,
            PositionComponent,
            Transform,
        };

        world = new World(registry);
        observables = new ECSObservables();
        mockEntity = 1 as Entity;
        mockActor = new Actor(world, { name: 'TestActor' });
    });

    afterEach(() => {
        observables.dispose();
        world.clear();
    });

    describe('entity lifecycle observables', () => {
        it('should notify entity creation', () => {
            const createdEntities: Array<{ entity: Entity; actor: Actor }> = [];

            observables.entityCreated.addObserver((data) => {
                createdEntities.push(data);
            });

            const testData = { entity: mockEntity, actor: mockActor };
            observables.entityCreated.notify(testData);

            expect(createdEntities).toHaveLength(1);
            expect(createdEntities[0]).toEqual(testData);
        });

        it('should notify entity destruction', () => {
            const destroyedEntities: Array<{ entity: Entity; actor: Actor }> = [];

            observables.entityDestroyed.addObserver((data) => {
                destroyedEntities.push(data);
            });

            const testData = { entity: mockEntity, actor: mockActor };
            observables.entityDestroyed.notify(testData);

            expect(destroyedEntities).toHaveLength(1);
            expect(destroyedEntities[0]).toEqual(testData);
        });

        it('should handle multiple entity lifecycle observers', () => {
            let createdCount = 0;
            let destroyedCount = 0;

            observables.entityCreated.addObserver(() => {
                createdCount++;
            });
            observables.entityCreated.addObserver(() => {
                createdCount++;
            });
            observables.entityDestroyed.addObserver(() => {
                destroyedCount++;
            });

            observables.entityCreated.notify({ entity: mockEntity, actor: mockActor });
            observables.entityDestroyed.notify({ entity: mockEntity, actor: mockActor });

            expect(createdCount).toBe(2);
            expect(destroyedCount).toBe(1);
        });
    });

    describe('component observables', () => {
        it('should create component observables on demand', () => {
            const componentObs = observables.getComponentObservables('TestComponent');

            expect(componentObs).toBeDefined();
            expect(componentObs.added).toBeDefined();
            expect(componentObs.removed).toBeDefined();
        });

        it('should return same observable instance for same component', () => {
            const obs1 = observables.getComponentObservables('TestComponent');
            const obs2 = observables.getComponentObservables('TestComponent');

            expect(obs1).toBe(obs2);
        });

        it('should notify component addition', () => {
            const addedComponents: any[] = [];
            const componentObs = observables.getComponentObservables('TestComponent');

            componentObs.added.addObserver((data) => {
                addedComponents.push(data);
            });

            const testComponent = new TestComponent(42);
            const testData = { entity: mockEntity, component: testComponent, actor: mockActor };
            componentObs.added.notify(testData);

            expect(addedComponents).toHaveLength(1);
            expect(addedComponents[0]).toEqual(testData);
        });

        it('should notify component removal', () => {
            const removedComponents: any[] = [];
            const componentObs = observables.getComponentObservables('TestComponent');

            componentObs.removed.addObserver((data) => {
                removedComponents.push(data);
            });

            const testComponent = new TestComponent(42);
            const testData = { entity: mockEntity, component: testComponent, actor: mockActor };
            componentObs.removed.notify(testData);

            expect(removedComponents).toHaveLength(1);
            expect(removedComponents[0]).toEqual(testData);
        });
    });

    describe('system execution observables', () => {
        it('should notify system execution start', () => {
            const executions: Array<{ systemId: string; deltaTime: number }> = [];

            observables.systemExecutionStart.addObserver((data) => {
                executions.push(data);
            });

            const testData = { systemId: 'TestSystem', deltaTime: 16.67 };
            observables.systemExecutionStart.notify(testData);

            expect(executions).toHaveLength(1);
            expect(executions[0]).toEqual(testData);
        });

        it('should notify system execution end', () => {
            const executions: Array<{ systemId: string; deltaTime: number; duration: number }> = [];

            observables.systemExecutionEnd.addObserver((data) => {
                executions.push(data);
            });

            const testData = { systemId: 'TestSystem', deltaTime: 16.67, duration: 2.5 };
            observables.systemExecutionEnd.notify(testData);

            expect(executions).toHaveLength(1);
            expect(executions[0]).toEqual(testData);
        });

        it('should track system performance metrics', () => {
            const startTimes: number[] = [];
            const endTimes: number[] = [];
            const durations: number[] = [];

            observables.systemExecutionStart.addObserver(({ deltaTime }) => {
                startTimes.push(deltaTime);
            });

            observables.systemExecutionEnd.addObserver(({ deltaTime, duration }) => {
                endTimes.push(deltaTime);
                durations.push(duration);
            });

            observables.systemExecutionStart.notify({ systemId: 'System1', deltaTime: 16.67 });
            observables.systemExecutionEnd.notify({
                systemId: 'System1',
                deltaTime: 16.67,
                duration: 1.2,
            });

            expect(startTimes).toEqual([16.67]);
            expect(endTimes).toEqual([16.67]);
            expect(durations).toEqual([1.2]);
        });
    });

    describe('frame observables', () => {
        it('should notify frame start', () => {
            const frames: Array<{ frameId: number; timestamp: number }> = [];

            observables.frameStart.addObserver((data) => {
                frames.push(data);
            });

            const testData = { frameId: 1, timestamp: performance.now() };
            observables.frameStart.notify(testData);

            expect(frames).toHaveLength(1);
            expect(frames[0]).toEqual(testData);
        });

        it('should notify frame end', () => {
            const frames: Array<{ frameId: number; timestamp: number; duration: number }> = [];

            observables.frameEnd.addObserver((data) => {
                frames.push(data);
            });

            const testData = { frameId: 1, timestamp: performance.now(), duration: 16.67 };
            observables.frameEnd.notify(testData);

            expect(frames).toHaveLength(1);
            expect(frames[0]).toEqual(testData);
        });

        it('should track frame performance', () => {
            let frameCount = 0;
            let totalDuration = 0;

            observables.frameStart.addObserver(() => {
                frameCount++;
            });
            observables.frameEnd.addObserver(({ duration }) => {
                totalDuration += duration;
            });

            for (let i = 0; i < 5; i++) {
                observables.frameStart.notify({ frameId: i, timestamp: performance.now() });
                observables.frameEnd.notify({
                    frameId: i,
                    timestamp: performance.now(),
                    duration: 16.67,
                });
            }

            expect(frameCount).toBe(5);
            expect(totalDuration).toBeCloseTo(83.35, 1);
        });
    });

    describe('query observables', () => {
        it('should create query observable with initial value', async () => {
            const initialValue = [{ entity: mockEntity, components: {} }];
            const queryObs = observables.getQueryObservable('TestQuery', initialValue);

            let receivedValue: any = null;
            queryObs.addObserver((data) => {
                receivedValue = data;
            });

            await sleep(0);
            expect(receivedValue).toEqual(initialValue);
        });

        it('should return same observable for same query key', () => {
            const obs1 = observables.getQueryObservable('TestQuery');
            const obs2 = observables.getQueryObservable('TestQuery');

            expect(obs1).toBe(obs2);
        });

        it('should update query observable', async () => {
            const queryObs = observables.getQueryObservable<any>('TestQuery', []);
            const updates: any[][] = [];

            queryObs.addObserver((data) => {
                updates.push(data);
            });

            const newData = [
                { entity: mockEntity, components: { TestComponent: new TestComponent() } },
            ];

            setTimeout(() => {
                queryObs.notify(newData);
            }, 10);

            await sleep(30);
            expect(updates).toHaveLength(2);
            expect(updates[0]).toEqual([]);
            expect(updates[1]).toEqual(newData);
        });
    });

    describe('entity filtering', () => {
        it('should filter entities by predicate', () => {
            const filteredEntities: Array<{ entity: Entity; actor: Actor }> = [];

            const filtered = observables.createEntityFilter(
                ({ actor }) => actor.name === 'SpecialActor'
            );
            filtered.addObserver((data) => {
                filteredEntities.push(data);
            });

            const specialActor = new Actor(world, { name: 'SpecialActor' });
            const normalActor = new Actor(world, { name: 'NormalActor' });

            observables.entityCreated.notify({ entity: 1 as Entity, actor: specialActor });
            observables.entityCreated.notify({ entity: 2 as Entity, actor: normalActor });

            expect(filteredEntities).toHaveLength(1);
            expect(filteredEntities[0].actor.name).toBe('SpecialActor');
        });

        it('should handle complex filtering predicates', () => {
            const filteredEntities: Array<{ entity: Entity; actor: Actor }> = [];

            const filtered = observables.createEntityFilter(
                ({ actor, entity }) => actor.name.startsWith('Test') && entity > 5
            );
            filtered.addObserver((data) => {
                filteredEntities.push(data);
            });

            const testActor1 = new Actor(world, { name: 'TestActor1' });
            const testActor2 = new Actor(world, { name: 'TestActor2' });
            const otherActor = new Actor(world, { name: 'OtherActor' });

            observables.entityCreated.notify({ entity: 3 as Entity, actor: testActor1 });
            observables.entityCreated.notify({ entity: 10 as Entity, actor: testActor2 });
            observables.entityCreated.notify({ entity: 15 as Entity, actor: otherActor });

            expect(filteredEntities).toHaveLength(1);
            expect(filteredEntities[0].entity).toBe(10);
        });
    });

    describe('component streams', () => {
        it('should create component stream with all events', () => {
            const stream = observables.createComponentStream('TestComponent');
            const changes: any[] = [];

            stream.changes.addObserver((data) => {
                changes.push(data);
            });

            const testComponent = new TestComponent(42);
            const testData = { entity: mockEntity, component: testComponent, actor: mockActor };

            stream.added.notify(testData);
            stream.removed.notify(testData);

            expect(changes).toHaveLength(2);
            expect(changes[0]).toEqual({ ...testData, action: 'added' });
            expect(changes[1]).toEqual({ ...testData, action: 'removed' });
        });

        it('should separate added and removed events', () => {
            const stream = observables.createComponentStream('TestComponent');
            const addedEvents: any[] = [];
            const removedEvents: any[] = [];

            stream.added.addObserver((data) => {
                addedEvents.push(data);
            });
            stream.removed.addObserver((data) => {
                removedEvents.push(data);
            });

            const testComponent = new TestComponent(42);
            const testData = { entity: mockEntity, component: testComponent, actor: mockActor };

            stream.added.notify(testData);
            stream.added.notify(testData);
            stream.removed.notify(testData);

            expect(addedEvents).toHaveLength(2);
            expect(removedEvents).toHaveLength(1);
        });
    });

    describe('debounced queries', () => {
        it('should debounce query updates', async () => {
            const queryObs = observables.getQueryObservable<number>('TestQuery', []);
            const debounced = observables.createDebouncedQuery<number>('TestQuery', 50);
            const updates: any[][] = [];

            debounced.addObserver((data) => {
                updates.push(data);
            });

            queryObs.notify([1]);
            queryObs.notify([1, 2]);
            queryObs.notify([1, 2, 3]);

            await sleep(100);
            expect(updates).toHaveLength(1);
            expect(updates[0]).toEqual([1, 2, 3]);
        });

        it('should handle rapid debounced updates', async () => {
            const queryObs = observables.getQueryObservable<number>('TestQuery', []);
            const debounced = observables.createDebouncedQuery<number>('TestQuery', 25);
            let updateCount = 0;

            debounced.addObserver(() => {
                updateCount++;
            });

            for (let i = 0; i < 10; i++) {
                setTimeout(() => queryObs.notify([i]), i * 5);
            }

            await sleep(120);
            expect(updateCount).toBe(1);
        });
    });

    describe('throttled queries', () => {
        it('should throttle query updates', async () => {
            const queryObs = observables.getQueryObservable<number>('TestQuery', []);
            const throttled = observables.createThrottledQuery<number>('TestQuery', 50);
            const updates: any[][] = [];

            throttled.addObserver((data) => {
                updates.push(data);
            });

            queryObs.notify([1]);
            queryObs.notify([1, 2]);
            queryObs.notify([1, 2, 3]);

            await sleep(30);
            expect(updates).toHaveLength(1);
            expect(updates[0]).toEqual([1]);
        });

        it('should allow updates after throttle period', async () => {
            const queryObs = observables.getQueryObservable<number>('TestQuery', []);
            const throttled = observables.createThrottledQuery<number>('TestQuery', 30);
            const updates: any[][] = [];

            throttled.addObserver((data) => {
                updates.push(data);
            });

            queryObs.notify([1]);

            setTimeout(() => {
                queryObs.notify([2]);
            }, 50);

            await sleep(120);
            expect(updates).toHaveLength(2);
            expect(updates[0]).toEqual([1]);
            expect(updates[1]).toEqual([2]);
        });
    });

    describe('entity lifecycle streams', () => {
        it('should create comprehensive entity lifecycle stream', () => {
            const lifecycle = observables.createEntityLifecycle();
            const allEvents: any[] = [];

            lifecycle.all.addObserver((data) => {
                allEvents.push(data);
            });

            observables.entityCreated.notify({ entity: mockEntity, actor: mockActor });
            observables.entityDestroyed.notify({ entity: mockEntity, actor: mockActor });

            expect(allEvents).toHaveLength(2);
            expect(allEvents[0]).toEqual({
                entity: mockEntity,
                actor: mockActor,
                action: 'created',
            });
            expect(allEvents[1]).toEqual({
                entity: mockEntity,
                actor: mockActor,
                action: 'destroyed',
            });
        });

        it('should filter by actor name', () => {
            const lifecycle = observables.createEntityLifecycle();
            const namedEvents: any[] = [];

            const namedStream = lifecycle.byName('SpecialActor');
            namedStream.created.addObserver((data) => {
                namedEvents.push(data);
            });

            const specialActor = new Actor(world, { name: 'SpecialActor' });
            const normalActor = new Actor(world, { name: 'NormalActor' });

            observables.entityCreated.notify({ entity: 1 as Entity, actor: specialActor });
            observables.entityCreated.notify({ entity: 2 as Entity, actor: normalActor });

            expect(namedEvents).toHaveLength(1);
            expect(namedEvents[0].actor.name).toBe('SpecialActor');
        });

        it('should filter by actor tag', () => {
            const lifecycle = observables.createEntityLifecycle();
            const taggedEvents: any[] = [];

            const taggedStream = lifecycle.byTag('enemy');
            taggedStream.created.addObserver((data) => {
                taggedEvents.push(data);
            });

            const enemyActor = new Actor(world, { tag: 'enemy' as any });
            const playerActor = new Actor(world, { tag: 'player' as any });

            observables.entityCreated.notify({ entity: 1 as Entity, actor: enemyActor });
            observables.entityCreated.notify({ entity: 2 as Entity, actor: playerActor });

            expect(taggedEvents).toHaveLength(1);
            expect(taggedEvents[0].actor.tag).toBe('enemy');
        });

        it('should filter by actor layer', () => {
            const lifecycle = observables.createEntityLifecycle();
            const layeredEvents: any[] = [];

            const layeredStream = lifecycle.byLayer(5);
            layeredStream.created.addObserver((data) => {
                layeredEvents.push(data);
            });

            const layer5Actor = new Actor(world, { layer: 5 as any });
            const layer1Actor = new Actor(world, { layer: 1 as any });

            observables.entityCreated.notify({ entity: 1 as Entity, actor: layer5Actor });
            observables.entityCreated.notify({ entity: 2 as Entity, actor: layer1Actor });

            expect(layeredEvents).toHaveLength(1);
            expect(layeredEvents[0].actor.layer).toBe(5);
        });
    });

    describe('disposal and cleanup', () => {
        it('should dispose all observables', () => {
            const componentObs = observables.getComponentObservables('TestComponent');
            const queryObs = observables.getQueryObservable('TestQuery');

            let disposedCount = 0;
            const originalDispose = componentObs.added.dispose;
            componentObs.added.dispose = () => {
                disposedCount++;
                originalDispose.call(componentObs.added);
            };

            observables.dispose();

            expect(disposedCount).toBeGreaterThan(0);
        });

        it('should clear all internal maps on disposal', () => {
            observables.getComponentObservables('TestComponent');
            observables.getQueryObservable('TestQuery');

            observables.dispose();

            const newComponentObs = observables.getComponentObservables('TestComponent');
            expect(newComponentObs).toBeDefined();
        });

        it('should handle disposal of empty observables', () => {
            expect(() => observables.dispose()).not.toThrow();
        });
    });

    describe('performance and memory', () => {
        it('should handle many observers efficiently', () => {
            const observerCount = 5;
            const startTime = performance.now();

            for (let i = 0; i < observerCount; i++) {
                observables.entityCreated.addObserver(() => {});
            }

            observables.entityCreated.notify({ entity: mockEntity, actor: mockActor });

            const endTime = performance.now();
            expect(endTime - startTime).toBeLessThan(100);
        });

        it('should handle rapid event notifications', () => {
            let eventCount = 0;
            observables.entityCreated.addObserver(() => {
                eventCount++;
            });

            const startTime = performance.now();
            const notifications = 5;

            for (let i = 0; i < notifications; i++) {
                observables.entityCreated.notify({ entity: i as Entity, actor: mockActor });
            }

            const endTime = performance.now();
            expect(eventCount).toBe(notifications);
            expect(endTime - startTime).toBeLessThan(200);
        });
    });
});
