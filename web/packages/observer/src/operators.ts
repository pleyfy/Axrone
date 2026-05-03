import {
    ObserverCallback,
    ObserverOptions,
    SubjectId,
    IObservableSubject,
    UnobserveFn,
} from './definition';
import { createSubject } from './factory';
import { IObserverChain, IObserverConnection, ISubjectGroup } from './interfaces';

type TimeoutHandle = ReturnType<typeof setTimeout>;

type FilterOperation = {
    readonly type: 'filter';
    readonly predicate: (data: unknown, subject: IObservableSubject<any>) => boolean;
};

type MapOperation = {
    readonly type: 'map';
    readonly transform: (data: unknown, subject: IObservableSubject<any>) => unknown;
};

type DebounceOperation = {
    readonly type: 'debounce';
    readonly ms: number;
};

type ThrottleOperation = {
    readonly type: 'throttle';
    readonly ms: number;
};

type BufferOperation = {
    readonly type: 'buffer';
    readonly maxSize: number;
    readonly flushIntervalMs: number;
};

type TakeOperation = {
    readonly type: 'take';
    readonly count: number;
};

type TakeUntilOperation = {
    readonly type: 'takeUntil';
    readonly predicate: (data: unknown, subject: IObservableSubject<any>) => boolean;
};

type ChainOperation =
    | FilterOperation
    | MapOperation
    | DebounceOperation
    | ThrottleOperation
    | BufferOperation
    | TakeOperation
    | TakeUntilOperation;

const isPromiseLike = <T = unknown>(value: unknown): value is PromiseLike<T> =>
    typeof value === 'object' &&
    value !== null &&
    'then' in value &&
    typeof (value as PromiseLike<T>).then === 'function';

const attachCleanup = <T>(subject: IObservableSubject<T>, cleanup: () => void): IObservableSubject<T> => {
    const originalDispose = subject.dispose.bind(subject);
    let cleaned = false;

    subject.dispose = () => {
        if (!cleaned) {
            cleaned = true;
            cleanup();
        }

        originalDispose();
    };

    return subject;
};

export class ObserverChain<T = any> implements IObserverChain<T> {
    readonly #subject: IObservableSubject<any>;
    readonly #operations: ChainOperation[] = [];

    constructor(subject: IObservableSubject<T>) {
        this.#subject = subject as IObservableSubject<any>;
    }

