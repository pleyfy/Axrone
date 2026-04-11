import {
    ObserverCallback,
    UnobserveFn,
    ObserverId,
    SubjectId,
    ObserverOptions,
    IObservableSubject,
} from './definition';
import { IObserverChain, ISubjectGroup, IObserverConnection } from './interfaces';
import { Subject } from './subject';
import { createSubject } from './factory';

export class ObserverChain<T = any> implements IObserverChain<T> {
    readonly #subject: IObservableSubject<T>;
    readonly #operations: Array<{
        type: 'filter' | 'map' | 'debounce' | 'throttle' | 'buffer' | 'take' | 'takeUntil';
        fn?: Function;
        value?: any;
    }> = [];

    constructor(subject: IObservableSubject<T>) {
        this.#subject = subject;
    }

    filter(predicate: (data: T, subject: IObservableSubject<T>) => boolean): IObserverChain<T> {
        this.#operations.push({ type: 'filter', fn: predicate });
        return this;
    }

    map<U>(transform: (data: T, subject: IObservableSubject<T>) => U): IObserverChain<U> {
        this.#operations.push({ type: 'map', fn: transform });
        return this as any;
    }

    debounce(ms: number): IObserverChain<T> {
        this.#operations.push({ type: 'debounce', value: ms });
        return this;
    }

    throttle(ms: number): IObserverChain<T> {
        this.#operations.push({ type: 'throttle', value: ms });
        return this;
    }

    buffer(maxSize: number, flushIntervalMs: number): IObserverChain<T[]> {
        this.#operations.push({ type: 'buffer', value: { maxSize, flushIntervalMs } });
        return this as any;
    }

    take(count: number): IObserverChain<T> {
        this.#operations.push({ type: 'take', value: count });
        return this;
    }

    takeUntil(predicate: (data: T, subject: IObservableSubject<T>) => boolean): IObserverChain<T> {
        this.#operations.push({ type: 'takeUntil', fn: predicate });
        return this;
    }

    subscribe(callback: ObserverCallback<T>): UnobserveFn {
        const options: Partial<ObserverOptions> = {};
        let transformFn: Function | undefined;
        let filterFn: Function | undefined;
        let takeCount = 0;
        let takeUntilFn: Function | undefined;

        for (const op of this.#operations) {
            switch (op.type) {
                case 'filter':
                    filterFn = this.#combineFilters(filterFn, op.fn!);
                    break;
                case 'map':
                    transformFn = this.#combineTransforms(transformFn, op.fn!);
                    break;
                case 'debounce':
                    (options as any).debounceMs = op.value;
                    break;
                case 'throttle':
                    (options as any).throttleMs = op.value;
                    break;
                case 'buffer':
                    (options as any).buffering = {
                        enabled: true,
                        maxSize: op.value.maxSize,
                        flushIntervalMs: op.value.flushIntervalMs,
                    };
                    break;
                case 'take':
                    takeCount = op.value;
                    break;
                case 'takeUntil':
                    takeUntilFn = op.fn!;
                    break;
            }
        }

        if (filterFn) {
            (options as any).filter = filterFn;
        }

        if (transformFn) {
            (options as any).transform = transformFn;
        }

        let wrappedCallback = callback;
        let callCount = 0;
        let unsubscribe: UnobserveFn | undefined;

        if (takeCount > 0 || takeUntilFn) {
            wrappedCallback = (data: T, subject: IObservableSubject<T>) => {
                callCount++;

                if (takeUntilFn && takeUntilFn(data, subject)) {
                    unsubscribe?.();
                    return;
                }

                callback(data, subject);

                if (takeCount > 0 && callCount >= takeCount) {
                    unsubscribe?.();
                }
            };
        }

        unsubscribe = this.#subject.addObserver(wrappedCallback, options);
        return unsubscribe;
    }

    #combineFilters(existing: Function | undefined, newFilter: Function): Function {
        if (!existing) return newFilter;
        return (data: any, subject: any) => existing(data, subject) && newFilter(data, subject);
    }

    #combineTransforms(existing: Function | undefined, newTransform: Function): Function {
        if (!existing) return newTransform;
        return async (data: any, subject: any) => {
            const result = existing(data, subject);
            const intermediate = result instanceof Promise ? await result : result;
            return newTransform(intermediate, subject);
        };
    }
}

export class SubjectGroup<T = any> implements ISubjectGroup<T> {
    readonly #subjects = new Map<SubjectId, IObservableSubject<T>>();

