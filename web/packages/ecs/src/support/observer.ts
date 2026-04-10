export type ObserverCallback<T> = (data: T) => void | Promise<void>;
export type UnobserveFn = () => void;

export interface IObservableSubject<T> {
    readonly id: string;
    addObserver(callback: ObserverCallback<T>, options?: unknown): UnobserveFn;
    notify(data: T): Promise<void>;
    notifySync(data: T): void;
    complete(): void;
    error(error: unknown): void;
    dispose(): void;
}

let nextSubjectId = 1;

class ObservableSubject<T> implements IObservableSubject<T> {
    readonly id = `ecs-subject-${nextSubjectId++}`;

    protected readonly _observers = new Set<ObserverCallback<T>>();
    protected _completed = false;
    protected _disposed = false;

    addObserver(callback: ObserverCallback<T>, _options?: unknown): UnobserveFn {
        if (this._disposed || this._completed) {
            return () => {};
        }

        this._observers.add(callback);
        return () => {
            this._observers.delete(callback);
        };
    }

    async notify(data: T): Promise<void> {
        if (this._disposed || this._completed) {
            return;
        }

        const pendingNotifications: Promise<void>[] = [];
        for (const observer of [...this._observers]) {
            try {
                pendingNotifications.push(Promise.resolve(observer(data)).then(() => {}));
            } catch (error) {
                console.error('Observer notification failed:', error);
            }
        }

        await Promise.all(pendingNotifications);
    }

    notifySync(data: T): void {
        if (this._disposed || this._completed) {
            return;
        }

        for (const observer of [...this._observers]) {
            try {
                void observer(data);
            } catch (error) {
                console.error('Observer notification failed:', error);
            }
        }
    }

    complete(): void {
        if (this._disposed) {
            return;
        }

        this._completed = true;
        this._observers.clear();
    }

    error(error: unknown): void {
        console.error('Observable subject error:', error);
        this.complete();
    }

    dispose(): void {
        this._disposed = true;
        this._completed = true;
        this._observers.clear();
    }
}

class BehaviorObservableSubject<T> extends ObservableSubject<T> {
    private _version = 0;

    constructor(private _currentValue: T) {
        super();
    }

    override addObserver(callback: ObserverCallback<T>, options?: unknown): UnobserveFn {
        const unsubscribe = super.addObserver(callback, options);
        if (!this._disposed && !this._completed) {
            const currentValue = this._currentValue;
            const replayVersion = this._version;
            queueMicrotask(() => {
                if (
                    this._disposed ||
                    this._completed ||
                    !this._observers.has(callback) ||
                    replayVersion !== this._version
                ) {
                    return;
                }

                try {
                    void callback(currentValue);
                } catch (error) {
                    console.error('Behavior observer replay failed:', error);
                }
            });
        }
        return unsubscribe;
    }

    override async notify(data: T): Promise<void> {
        this._currentValue = data;
        this._version += 1;
        await super.notify(data);
    }

    override notifySync(data: T): void {
        this._currentValue = data;
        this._version += 1;
        super.notifySync(data);
    }
}

export const createSubject = <T>(): IObservableSubject<T> => new ObservableSubject<T>();

export const createBehaviorSubject = <T>(initialValue: T): IObservableSubject<T> =>
    new BehaviorObservableSubject<T>(initialValue);