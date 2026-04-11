import {
    createBehaviorSubject as createBaseBehaviorSubject,
    createSubject as createBaseSubject,
    type IObservableSubject as BaseObservableSubject,
    type ObserverOptions,
} from '@axrone/observer';

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

const coerceObserverOptions = (options: unknown): ObserverOptions | undefined => {
    if (options && typeof options === 'object') {
        return options as ObserverOptions;
    }

    return undefined;
};

class ObservableSubjectAdapter<T> implements IObservableSubject<T> {
    readonly id = `ecs-subject-${nextSubjectId++}`;

    private _completed = false;
    private _disposed = false;

    constructor(private readonly _subject: BaseObservableSubject<T>) {}

    addObserver(callback: ObserverCallback<T>, options?: unknown): UnobserveFn {
        if (this._disposed || this._completed) {
            return () => {};
        }

        const unsubscribe = this._subject.addObserver(
            (data) => callback(data),
            coerceObserverOptions(options)
        );

        return () => {
            unsubscribe();
        };
    }

    async notify(data: T): Promise<void> {
        if (this._disposed || this._completed) {
            return;
        }

        try {
            await this._subject.notify(data);
        } catch (error) {
            console.error('Observer notification failed:', error);
        }
    }

    notifySync(data: T): void {
        if (this._disposed || this._completed) {
            return;
        }

        try {
            this._subject.notifySync(data);
        } catch (error) {
            console.error('Observer notification failed:', error);
        }
    }

    complete(): void {
        if (this._disposed) {
            return;
        }

        this._completed = true;
        void this._subject.complete();
    }

    error(error: unknown): void {
        console.error('Observable subject error:', error);
        this.complete();
    }

    dispose(): void {
        if (this._disposed) {
            return;
        }

        this._disposed = true;
        this._completed = true;
        this._subject.dispose();
    }
}

export const createSubject = <T>(): IObservableSubject<T> =>
    new ObservableSubjectAdapter<T>(createBaseSubject<T>());

export const createBehaviorSubject = <T>(initialValue: T): IObservableSubject<T> =>
    new ObservableSubjectAdapter<T>(createBaseBehaviorSubject<T>(initialValue));