    get subjects(): ReadonlyArray<IObservableSubject<T>> {
        return Array.from(this.#subjects.values());
    }

    add(subject: IObservableSubject<T>): void {
        this.#subjects.set(subject.id, subject);
    }

    remove(subject: IObservableSubject<T>): boolean {
        return this.#subjects.delete(subject.id);
    }

    removeById(subjectId: SubjectId): boolean {
        return this.#subjects.delete(subjectId);
    }

    async notifyAll(data: T): Promise<boolean[]> {
        const promises = Array.from(this.#subjects.values()).map((subject) => subject.notify(data));
        return Promise.all(promises);
    }

    notifyAllSync(data: T): boolean[] {
        return Array.from(this.#subjects.values()).map((subject) => subject.notifySync(data));
    }

    async completeAll(): Promise<void> {
        const promises = Array.from(this.#subjects.values()).map((subject) => subject.complete());
        await Promise.all(promises);
    }

    disposeAll(): void {
        for (const subject of this.#subjects.values()) {
            subject.dispose();
        }
        this.#subjects.clear();
    }

    addObserver(observer: ObserverCallback<T>, options?: ObserverOptions): UnobserveFn[] {
        const unsubscribers = Array.from(this.#subjects.values()).map((subject) =>
            subject.addObserver(observer, options)
        );

        return unsubscribers;
    }

    merge(): IObservableSubject<T> {
        const mergedSubject = createSubject<T>();
        const unsubscribers: UnobserveFn[] = [];

        for (const subject of this.#subjects.values()) {
            const unsubscribe = subject.addObserver((data) => {
                mergedSubject.notify(data);
            });
            unsubscribers.push(unsubscribe);
        }

        const originalDispose = mergedSubject.dispose.bind(mergedSubject);
        mergedSubject.dispose = () => {
            unsubscribers.forEach((unsub) => unsub());
            originalDispose();
        };

        return mergedSubject;
    }

    combineLatest(): IObservableSubject<T[]> {
        const combinedSubject = createSubject<T[]>();
        const latestValues = new Map<SubjectId, T>();
        const hasEmitted = new Set<SubjectId>();

        for (const subject of this.#subjects.values()) {
            subject.addObserver((data) => {
                latestValues.set(subject.id, data);
                hasEmitted.add(subject.id);

                if (hasEmitted.size === this.#subjects.size) {
                    const values = Array.from(this.#subjects.values()).map(
                        (s) => latestValues.get(s.id)!
                    );
                    combinedSubject.notify(values);
                }
            });
        }

        return combinedSubject;
    }
}

export class ObserverConnection<TSource = any, TTarget = any>
    implements IObserverConnection<TSource, TTarget>
{
    readonly source: IObservableSubject<TSource>;
    readonly target: IObservableSubject<TTarget>;
    readonly transform?: (data: TSource) => TTarget | Promise<TTarget>;
    #unsubscribe?: UnobserveFn;
    #isConnected = false;

    constructor(
        source: IObservableSubject<TSource>,
        target: IObservableSubject<TTarget>,
        transform?: (data: TSource) => TTarget | Promise<TTarget>
    ) {
        this.source = source;
        this.target = target;
        this.transform = transform;
    }

    get isConnected(): boolean {
        return this.#isConnected;
    }

    connect(): void {
        if (this.#isConnected) {
            return;
        }

        this.#unsubscribe = this.source.addObserver(async (data) => {
            try {
                const transformedData = this.transform ? await this.transform(data) : (data as any);
                await this.target.notify(transformedData);
            } catch (error) {
                await this.target.error(error as Error);
            }
        });

        this.#isConnected = true;
    }

    disconnect(): void {
        if (!this.#isConnected || !this.#unsubscribe) {
            return;
        }

        this.#unsubscribe();
        this.#unsubscribe = undefined;
        this.#isConnected = false;
    }

    dispose(): void {
        this.disconnect();
    }
}

export function chain<T>(subject: IObservableSubject<T>): IObserverChain<T> {
    return new ObserverChain<T>(subject);
}

export function group<T>(...subjects: IObservableSubject<T>[]): ISubjectGroup<T> {
    const subjectGroup = new SubjectGroup<T>();
    for (const subject of subjects) {
        subjectGroup.add(subject);
    }
    return subjectGroup;
}

export function connect<TSource, TTarget>(
    source: IObservableSubject<TSource>,
    target: IObservableSubject<TTarget>,
    transform?: (data: TSource) => TTarget | Promise<TTarget>
): IObserverConnection<TSource, TTarget> {
    return new ObserverConnection(source, target, transform);
}

export function pipe<T, U>(
    source: IObservableSubject<T>,
    transform: (data: T) => U | Promise<U>
): IObservableSubject<U> {
    const target = createSubject<U>();
    const connection = connect(source, target, transform);
    connection.connect();
    return target;
}

export function merge<T>(...subjects: IObservableSubject<T>[]): IObservableSubject<T> {
    return group(...subjects).merge();
}

export function combineLatest<T>(...subjects: IObservableSubject<T>[]): IObservableSubject<T[]> {
    return group(...subjects).combineLatest();
}

export function filter<T>(
    source: IObservableSubject<T>,
    predicate: (data: T) => boolean
): IObservableSubject<T> {
    return pipe(source, (data) => (predicate(data) ? data : (undefined as any)));
}

export function map<T, U>(
    source: IObservableSubject<T>,
    transform: (data: T) => U
): IObservableSubject<U> {
    return pipe(source, transform);
}

export function debounce<T>(source: IObservableSubject<T>, ms: number): IObservableSubject<T> {
    const target = createSubject<T>();
    let timeoutId: ReturnType<typeof setTimeout>;

    source.addObserver((data) => {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
            target.notify(data);
        }, ms);
    });

    return target;
}

export function throttle<T>(source: IObservableSubject<T>, ms: number): IObservableSubject<T> {
    const target = createSubject<T>();
    let lastEmission = 0;

    source.addObserver((data) => {
        const now = Date.now();
        if (now - lastEmission >= ms) {
            lastEmission = now;
            target.notify(data);
        }
    });

    return target;
}
