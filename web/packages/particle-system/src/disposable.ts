export interface IDisposable {
    dispose(): void;
    readonly isDisposed: boolean;
}
