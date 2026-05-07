export type PlaygroundCameraPreset = 'perspective' | 'front' | 'top' | 'right';

export type VirtualProjectLanguage = 'typescript' | 'javascript';

export type VirtualProjectFile = {
	readonly path: string;
	readonly content: string;
	readonly language: VirtualProjectLanguage;
};

export type PlaygroundProjectMetadata = {
	readonly id: string;
	readonly name: string;
	readonly color: string;
	readonly description: string;
	readonly entryFile: string;
	readonly order?: number;
};

export type PlaygroundProjectRecord = PlaygroundProjectMetadata & {
	readonly files: readonly VirtualProjectFile[];
	readonly builtIn?: boolean;
};

export type PersistedProjectFiles = {
	readonly version: 1;
	readonly files: Readonly<Record<string, string>>;
};