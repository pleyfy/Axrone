export interface IBindableTarget<TReturn = void> {
    bind(unit?: number): TReturn;
    unbind(): TReturn;
}