    filter(predicate: (data: T, subject: IObservableSubject<T>) => boolean): IObserverChain<T> {
        this.#operations.push({
            type: 'filter',
            predicate: predicate as FilterOperation['predicate'],
        });
        return this;
    }

    map<U>(transform: (data: T, subject: IObservableSubject<T>) => U): IObserverChain<U> {
        this.#operations.push({
            type: 'map',
            transform: transform as MapOperation['transform'],
        });
        return this as unknown as IObserverChain<U>;
    }

    debounce(ms: number): IObserverChain<T> {
        this.#operations.push({
            type: 'debounce',
            ms: Math.max(0, Math.floor(ms)),
        });
        return this;
    }

    throttle(ms: number): IObserverChain<T> {
        this.#operations.push({
            type: 'throttle',
            ms: Math.max(0, Math.floor(ms)),
        });
        return this;
    }

    buffer(maxSize: number, flushIntervalMs: number): IObserverChain<T[]> {
        this.#operations.push({
            type: 'buffer',
            maxSize: Math.max(1, Math.floor(maxSize)),
            flushIntervalMs: Math.max(1, Math.floor(flushIntervalMs)),
        });
        return this as unknown as IObserverChain<T[]>;
    }

    take(count: number): IObserverChain<T> {
        this.#operations.push({
            type: 'take',
            count: Math.max(0, Math.floor(count)),
        });
        return this;
    }

    takeUntil(predicate: (data: T, subject: IObservableSubject<T>) => boolean): IObserverChain<T> {
        this.#operations.push({
            type: 'takeUntil',
            predicate: predicate as TakeUntilOperation['predicate'],
        });
        return this;
    }

    subscribe(callback: ObserverCallback<T>): UnobserveFn {
        const operations = this.#operations.slice();
        const debounceTimers = new Map<number, TimeoutHandle>();
        const throttleTimes = new Map<number, number>();
        const takeRemaining = new Map<number, number>();
        const bufferStates = new Map<
            number,
            {
                values: unknown[];
                stopAfter: boolean;
                timer?: TimeoutHandle;
            }
        >();
        let active = true;
        let unsubscribe: UnobserveFn | undefined;

        for (let index = 0; index < operations.length; index++) {
            const operation = operations[index];
            if (operation?.type === 'take') {
                takeRemaining.set(index, operation.count);
            } else if (operation?.type === 'buffer') {
                bufferStates.set(index, {
                    values: [],
                    stopAfter: false,
                });
            }
        }

        const cleanup = (): void => {
            for (const timer of debounceTimers.values()) {
                clearTimeout(timer);
            }

            debounceTimers.clear();

            for (const state of bufferStates.values()) {
                if (state.timer) {
                    clearTimeout(state.timer);
                    state.timer = undefined;
                }
                state.values.length = 0;
                state.stopAfter = false;
            }

            bufferStates.clear();
            throttleTimes.clear();
        };

        const stop = (): boolean => {
            if (!active) {
                return false;
            }

            active = false;
            cleanup();
            const release = unsubscribe;
            unsubscribe = undefined;
            return release ? release() : false;
        };

        const finalize = (
            value: unknown,
            subject: IObservableSubject<any>,
            stopAfter: boolean
        ): void => {
            try {
                const result = (callback as ObserverCallback<any>)(value, subject);
                if (isPromiseLike(result)) {
                    void Promise.resolve(result).catch(() => undefined);
                }
            } finally {
                if (stopAfter) {
                    stop();
                }
            }
        };

        const process = (
            index: number,
            value: unknown,
            subject: IObservableSubject<any>,
            stopAfter: boolean
        ): void => {
            if (!active) {
                return;
            }

            if (index >= operations.length) {
                finalize(value, subject, stopAfter);
                return;
            }

            const operation = operations[index];
            if (!operation) {
                finalize(value, subject, stopAfter);
                return;
            }

            switch (operation.type) {
                case 'filter':
                    if (!operation.predicate(value, subject)) {
                        return;
                    }
                    process(index + 1, value, subject, stopAfter);
                    return;

                case 'map':
                    process(index + 1, operation.transform(value, subject), subject, stopAfter);
                    return;

                case 'debounce': {
                    const existingTimer = debounceTimers.get(index);
                    if (existingTimer) {
                        clearTimeout(existingTimer);
                    }

                    const timer = setTimeout(() => {
                        debounceTimers.delete(index);
                        process(index + 1, value, subject, stopAfter);
                    }, operation.ms);

                    debounceTimers.set(index, timer);
                    return;
                }

                case 'throttle': {
                    const now = Date.now();
                    const lastExecution = throttleTimes.get(index) ?? 0;
                    if (now - lastExecution < operation.ms) {
                        return;
                    }

                    throttleTimes.set(index, now);
                    process(index + 1, value, subject, stopAfter);
                    return;
                }

                case 'buffer': {
                    const state = bufferStates.get(index);
                    if (!state) {
                        return;
                    }

                    state.values.push(value);
                    state.stopAfter = state.stopAfter || stopAfter;

                    const flush = (): void => {
                        if (!active || state.values.length === 0) {
                            return;
                        }

                        const batch = state.values.slice();
                        const nextStopAfter = state.stopAfter;
                        state.values.length = 0;
                        state.stopAfter = false;
                        if (state.timer) {
                            clearTimeout(state.timer);
                            state.timer = undefined;
                        }
                        process(index + 1, batch, subject, nextStopAfter);
                    };

                    if (state.values.length >= operation.maxSize) {
                        flush();
                        return;
                    }

                    if (!state.timer) {
                        state.timer = setTimeout(flush, operation.flushIntervalMs);
                    }
                    return;
                }

                case 'take': {
                    const remaining = takeRemaining.get(index) ?? 0;
                    if (remaining <= 0) {
                        stop();
                        return;
                    }

                    takeRemaining.set(index, remaining - 1);
                    process(index + 1, value, subject, stopAfter || remaining === 1);
                    return;
                }

                case 'takeUntil':
                    if (operation.predicate(value, subject)) {
                        stop();
                        return;
                    }
                    process(index + 1, value, subject, stopAfter);
                    return;
            }
        };

        unsubscribe = this.#subject.addObserver((data, subject) => {
            process(0, data, subject, false);
        });

        return stop;
    }
}

export class SubjectGroup<T = any> implements ISubjectGroup<T> {
    readonly #subjects = new Map<SubjectId, IObservableSubject<T>>();

