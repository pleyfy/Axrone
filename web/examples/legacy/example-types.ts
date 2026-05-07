export interface ExampleHandle {
    dispose(): void | Promise<void>;
}

export interface ExampleContext {
    readonly container: HTMLElement;
}

export interface SceneExample {
    readonly id: string;
    readonly title: string;
    readonly description: string;
    readonly tags?: readonly string[];
    readonly order?: number;
    mount(context: ExampleContext): void | ExampleHandle | Promise<void | ExampleHandle>;
}
