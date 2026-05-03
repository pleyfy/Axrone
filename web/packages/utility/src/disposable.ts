export interface Disposable {
    dispose(): void;
}

export interface IDisposable extends Disposable {
    readonly isDisposed: boolean;
}