    get subjects(): ReadonlyArray<IObservableSubject<T>> {
        return [...this.#subjects.values()];
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
        return Promise.all([...this.#subjects.values()].map((subject) => subject.notify(data)));
    }

    notifyAllSync(data: T): boolean[] {
        return [...this.#subjects.values()].map((subject) => subject.notifySync(data));
    }

    async completeAll(): Promise<void> {
        await Promise.all([...this.#subjects.values()].map((subject) => subject.complete()));
    }

    disposeAll(): void {
        for (const subject of this.#subjects.values()) {
            subject.dispose();
        }

        this.#subjects.clear();
    }

    addObserver(observer: ObserverCallback<T>, options?: ObserverOptions<T>): UnobserveFn[] {
        return [...this.#subjects.values()].map((subject) => subject.addObserver(observer, options));
    }

    merge(): IObservableSubject<T> {
        const merged = createSubject<T>();
        const unsubs = [...this.#subjects.values()].map((subject) =>
            subject.addObserver((data) => {
                void merged.notify(data).catch(() => undefined);
            })
        );

        return attachCleanup(merged, () => {
            for (const unsubscribe of unsubs) {
                unsubscribe();
            }
        });
    }

    combineLatest(): IObservableSubject<T[]> {
        const combined = createSubject<T[]>();
        const subjects = [...this.#subjects.values()];
        const latest = new Map<SubjectId, T>();
        const emitted = new Set<SubjectId>();
        const unsubs = subjects.map((subject) =>
            subject.addObserver((data) => {
                latest.set(subject.id, data);
                emitted.add(subject.id);

                if (emitted.size === subjects.length) {
                    const values = subjects.map((entry) => latest.get(entry.id) as T);
                    void combined.notify(values).catch(() => undefined);
                }
            })
        );

        return attachCleanup(combined, () => {
            for (const unsubscribe of unsubs) {
                unsubscribe();
            }
        });
    }
}

export class ObserverConnection<TSource = any, TTarget = any>
    implements IObserverConnection<TSource, TTarget>
{
    readonly source: IObservableSubject<TSource>;
    readonly target: IObservableSubject<TTarget>;
    readonly transform?: (data: TSource) => TTarget | Promise<TTarget>;
    #unsubscribe?: UnobserveFn;
    #connected = false;

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
        return this.#connected;
    }

    connect(): void {
        if (this.#connected) {
            return;
        }

        this.#unsubscribe = this.source.addObserver(async (data) => {
            try {
                const next = this.transform ? await this.transform(data) : (data as unknown as TTarget);
                await this.target.notify(next);
            } catch (error) {
                await this.target.error(error instanceof Error ? error : new Error(String(error)));
            }
        });

        this.#connected = true;
    }

    disconnect(): void {
        if (!this.#connected) {
            return;
        }

        this.#connected = false;
        const unsubscribe = this.#unsubscribe;
        this.#unsubscribe = undefined;
        unsubscribe?.();
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
    const unsubscribe = source.addObserver(async (data) => {
        try {
            await target.notify(await transform(data));
        } catch (error) {
            await target.error(error instanceof Error ? error : new Error(String(error)));
        }
    });

    return attachCleanup(target, () => {
        unsubscribe();
    });
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
    const target = createSubject<T>();
    const unsubscribe = source.addObserver((data) => {
        if (predicate(data)) {
            void target.notify(data).catch(() => undefined);
        }
    });

    return attachCleanup(target, () => {
        unsubscribe();
    });
}

export function map<T, U>(
    source: IObservableSubject<T>,
    transform: (data: T) => U
): IObservableSubject<U> {
    return pipe(source, transform);
}

export function debounce<T>(source: IObservableSubject<T>, ms: number): IObservableSubject<T> {
    const target = createSubject<T>();
    let timer: TimeoutHandle | undefined;
    const unsubscribe = source.addObserver((data) => {
        if (timer) {
            clearTimeout(timer);
        }

        timer = setTimeout(() => {
            timer = undefined;
            void target.notify(data).catch(() => undefined);
        }, Math.max(0, Math.floor(ms)));
    });

    return attachCleanup(target, () => {
        if (timer) {
            clearTimeout(timer);
            timer = undefined;
        }
        unsubscribe();
    });
}

export function throttle<T>(source: IObservableSubject<T>, ms: number): IObservableSubject<T> {
    const target = createSubject<T>();
    const interval = Math.max(0, Math.floor(ms));
    let lastEmission = 0;
    const unsubscribe = source.addObserver((data) => {
        const now = Date.now();
        if (now - lastEmission < interval) {
            return;
        }

        lastEmission = now;
        void target.notify(data).catch(() => undefined);
    });

    return attachCleanup(target, () => {
        unsubscribe();
    });
}
