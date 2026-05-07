import type {
	PlaygroundProjectMetadata,
	PlaygroundProjectRecord,
	VirtualProjectFile,
	VirtualProjectLanguage,
} from './types';

type ProjectModule = {
	readonly default: PlaygroundProjectMetadata;
};

const metadataLoaders = import.meta.glob('../projects/*/project.ts') as Record<
	string,
	() => Promise<ProjectModule>
>;
const sourceLoaders = import.meta.glob('../projects/**/*.{ts,js}', {
	query: '?raw',
	import: 'default',
}) as Record<string, () => Promise<string>>;

const normalizePath = (value: string): string => value.replace(/\\/g, '/');

const resolveLanguage = (path: string): VirtualProjectLanguage =>
	path.endsWith('.js') ? 'javascript' : 'typescript';

const resolveProjectIdFromPath = (value: string): string => {
	const normalized = normalizePath(value);
	const match = normalized.match(/\.\.\/projects\/([^/]+)\//);
	if (!match?.[1]) {
		throw new Error(`Unable to resolve project id from ${value}`);
	}

	return match[1];
};

export const loadProjectCatalog = async (): Promise<readonly PlaygroundProjectRecord[]> => {
	const metadataEntries = await Promise.all(
		Object.entries(metadataLoaders).map(async ([path, loadModule]) => {
			const projectId = resolveProjectIdFromPath(path);
			const module = await loadModule();
			return [projectId, module.default] as const;
		}),
	);

	const metadataById = new Map(metadataEntries);
	const filesByProjectId = new Map<string, VirtualProjectFile[]>();

	await Promise.all(
		Object.entries(sourceLoaders).map(async ([path, loadSource]) => {
			if (path.endsWith('/project.ts') || path.includes('/projects/shared/')) {
				return;
			}

			const projectId = resolveProjectIdFromPath(path);
			const source = await loadSource();
			const relativePath = normalizePath(path).replace(`../projects/${projectId}/`, '');

			const list = filesByProjectId.get(projectId) ?? [];
			list.push({
				path: relativePath,
				content: source,
				language: resolveLanguage(relativePath),
			});
			filesByProjectId.set(projectId, list);
		}),
	);

	return [...metadataById.entries()]
		.map(([projectId, metadata]) => ({
			...metadata,
			files: (filesByProjectId.get(projectId) ?? []).sort((left, right) => {
				if (left.path === metadata.entryFile) {
					return -1;
				}

				if (right.path === metadata.entryFile) {
					return 1;
				}

				return left.path.localeCompare(right.path);
			}),
			builtIn: true,
		}))
		.sort((left, right) => {
			const orderDelta = (left.order ?? Number.MAX_SAFE_INTEGER) - (right.order ?? Number.MAX_SAFE_INTEGER);
			if (orderDelta !== 0) {
				return orderDelta;
			}

			return left.name.localeCompare(right.name);
		});
};