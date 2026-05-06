export type PlaygroundCameraPreset = 'perspective' | 'front' | 'top' | 'right';

export type PlaygroundSceneContext = {
	readonly container: HTMLElement;
};

export type PlaygroundStats = {
	readonly objectCount: number;
	readonly summary?: string;
};

export interface PlaygroundSceneHandle {
	dispose(): void | Promise<void>;
	setPlaying?(playing: boolean): void;
	setWireframe?(enabled: boolean): void;
	setGridVisible?(visible: boolean): void;
	setAxesVisible?(visible: boolean): void;
	setCameraPreset?(preset: PlaygroundCameraPreset): void;
	getStats?(): PlaygroundStats;
}

export interface PlaygroundSceneExample {
	readonly id: string;
	readonly title: string;
	readonly description: string;
	mount(
		context: PlaygroundSceneContext,
	): PlaygroundSceneHandle | Promise<PlaygroundSceneHandle | void> | void;
}