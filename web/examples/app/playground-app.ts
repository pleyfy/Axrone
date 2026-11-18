import type { LiveEditorController } from '../playground/tooling-entry';
import type { PlaygroundSceneHandle } from '../projects/shared/playground-types';
import { loadProjectCatalog } from './project-catalog';
import { renderPlaygroundShell, type PlaygroundShell } from './shell';
import type {
	PersistedProjectFiles,
	PlaygroundCameraPreset,
	PlaygroundProjectRecord,
	VirtualProjectFile,
} from './types';

type ConsoleTone = 'log' | 'info' | 'warn' | 'error' | 'success';
type ConsoleTab = 'console' | 'problems' | 'output';
type ExamplesScope = 'all' | 'builtin' | 'user';
type ConsoleEntry = {
	readonly tone: ConsoleTone;
	readonly message: string;
	readonly time: string;
};
type FileVisualKind =
	| 'main'
	| 'scene'
	| 'data'
	| 'project'
	| 'palette'
	| 'code'
	| 'json'
	| 'shader'
	| 'style'
	| 'markup'
	| 'doc'
	| 'image'
	| 'audio'
	| 'video'
	| 'model'
	| 'default';
type FileVisual = {
	readonly color: string;
	readonly kind: FileVisualKind;
};
type FileTreeFileNode = {
	readonly kind: 'file';
	readonly name: string;
	readonly path: string;
	readonly order: number;
};
type FileTreeFolderNode = {
	readonly kind: 'folder';
	readonly name: string;
	readonly key: string;
	readonly order: number;
	readonly children: Map<string, FileTreeNode>;
};
type FileTreeNode = FileTreeFileNode | FileTreeFolderNode;
type RuntimeSession = {
	readonly projectId: string;
	readonly handle: PlaygroundSceneHandle;
	readonly summary?: string;
	readonly objectCount: number;
};
type MutablePlaygroundProject = Omit<PlaygroundProjectRecord, 'files'> & {
	files: VirtualProjectFile[];
};

type PlaygroundToolingModule = typeof import('../playground/tooling-entry');

const sourceStoragePrefix = 'axrone:examples:vfs:';
let playgroundToolingPromise: Promise<PlaygroundToolingModule> | undefined;

const loadPlaygroundTooling = async (): Promise<PlaygroundToolingModule> => {
	playgroundToolingPromise ??= import('../playground/tooling-entry');
	return playgroundToolingPromise;
};

const cloneFiles = (files: readonly VirtualProjectFile[]): VirtualProjectFile[] =>
	files.map((file) => ({ ...file }));

const resolveStorageKey = (projectId: string): string => `${sourceStoragePrefix}${projectId}`;

const parsePersistedProjectFiles = (value: string | null): PersistedProjectFiles | undefined => {
	if (!value) {
		return undefined;
	}

	try {
		const parsed = JSON.parse(value) as Partial<PersistedProjectFiles>;
		if (parsed.version !== 1 || typeof parsed.files !== 'object' || !parsed.files) {
			return undefined;
		}

		return parsed as PersistedProjectFiles;
	} catch {
		return undefined;
	}
};

const formatTime = (): string =>
	new Date().toLocaleTimeString('en-US', {
		hour12: false,
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
	});

const escapeHtml = (value: string): string =>
	value.replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char] ?? char));

const resolveToneClass = (tone: ConsoleTone): string => {
	switch (tone) {
		case 'info':
			return 'console-message--info';
		case 'warn':
			return 'console-message--warn';
		case 'error':
			return 'console-message--error';
		case 'success':
			return 'console-message--success';
		default:
			return 'console-message--default';
	}
};

const createProjectFilesMap = (files: readonly VirtualProjectFile[]): Record<string, string> =>
	Object.fromEntries(files.map((file) => [file.path, file.content]));

const resolveLanguageLabel = (path: string): string => {
	const ext = path.split('.').pop()?.toLowerCase();
	switch (ext) {
		case 'js':
		case 'jsx':
			return 'JavaScript';
		case 'json':
			return 'JSON';
		case 'glsl':
		case 'wgsl':
			return 'Shader';
		case 'css':
		case 'scss':
			return 'Stylesheet';
		case 'html':
			return 'HTML';
		case 'md':
			return 'Markdown';
		case 'yaml':
		case 'yml':
			return 'YAML';
		case 'ts':
		case 'tsx':
		default:
			return 'TypeScript';
	}
};

const resolveCameraPresetLabel = (preset: PlaygroundCameraPreset): string => {
	switch (preset) {
		case 'front':
			return 'Front';
		case 'top':
			return 'Top';
		case 'right':
			return 'Right';
		default:
			return 'Perspective';
	}
};

const createFileIcon = (size: number, innerMarkup: string): string => `
	<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
		<path d="M14.5 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7.5L14.5 3z"></path>
		<path d="M14 3v5h5"></path>
		${innerMarkup}
	</svg>
`;

const createFolderIcon = (size: number): string => `
	<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
		<path d="M3.5 7.5a2 2 0 0 1 2-2H9l2 2h7.5a2 2 0 0 1 2 2v1.5H3.5z"></path>
		<path d="M3.5 9h17v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"></path>
	</svg>
`;

const createChevronIcon = (size: number): string => `
	<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
		<path d="M9 18l6-6-6-6"></path>
	</svg>
`;

const renderVisualIcon = (visual: FileVisual, size: number): string => {
	switch (visual.kind) {
		case 'main':
			return createFileIcon(size, '<path d="M10 10.2v5.6l4.6-2.8-4.6-2.8z" fill="currentColor" stroke="none"></path>');
		case 'scene':
			return createFileIcon(size, '<rect x="8" y="10.5" width="3" height="3" rx="0.6"></rect><rect x="13" y="10.5" width="3" height="3" rx="0.6"></rect><rect x="8" y="15.2" width="3" height="3" rx="0.6"></rect><rect x="13" y="15.2" width="3" height="3" rx="0.6"></rect>');
		case 'data':
			return createFileIcon(size, '<path d="M8 11.2h8"></path><path d="M8 14h8"></path><path d="M8 16.8h5.5"></path>');
		case 'project':
			return createFileIcon(size, '<path d="M8 11.5h8"></path><path d="M8 15.5h8"></path><circle cx="10.5" cy="11.5" r="1"></circle><circle cx="13.5" cy="15.5" r="1"></circle>');
		case 'palette':
			return createFileIcon(size, '<path d="M12 10.2a3.7 3.7 0 0 0 0 7.4h.9a1.2 1.2 0 0 0 1.05-1.78l-.28-.48a1.1 1.1 0 0 1 .94-1.65H15a2.8 2.8 0 0 0 0-5.6z"></path><circle cx="9.1" cy="12.1" r=".65" fill="currentColor" stroke="none"></circle><circle cx="10.6" cy="10.8" r=".65" fill="currentColor" stroke="none"></circle><circle cx="12.7" cy="10.6" r=".65" fill="currentColor" stroke="none"></circle>');
		case 'json':
			return createFileIcon(size, '<path d="M10 10.5c-.9 0-1.5.6-1.5 1.5v.3c0 .6-.3 1-.8 1.2.5.2.8.6.8 1.2v.3c0 .9.6 1.5 1.5 1.5"></path><path d="M14 10.5c.9 0 1.5.6 1.5 1.5v.3c0 .6.3 1 .8 1.2-.5.2-.8.6-.8 1.2v.3c0 .9-.6 1.5-1.5 1.5"></path>');
		case 'shader':
			return createFileIcon(size, '<path d="M12 10.1l.8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8z"></path>');
		case 'style':
			return createFileIcon(size, '<path d="M8.5 16.5c1.1 0 1.8-.7 1.8-1.8 0-.4-.1-.8-.4-1.1l4.9-4.9a1 1 0 0 0-1.4-1.4L8.5 12.2c-.3-.3-.7-.4-1.1-.4-1.1 0-1.8.7-1.8 1.8s.7 1.9 1.8 1.9z"></path><path d="M12.7 8.3l2 2"></path>');
		case 'markup':
			return createFileIcon(size, '<path d="M9.5 11.2 7.2 13.5l2.3 2.3"></path><path d="M14.5 11.2l2.3 2.3-2.3 2.3"></path><path d="M12.8 10.6 11.2 16.4"></path>');
		case 'doc':
			return createFileIcon(size, '<path d="M8.3 11.2h7.4"></path><path d="M8.3 14h7.4"></path><path d="M8.3 16.8h4.8"></path>');
		case 'image':
			return createFileIcon(size, '<circle cx="10" cy="10.7" r="1"></circle><path d="M8 17l3.1-3.1a1 1 0 0 1 1.4 0L16 17"></path><path d="M12.8 15.3l1.2-1.2a1 1 0 0 1 1.4 0l1.6 1.6"></path>');
		case 'audio':
			return createFileIcon(size, '<path d="M9 13.8h2.1l2.9-2.3v5.8L11.1 15H9z"></path><path d="M16.2 11.2a3.1 3.1 0 0 1 0 4.6"></path>');
		case 'video':
			return createFileIcon(size, '<rect x="8" y="10.5" width="8" height="5.6" rx="1"></rect><path d="M11.3 11.8v3l2.6-1.5-2.6-1.5z" fill="currentColor" stroke="none"></path>');
		case 'model':
			return createFileIcon(size, '<path d="M12 10l3.6 2.1v4.2L12 18.4l-3.6-2.1v-4.2z"></path><path d="M12 10v4.2"></path><path d="M8.4 12.1 12 14.2l3.6-2.1"></path>');
		case 'code':
			return createFileIcon(size, '<path d="M10 11.2 7.7 13.5 10 15.8"></path><path d="M14 11.2 16.3 13.5 14 15.8"></path>');
		default:
			return createFileIcon(size, '<path d="M8.3 11.2h7.4"></path><path d="M8.3 14h7.4"></path>');
	}
};

const resolveFileVisual = (path: string): FileVisual => {
	const fileName = path.split('/').pop()?.toLowerCase() ?? path.toLowerCase();
	const ext = fileName.split('.').pop()?.toLowerCase();

	if (/^main\./.test(fileName)) {
		return { kind: 'main', color: '#f59e0b' };
	}
	if (/^scene\./.test(fileName)) {
		return { kind: 'scene', color: '#10b981' };
	}
	if (/^project\./.test(fileName)) {
		return { kind: 'project', color: '#6366f1' };
	}
	if (fileName.includes('palette')) {
		return { kind: 'palette', color: '#8b5cf6' };
	}
	if (fileName.includes('data')) {
		return { kind: 'data', color: '#ec4899' };
	}

	switch (ext) {
		case 'ts':
		case 'tsx':
			return { kind: 'code', color: '#2563eb' };
		case 'js':
		case 'jsx':
			return { kind: 'code', color: '#f59e0b' };
		case 'json':
			return { kind: 'json', color: '#fb923c' };
		case 'glsl':
		case 'wgsl':
			return { kind: 'shader', color: '#06b6d4' };
		case 'css':
		case 'scss':
			return { kind: 'style', color: '#14b8a6' };
		case 'html':
			return { kind: 'markup', color: '#f43f5e' };
		case 'md':
		case 'txt':
			return { kind: 'doc', color: '#64748b' };
		case 'yaml':
		case 'yml':
			return { kind: 'project', color: '#6366f1' };
		case 'png':
		case 'jpg':
		case 'jpeg':
		case 'webp':
		case 'gif':
		case 'svg':
			return { kind: 'image', color: '#22c55e' };
		case 'mp3':
		case 'wav':
		case 'ogg':
			return { kind: 'audio', color: '#db2777' };
		case 'mp4':
		case 'webm':
			return { kind: 'video', color: '#ef4444' };
		case 'glb':
		case 'gltf':
		case 'fbx':
		case 'obj':
			return { kind: 'model', color: '#7c3aed' };
		default:
			return { kind: 'default', color: '#94a3b8' };
	}
};

const resolveProjectCategory = (project: PlaygroundProjectRecord): string =>
	project.category ?? (project.builtIn === false ? 'Your project' : 'Example');

const resolveProjectTags = (project: PlaygroundProjectRecord): readonly string[] => project.tags ?? [];

const renderExampleArt = (project: PlaygroundProjectRecord, variant: 'thumb' | 'hero'): string => {
	const accent = escapeHtml(project.color);
	const token = `${project.id.replace(/[^a-z0-9-]/gi, '-')}-${variant}`;
	const gridId = `art-grid-${token}`;
	const glowId = `art-glow-${token}`;
	const sphereId = `art-sphere-${token}`;

	const commonDefs = `
		<defs>
			<pattern id="${gridId}" width="20" height="20" patternUnits="userSpaceOnUse">
				<path d="M20 0H0v20" fill="none" stroke="#d9dce3" stroke-width=".5"></path>
			</pattern>
			<radialGradient id="${glowId}" cx="50%" cy="50%" r="50%">
				<stop offset="0" stop-color="${accent}" stop-opacity=".16"></stop>
				<stop offset="1" stop-color="${accent}" stop-opacity="0"></stop>
			</radialGradient>
			<radialGradient id="${sphereId}" cx="34%" cy="28%" r="80%">
				<stop offset="0" stop-color="#ffffff" stop-opacity=".92"></stop>
				<stop offset=".32" stop-color="${accent}" stop-opacity=".52"></stop>
				<stop offset="1" stop-color="${accent}"></stop>
			</radialGradient>
		</defs>
	`;

	const floor = `
		<g fill="none" stroke="#cdd2db" stroke-width=".7" opacity=".85">
			<path d="M160 70 20 180M160 70 80 180M160 70 140 180M160 70 180 180M160 70 240 180M160 70 300 180"></path>
			<path d="M24 144h272M44 159h232M68 173h184"></path>
		</g>
	`;

	const shadow = (cx: number, cy: number, rx: number): string =>
		`<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${Math.max(5, Math.round(rx * 0.22))}" fill="#0f172a" opacity=".06"></ellipse>`;

	const cube = (x: number, y: number, size = 28, opacity = 1): string => `
		<g transform="translate(${x} ${y})" opacity="${opacity}" stroke="${accent}" stroke-opacity=".45" stroke-width=".9">
			<polygon points="0,${-size * 0.57} ${size} ${-size * 1.14} ${size * 2} ${-size * 0.57} ${size} 0" fill="${accent}" fill-opacity=".12"></polygon>
			<polygon points="0,${-size * 0.57} ${size} 0 ${size} ${size * 1.14} 0 ${size * 0.57}" fill="${accent}" fill-opacity=".22"></polygon>
			<polygon points="${size} 0 ${size * 2} ${-size * 0.57} ${size * 2} ${size * 0.57} ${size} ${size * 1.14}" fill="${accent}" fill-opacity=".34"></polygon>
		</g>
	`;

	const sphere = (cx: number, cy: number, radius: number): string => `
		<circle cx="${cx}" cy="${cy}" r="${radius}" fill="url(#${sphereId})"></circle>
		<ellipse cx="${cx - radius * 0.32}" cy="${cy - radius * 0.34}" rx="${radius * 0.3}" ry="${radius * 0.17}" fill="#ffffff" opacity=".28" transform="rotate(-28 ${cx - radius * 0.32} ${cy - radius * 0.34})"></ellipse>
	`;

	const torus = (cx: number, cy: number): string => `
		<g transform="translate(${cx} ${cy})" fill="none" stroke="${accent}" stroke-linecap="round">
			<ellipse rx="25" ry="10.5" stroke-width="6.5" opacity=".82" transform="rotate(-26)"></ellipse>
			<ellipse rx="25" ry="10.5" stroke-width="6.5" opacity=".58" transform="rotate(30)"></ellipse>
			<ellipse rx="25" ry="10.5" stroke-width="6.5" opacity=".4" transform="rotate(88)"></ellipse>
		</g>
	`;

	let scene = '';

	switch (project.id) {
		case 'demo-scene':
			scene = `
				${floor}
				${shadow(98, 142, 40)}
				${shadow(168, 141, 36)}
				${shadow(246, 130, 32)}
				${cube(70, 115)}
				${sphere(168, 108, 28)}
				${torus(246, 105)}
			`;
			break;
		case 'solar-system':
			scene = `
				<g fill="${accent}">
					<circle cx="46" cy="42" r="1.2" opacity=".5"></circle>
					<circle cx="274" cy="32" r="1.5" opacity=".45"></circle>
					<circle cx="298" cy="138" r="1.1" opacity=".4"></circle>
					<circle cx="24" cy="104" r="1.3" opacity=".35"></circle>
					<circle cx="236" cy="56" r="1" opacity=".5"></circle>
					<circle cx="102" cy="34" r="1" opacity=".4"></circle>
				</g>
				<circle cx="160" cy="96" r="58" fill="url(#${glowId})"></circle>
				<g fill="none" stroke="${accent}">
					<ellipse cx="160" cy="98" rx="52" ry="18" stroke-opacity=".34"></ellipse>
					<ellipse cx="160" cy="98" rx="88" ry="31" stroke-opacity=".22"></ellipse>
					<ellipse cx="160" cy="98" rx="126" ry="44" stroke-opacity=".14"></ellipse>
				</g>
				<circle cx="160" cy="94" r="17" fill="#f59e0b"></circle>
				<circle cx="160" cy="94" r="24" fill="none" stroke="#f59e0b" stroke-opacity=".18"></circle>
				<circle cx="154" cy="88" r="5" fill="#ffffff" opacity=".28"></circle>
				<circle cx="211" cy="92" r="4" fill="${accent}"></circle>
				<circle cx="91" cy="105" r="5.5" fill="#0ea5e9"></circle>
				<circle cx="248" cy="117" r="3.5" fill="#f59e0b"></circle>
				<circle cx="61" cy="82" r="2.6" fill="#94a3b8"></circle>
			`;
			break;
		case 'particle-system':
			scene = `
				<circle cx="160" cy="96" r="70" fill="url(#${glowId})"></circle>
				<path d="M48 135C96 66 216 50 276 110" fill="none" stroke="${accent}" stroke-opacity=".18" stroke-dasharray="3 6"></path>
				<g fill="${accent}">
					<circle cx="88" cy="92" r="1.6" opacity=".35"></circle>
					<circle cx="104" cy="118" r="2.4" opacity=".55"></circle>
					<circle cx="120" cy="80" r="1.4" opacity=".35"></circle>
					<circle cx="128" cy="102" r="3.1" opacity=".8"></circle>
					<circle cx="136" cy="66" r="1.8" opacity=".45"></circle>
					<circle cx="144" cy="124" r="2.2" opacity=".5"></circle>
					<circle cx="152" cy="88" r="4.6" opacity=".95"></circle>
					<circle cx="160" cy="60" r="1.5" opacity=".4"></circle>
					<circle cx="168" cy="112" r="2.7" opacity=".62"></circle>
					<circle cx="176" cy="76" r="3.5" opacity=".8"></circle>
					<circle cx="184" cy="98" r="1.9" opacity=".45"></circle>
					<circle cx="192" cy="130" r="1.6" opacity=".35"></circle>
					<circle cx="202" cy="88" r="2.8" opacity=".66"></circle>
					<circle cx="212" cy="112" r="1.5" opacity=".38"></circle>
					<circle cx="224" cy="76" r="2.2" opacity=".52"></circle>
					<circle cx="236" cy="98" r="1.4" opacity=".32"></circle>
					<circle cx="248" cy="86" r="1.8" opacity=".42"></circle>
					<circle cx="82" cy="70" r="1.2" opacity=".3"></circle>
					<circle cx="262" cy="120" r="1.1" opacity=".28"></circle>
					<circle cx="156" cy="144" r="1.3" opacity=".3"></circle>
				</g>
				<circle cx="152" cy="88" r="8" fill="none" stroke="${accent}" stroke-opacity=".22"></circle>
				<circle cx="176" cy="76" r="6" fill="none" stroke="${accent}" stroke-opacity=".18"></circle>
			`;
			break;
		case 'follow-cube':
			scene = `
				${floor}
				<path d="M46 144C90 122 138 92 194 88" fill="none" stroke="${accent}" stroke-opacity=".4" stroke-width="1.4" stroke-dasharray="5 6"></path>
				<path d="m188 80 10 8-12 3" fill="none" stroke="${accent}" stroke-opacity=".55" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"></path>
				<g fill="none" stroke="#a8aeb9" stroke-width="1.1" opacity=".6">
					<path d="M18 34v14M18 34h14"></path>
					<path d="M302 34v14M302 34h-14"></path>
					<path d="M18 154v-14M18 154h14"></path>
					<path d="M302 154v-14M302 154h-14"></path>
				</g>
				${shadow(224, 136, 38)}
				${cube(196, 108, 28)}
				${sphere(88, 104, 10)}
			`;
			break;
		default:
			scene = `
				<g opacity=".9">
					<rect x="96" y="48" width="128" height="84" rx="10" fill="#ffffff" stroke="#d8dbe2"></rect>
					<rect x="110" y="63" width="58" height="8" rx="4" fill="${accent}" opacity=".26"></rect>
					<rect x="110" y="80" width="100" height="6" rx="3" fill="#c7ccd6"></rect>
					<rect x="110" y="94" width="78" height="6" rx="3" fill="#d7dbe3"></rect>
					<rect x="110" y="112" width="34" height="10" rx="5" fill="${accent}" opacity=".5"></rect>
					<circle cx="214" cy="60" r="10" fill="${accent}" opacity=".18"></circle>
					<circle cx="214" cy="60" r="4" fill="${accent}" opacity=".65"></circle>
				</g>
			`;
			break;
	}

	const isHero = variant === 'hero';
	const canvasWidth = isHero ? 640 : 320;
	const sceneMarkup = isHero ? `<g transform="translate(160 0)">${scene}</g>` : scene;

	return `
		<svg class="example-art" viewBox="${isHero ? '0 0 640 180' : '40 0 240 180'}" preserveAspectRatio="xMidYMid slice" role="img" aria-label="${escapeHtml(project.name)} preview">
			${commonDefs}
			<rect width="${canvasWidth}" height="180" fill="#f6f7f9"></rect>
			<rect width="${canvasWidth}" height="180" fill="url(#${gridId})" opacity=".65"></rect>
			<ellipse cx="${isHero ? 480 : 168}" cy="42" rx="150" ry="92" fill="url(#${glowId})"></ellipse>
			${sceneMarkup}
			<rect x=".5" y=".5" width="${canvasWidth - 1}" height="179" fill="none" stroke="#101828" stroke-opacity=".05"></rect>
		</svg>
	`;
};

const createFolderNode = (name: string, key: string, order: number): FileTreeFolderNode => ({
	kind: 'folder',
	name,
	key,
	order,
	children: new Map<string, FileTreeNode>(),
});

const buildFileTree = (
	files: readonly VirtualProjectFile[],
): { readonly root: FileTreeFolderNode; readonly folderCount: number } => {
	const root = createFolderNode('', '', -1);
	let folderCount = 0;

	files.forEach((file, order) => {
		const segments = file.path.split('/').filter(Boolean);
		if (segments.length === 0) {
			return;
		}

		let currentFolder = root;
		let currentKey = '';
		for (const segment of segments.slice(0, -1)) {
			currentKey = currentKey ? `${currentKey}/${segment}` : segment;
			const childKey = `folder:${segment}`;
			let child = currentFolder.children.get(childKey);
			if (!child || child.kind !== 'folder') {
				child = createFolderNode(segment, currentKey, order);
				currentFolder.children.set(childKey, child);
				folderCount += 1;
			}
			currentFolder = child;
		}

		const fileName = segments[segments.length - 1] ?? file.path;
		currentFolder.children.set(`file:${fileName}`, {
			kind: 'file',
			name: fileName,
			path: file.path,
			order,
		});
	});

	return { root, folderCount };
};

const renderTemplateCards = (shell: PlaygroundShell, selectedTemplateId: string): void => {
	const templates = [
		{ id: 'blank', name: 'Blank Scene', desc: 'An empty project with a single scene entry file.', accent: '#64748b', badge: 'AX' },
		{ id: 'basic', name: 'Basic Scene', desc: 'A starter project with a scene entry point to build on.', accent: '#2563eb', badge: '3D' },
	];

	shell.newProjectTemplates.innerHTML = templates
		.map(
			(template) => `
				<button type="button" data-template-id="${template.id}" class="template-card ${template.id === selectedTemplateId ? 'selected' : ''}" style="--template-accent:${template.accent}">
					<span class="template-card__icon">${template.badge}</span>
					<span class="template-card__body">
						<span class="template-card__title">${template.name}</span>
						<span class="template-card__desc">${template.desc}</span>
					</span>
				</button>
			`,
		)
		.join('');
};

export const startPlaygroundApp = async (root: HTMLElement): Promise<void> => {
	const shell = renderPlaygroundShell(root);
	window.scrollTo({ left: 0, top: 0, behavior: 'instant' });
	const projects: MutablePlaygroundProject[] = (await loadProjectCatalog()).map((project) => ({
		...project,
		files: cloneFiles(project.files),
	}));

	let currentProjectId = projects[0]?.id ?? '';
	let currentFilePath = projects[0]?.entryFile ?? '';
	let openTabs = currentFilePath ? [currentFilePath] : [];
	let editor: LiveEditorController | undefined;
	let runtimeSession: RuntimeSession | undefined;
	let examplesModalOpen = false;
	let examplesScope: ExamplesScope = 'all';
	let selectedExampleId = currentProjectId;
	let consoleVisible = true;
	let sidebarVisible = true;
	let verticalLayout = false;
	let playing = true;
	let wireframe = false;
	let gridVisible = true;
	let axesVisible = false;
	let activeConsoleTab: ConsoleTab = 'console';
	let selectedTemplateId = 'blank';
	const collapsedFolders = new Set<string>();
	const consoleEntries: ConsoleEntry[] = [];
	const problemEntries: ConsoleEntry[] = [];
	const outputEntries: ConsoleEntry[] = [];

	const getCurrentProject = (): MutablePlaygroundProject | undefined =>
		projects.find((project) => project.id === currentProjectId);

	const persistCurrentProject = (): void => {
		const project = getCurrentProject();
		if (!project || typeof localStorage === 'undefined') {
			return;
		}

		const payload: PersistedProjectFiles = {
			version: 1,
			files: createProjectFilesMap(project.files),
		};
		localStorage.setItem(resolveStorageKey(project.id), JSON.stringify(payload));
	};

	const hydrateProject = (project: MutablePlaygroundProject): MutablePlaygroundProject => {
		if (typeof localStorage === 'undefined') {
			return project;
		}

		const payload = parsePersistedProjectFiles(localStorage.getItem(resolveStorageKey(project.id)));
		if (!payload) {
			return project;
		}

		return {
			...project,
			files: project.files.map((file) => ({
				...file,
				content: payload.files[file.path] ?? file.content,
			})),
		};
	};

	for (let index = 0; index < projects.length; index += 1) {
		projects[index] = hydrateProject(projects[index]!);
	}

	const appendConsoleEntry = (target: ConsoleEntry[], tone: ConsoleTone, message: string): void => {
		target.push({ tone, message, time: formatTime() });
		renderConsoleOutput();
	};

	const setStatus = (text: string, tone: 'running' | 'error' | 'ready' | 'stopped'): void => {
		shell.statusText.textContent = text;
		shell.statusDot.className = `dot ${tone === 'running' ? 'on' : tone === 'error' ? 'er' : 'id'}`;
	};

	const renderConsoleOutput = (): void => {
		const source = activeConsoleTab === 'console' ? consoleEntries : activeConsoleTab === 'problems' ? problemEntries : outputEntries;
		shell.consoleOut.innerHTML = source
			.map(
				(entry) => `
					<div class="console-line fi">
						<span class="console-time">[${entry.time}]</span>
						<span class="console-message ${resolveToneClass(entry.tone)}">${escapeHtml(entry.message)}</span>
					</div>
				`,
			)
			.join('');
		shell.problemCount.textContent = String(problemEntries.length);
		shell.problemCount.classList.toggle('has-problems', problemEntries.length > 0);
	};

	const updatePlayIcon = (): void => {
		const playIcon = shell.playButton.querySelector<SVGElement>('#icon-play');
		const pauseIcon = shell.playButton.querySelector<SVGElement>('#icon-pause');
		if (playIcon && pauseIcon) {
			playIcon.style.display = playing ? 'none' : 'block';
			pauseIcon.style.display = playing ? 'block' : 'none';
		}
	};

	const updateControlState = (): void => {
		shell.wireframeButton.classList.toggle('active-t', wireframe);
		shell.gridButton.classList.toggle('active-t', gridVisible);
		shell.axesButton.classList.toggle('active-t', axesVisible);
		updatePlayIcon();
	};

	const updateRuntimeSummary = (): void => {
		shell.objectCountLabel.textContent = runtimeSession ? String(runtimeSession.objectCount) : '—';
		shell.ctrlInfo.textContent = runtimeSession?.summary ?? '—';
	};

	const stopCurrentRuntime = async (): Promise<void> => {
		const currentSession = runtimeSession;
		runtimeSession = undefined;
		updateRuntimeSummary();
		if (!currentSession) {
			shell.previewStage.replaceChildren();
			setStatus('Stopped', 'stopped');
			return;
		}

		await currentSession.handle.dispose();
		shell.previewStage.replaceChildren();
		setStatus('Stopped', 'stopped');
	};

	const runCurrentProject = async (): Promise<void> => {
		const project = getCurrentProject();
		if (!project) {
			appendConsoleEntry(problemEntries, 'error', 'No project is available to run.');
			return;
		}

		await stopCurrentRuntime();
		setStatus('Running', 'running');
		problemEntries.length = 0;
		renderConsoleOutput();
		shell.previewStage.replaceChildren();

		try {
			const { compileSceneProject } = await loadPlaygroundTooling();
			const sceneExample = compileSceneProject(createProjectFilesMap(project.files), project.entryFile);
			const mountResult = await sceneExample.mount({ container: shell.previewStage });
			const handle: PlaygroundSceneHandle = mountResult && typeof mountResult === 'object' && 'dispose' in mountResult
				? (mountResult as PlaygroundSceneHandle)
				: { dispose() {} };
			playing = true;
			wireframe = false;
			gridVisible = true;
			axesVisible = false;
			handle.setPlaying?.(true);
			handle.setWireframe?.(false);
			handle.setGridVisible?.(true);
			handle.setAxesVisible?.(false);
			const stats = handle.getStats?.();
			runtimeSession = {
				projectId: project.id,
				handle,
				objectCount: stats?.objectCount ?? 0,
				summary: stats?.summary,
			};
			updateControlState();
			updateRuntimeSummary();
			shell.ctrlBar.classList.add('visible');
			appendConsoleEntry(consoleEntries, 'success', `Scene started — ${project.name}`);
			appendConsoleEntry(outputEntries, 'info', `${sceneExample.title} loaded.`);
		} catch (error) {
			setStatus('Error', 'error');
			const message = error instanceof Error ? error.message : String(error);
			appendConsoleEntry(problemEntries, 'error', message);
			renderConsoleOutput();
		}
	};

	const getFilteredExamples = (): readonly PlaygroundProjectRecord[] => {
		const query = shell.examplesSearchInput.value.trim().toLowerCase();

		return projects.filter((project) => {
			if (examplesScope === 'builtin' && project.builtIn === false) {
				return false;
			}
			if (examplesScope === 'user' && project.builtIn !== false) {
				return false;
			}
			if (!query) {
				return true;
			}

			const haystack = [
				project.name,
				project.description,
				resolveProjectCategory(project),
				...resolveProjectTags(project),
			]
				.join(' ')
				.toLowerCase();
			return haystack.includes(query);
		});
	};

	const updateExamplesScopeState = (): void => {
		const counts: Record<ExamplesScope, number> = {
			all: projects.length,
			builtin: projects.filter((project) => project.builtIn !== false).length,
			user: projects.filter((project) => project.builtIn === false).length,
		};

		for (const item of shell.examplesScopeCounts) {
			const scope = item.dataset.scopeCount as ExamplesScope | undefined;
			if (scope) {
				item.textContent = String(counts[scope]);
			}
		}

		for (const button of shell.examplesScopeButtons) {
			const active = button.dataset.exampleScope === examplesScope;
			button.classList.toggle('is-active', active);
			button.setAttribute('aria-pressed', String(active));
		}
	};

	const renderExamplesDetail = (): void => {
		const project = projects.find((candidate) => candidate.id === selectedExampleId);
		if (!project) {
			shell.examplesDetail.innerHTML = `
				<div class="examples-detail__empty">
					<span class="examples-detail__empty-title">No example selected</span>
					<span class="examples-detail__empty-text">Choose a project from the list to preview its contents.</span>
				</div>
			`;
			return;
		}

		const tags = resolveProjectTags(project);
		const isCurrent = project.id === currentProjectId;
		const fileMarkup = project.files
			.map((file) => {
				const visual = resolveFileVisual(file.path);
				return `
					<div class="example-file">
						<span class="example-file__icon" style="color:${visual.color}">${renderVisualIcon(visual, 12)}</span>
						<span class="example-file__path">${escapeHtml(file.path)}</span>
						${file.path === project.entryFile ? '<span class="example-file__entry">entry</span>' : ''}
					</div>
				`;
			})
			.join('');

		shell.examplesDetail.innerHTML = `
			<div class="example-detail__hero">${renderExampleArt(project, 'hero')}</div>
			<div class="example-detail__content">
				<div class="example-detail__eyebrow-row">
					<span class="example-detail__eyebrow">${escapeHtml(resolveProjectCategory(project))}</span>
					${isCurrent ? '<span class="example-badge">Currently open</span>' : ''}
				</div>
				<h3 class="example-detail__title">${escapeHtml(project.name)}</h3>
				<p class="example-detail__description">${escapeHtml(project.description)}</p>
				${
					tags.length > 0
						? `<div class="tag-row">${tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}</div>`
						: ''
				}
				<dl class="example-meta">
					<div class="example-meta__item">
						<dt>Entry</dt>
						<dd>${escapeHtml(project.entryFile)}</dd>
					</div>
					<div class="example-meta__item">
						<dt>Files</dt>
						<dd>${project.files.length}</dd>
					</div>
					<div class="example-meta__item">
						<dt>Language</dt>
						<dd>${escapeHtml(resolveLanguageLabel(project.entryFile))}</dd>
					</div>
					<div class="example-meta__item">
						<dt>Source</dt>
						<dd>${project.builtIn === false ? 'Local' : 'Built-in'}</dd>
					</div>
				</dl>
				<div class="example-files">
					<div class="example-files__header">
						<span class="example-files__label">Project files</span>
						<span class="example-files__count">${project.files.length}</span>
					</div>
					${fileMarkup}
				</div>
			</div>
		`;
	};

	const renderExamplesList = (): void => {
		const filtered = getFilteredExamples();
		if (!filtered.some((project) => project.id === selectedExampleId)) {
			selectedExampleId = filtered[0]?.id ?? '';
		}

		shell.examplesList.innerHTML = filtered
			.map((project) => {
				const selected = project.id === selectedExampleId;
				const isCurrent = project.id === currentProjectId;
				return `
					<button
						type="button"
						class="example-row${selected ? ' is-selected' : ''}"
						data-example-id="${escapeHtml(project.id)}"
						aria-pressed="${selected}"
					>
						<span class="example-row__art">${renderExampleArt(project, 'thumb')}</span>
						<span class="example-row__body">
							<span class="example-row__title-row">
								<span class="example-row__title">${escapeHtml(project.name)}</span>
								${isCurrent ? '<span class="example-row__current"><span class="example-row__current-dot"></span>Open</span>' : ''}
							</span>
							<span class="example-row__meta">${escapeHtml(resolveProjectCategory(project))} <span class="example-row__meta-sep">·</span> ${project.files.length} files</span>
						</span>
					</button>
				`;
			})
			.join('');

		const hasResults = filtered.length > 0;
		shell.examplesList.hidden = !hasResults;
		shell.examplesEmpty.hidden = hasResults;
		shell.examplesCount.textContent = hasResults ? `${filtered.length} of ${projects.length}` : '0';
		shell.examplesOpenButton.disabled = !hasResults;
		updateExamplesScopeState();
		renderExamplesDetail();
	};

	const setExamplesScope = (scope: ExamplesScope): void => {
		examplesScope = scope;
		renderExamplesList();
	};

	const renderFileTree = (): void => {
		const project = getCurrentProject();
		if (!project) {
			shell.fileTree.innerHTML = '';
			shell.fileCountText.textContent = '0 files';
			return;
		}

		const { root: fileTree, folderCount } = buildFileTree(project.files);
		const folderContainsActivePath = (folder: FileTreeFolderNode): boolean =>
			[...folder.children.values()].some((child) =>
				child.kind === 'file' ? child.path === currentFilePath : folderContainsActivePath(child),
			);
		const renderNodes = (nodes: readonly FileTreeNode[], depth: number): string =>
			nodes
				.map((node) => {
					if (node.kind === 'folder') {
						const hasActiveDescendant = folderContainsActivePath(node);
						const expanded = hasActiveDescendant || !collapsedFolders.has(node.key);
						const childrenMarkup = expanded
							? renderNodes([...node.children.values()], depth + 1)
							: '';
						return `
							<div class="explorer-branch">
								<button
									type="button"
									class="explorer-item explorer-item--folder${hasActiveDescendant ? ' explorer-item--folder-current' : ''}"
									data-folder-path="${escapeHtml(node.key)}"
									data-expanded="${expanded ? 'true' : 'false'}"
									style="--tree-depth:${depth}"
								>
									<span class="explorer-item__chevron">${createChevronIcon(10)}</span>
									<span class="explorer-item__icon explorer-item__icon--folder" style="color:#94a3b8">${createFolderIcon(14)}</span>
									<span class="explorer-item__label">${escapeHtml(node.name)}</span>
								</button>
								${childrenMarkup ? `<div class="explorer-children">${childrenMarkup}</div>` : ''}
							</div>
						`;
					}

					const active = node.path === currentFilePath;
					const visual = resolveFileVisual(node.path);
					return `
						<div class="explorer-item explorer-item--file${active ? ' active' : ''}" data-file-path="${escapeHtml(node.path)}" style="--tree-depth:${depth}">
							<span class="explorer-item__icon" style="color:${visual.color}">${renderVisualIcon(visual, 14)}</span>
							<span class="explorer-item__label">${escapeHtml(node.name)}</span>
						</div>
					`;
				})
				.join('');

		shell.fileTree.innerHTML = renderNodes([...fileTree.children.values()], 0);
		shell.fileCountText.textContent = folderCount > 0 ? `${project.files.length} files • ${folderCount} folders` : `${project.files.length} files`;
	};

	const renderEditorTabs = (): void => {
		shell.editorTabs.innerHTML = openTabs
			.map((tabPath) => {
				const active = tabPath === currentFilePath;
				const visual = resolveFileVisual(tabPath);
				return `
					<div class="editor-tab${active ? ' active' : ''}" data-tab-path="${tabPath}">
						<span class="editor-tab__icon" style="color:${visual.color}">${renderVisualIcon(visual, 12)}</span>
						<span class="editor-tab__label">${escapeHtml(tabPath)}</span>
						<button type="button" class="editor-tab__close" data-close-tab="${tabPath}">
							<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
						</button>
					</div>
				`;
			})
			.join('');
	};

	const syncProjectHeader = (): void => {
		const project = getCurrentProject();
		if (!project) {
			return;
		}

		shell.projectNameDisplay.textContent = project.name;
		shell.projectCategoryDisplay.textContent = resolveProjectCategory(project);
		shell.projectDot.style.background = project.color;
		shell.viewportSceneLabel.textContent = project.name;
		shell.languageDisplay.textContent = resolveLanguageLabel(currentFilePath);
		shell.breadcrumbLabel.textContent = currentFilePath;
	};

	const refreshEditorFiles = (): void => {
		const project = getCurrentProject();
		if (!project || !editor) {
			return;
		}

		editor.loadFiles(project.files, currentFilePath);
		syncProjectHeader();
	};

	const selectFile = (path: string): void => {
		currentFilePath = path;
		if (!openTabs.includes(path)) {
			openTabs = [...openTabs, path];
		}
		editor?.openFile(path);
		renderFileTree();
		renderEditorTabs();
		syncProjectHeader();
	};

	const closeTab = (path: string): void => {
		if (openTabs.length <= 1) {
			return;
		}

		openTabs = openTabs.filter((item) => item !== path);
		if (currentFilePath === path) {
			currentFilePath = openTabs[openTabs.length - 1] ?? currentFilePath;
			editor?.openFile(currentFilePath);
		}
		renderEditorTabs();
		renderFileTree();
		syncProjectHeader();
	};

	const switchProject = (projectId: string): void => {
		const project = projects.find((candidate) => candidate.id === projectId);
		if (!project) {
			return;
		}

		currentProjectId = project.id;
		selectedExampleId = project.id;
		currentFilePath = project.entryFile;
		openTabs = [currentFilePath];
		refreshEditorFiles();
		renderExamplesList();
		renderFileTree();
		renderEditorTabs();
		void runCurrentProject();
	};

	const editorProject = getCurrentProject();
	if (editorProject) {
		const { createLiveEditor } = await loadPlaygroundTooling();
		editor = createLiveEditor({
			container: shell.monacoContainer,
			files: editorProject.files,
			activePath: currentFilePath,
			onChange: (path, value) => {
				const project = getCurrentProject();
				if (!project) {
					return;
				}

				const fileIndex = project.files.findIndex((file) => file.path === path);
				if (fileIndex === -1) {
					return;
				}

				project.files[fileIndex] = {
					...project.files[fileIndex]!,
					content: value,
				};
				persistCurrentProject();
			},
			onCursorChange: (lineNumber, column) => {
				shell.cursorPositionLabel.textContent = `Ln ${lineNumber}, Col ${column}`;
			},
		});
	}

	const nativeConsole = {
		log: console.log.bind(console),
		info: console.info.bind(console),
		warn: console.warn.bind(console),
		error: console.error.bind(console),
	};

	console.log = (...args: unknown[]) => {
		nativeConsole.log(...args);
		appendConsoleEntry(consoleEntries, 'log', args.map(String).join(' '));
	};
	console.info = (...args: unknown[]) => {
		nativeConsole.info(...args);
		appendConsoleEntry(consoleEntries, 'info', args.map(String).join(' '));
	};
	console.warn = (...args: unknown[]) => {
		nativeConsole.warn(...args);
		appendConsoleEntry(consoleEntries, 'warn', args.map(String).join(' '));
	};
	console.error = (...args: unknown[]) => {
		nativeConsole.error(...args);
		appendConsoleEntry(problemEntries, 'error', args.map(String).join(' '));
	};

	const fpsState = { frames: 0, last: performance.now() };
	const fpsLoop = (): void => {
		fpsState.frames += 1;
		const now = performance.now();
		if (now - fpsState.last >= 1000) {
			shell.fpsLabel.textContent = String(fpsState.frames);
			fpsState.frames = 0;
			fpsState.last = now;
		}
		requestAnimationFrame(fpsLoop);
	};

	let examplesReturnFocus: HTMLElement | null = null;

	const moveExampleSelection = (direction: 1 | -1): void => {
		const filtered = getFilteredExamples();
		if (filtered.length === 0) {
			return;
		}

		const currentIndex = filtered.findIndex((project) => project.id === selectedExampleId);
		const nextIndex = currentIndex === -1 ? 0 : Math.min(filtered.length - 1, Math.max(0, currentIndex + direction));
		const nextProject = filtered[nextIndex];
		if (!nextProject) {
			return;
		}

		selectedExampleId = nextProject.id;
		renderExamplesList();
		const row = [...shell.examplesList.querySelectorAll<HTMLElement>('[data-example-id]')].find(
			(candidate) => candidate.dataset.exampleId === nextProject.id,
		);
		row?.scrollIntoView({ block: 'nearest' });
	};

	const openExamplesModal = (): void => {
		if (examplesModalOpen) {
			return;
		}

		examplesReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		examplesModalOpen = true;
		examplesScope = 'all';
		selectedExampleId = currentProjectId;
		shell.examplesSearchInput.value = '';
		shell.examplesModal.classList.add('is-open');
		shell.examplesModal.setAttribute('aria-hidden', 'false');
		shell.projectTrigger.setAttribute('aria-expanded', 'true');
		shell.projectChevron.style.transform = 'rotate(180deg)';
		renderExamplesList();
		window.setTimeout(() => {
			shell.examplesSearchInput.focus();
			const currentRow = [...shell.examplesList.querySelectorAll<HTMLElement>('[data-example-id]')].find(
				(candidate) => candidate.dataset.exampleId === currentProjectId,
			);
			currentRow?.scrollIntoView({ block: 'nearest' });
		}, 50);
	};

	const closeExamplesModal = (restoreFocus = true): void => {
		if (!examplesModalOpen) {
			return;
		}

		examplesModalOpen = false;
		shell.examplesModal.classList.remove('is-open');
		shell.examplesModal.setAttribute('aria-hidden', 'true');
		shell.projectTrigger.setAttribute('aria-expanded', 'false');
		shell.projectChevron.style.transform = 'rotate(0deg)';
		if (restoreFocus) {
			const target = examplesReturnFocus && document.contains(examplesReturnFocus) ? examplesReturnFocus : shell.projectTrigger;
			window.setTimeout(() => target.focus({ preventScroll: true }), 50);
		}
		examplesReturnFocus = null;
	};

	const openSelectedExample = (): void => {
		const project = projects.find((candidate) => candidate.id === selectedExampleId);
		if (!project) {
			return;
		}

		closeExamplesModal(false);
		switchProject(project.id);
		window.setTimeout(() => editor?.focus(), 50);
	};

	const toggleConsole = (): void => {
		consoleVisible = !consoleVisible;
		shell.consolePanel.style.display = consoleVisible ? 'flex' : 'none';
		shell.consoleResize.style.display = consoleVisible ? '' : 'none';
	};

	const toggleSidebar = (): void => {
		sidebarVisible = !sidebarVisible;
		shell.sidebar.style.display = sidebarVisible ? 'flex' : 'none';
		shell.sidebarResize.style.display = sidebarVisible ? '' : 'none';
	};

	const toggleLayout = (): void => {
		verticalLayout = !verticalLayout;
		shell.workspace.style.flexDirection = verticalLayout ? 'column' : 'row';
	};

	const openNewProjectModal = (): void => {
		renderTemplateCards(shell, selectedTemplateId);
		closeExamplesModal(false);
		shell.newProjectModal.classList.add('is-open');
		shell.newProjectModal.setAttribute('aria-hidden', 'false');
		shell.newProjectNameInput.value = '';
		shell.newProjectCreateButton.disabled = true;
		window.setTimeout(() => shell.newProjectNameInput.focus(), 50);
	};

	const closeNewProjectModal = (restoreFocus = true): void => {
		shell.newProjectModal.classList.remove('is-open');
		shell.newProjectModal.setAttribute('aria-hidden', 'true');
		if (restoreFocus) {
			window.setTimeout(() => shell.projectTrigger.focus({ preventScroll: true }), 50);
		}
	};

	const createTemplateFiles = (templateId: string): VirtualProjectFile[] => {
		if (templateId === 'basic') {
			return [
				{
					path: 'main.ts',
					language: 'typescript',
					content: `import type { PlaygroundSceneExample } from '../shared/playground-types';\n\nconst example: PlaygroundSceneExample = {\n  id: 'basic-template',\n  title: 'Basic Template',\n  description: 'Editable project template.',\n  mount({ container }) {\n    container.replaceChildren();\n    const panel = document.createElement('div');\n    panel.style.cssText = 'height:100%;display:flex;align-items:center;justify-content:center;font:600 14px Plus Jakarta Sans,sans-serif;color:#1a1816;background:#f7f6f3';\n    panel.textContent = 'Replace this file with your Axrone scene.';\n    container.appendChild(panel);\n    return { dispose() { container.replaceChildren(); } };\n  },\n};\n\nexport default example;`,
				},
			];
		}

		return [
			{
				path: 'main.ts',
				language: 'typescript',
				content: `import type { PlaygroundSceneExample } from '../shared/playground-types';\n\nconst example: PlaygroundSceneExample = {\n  id: 'blank-template',\n  title: 'Blank Template',\n  description: 'Empty template project.',\n  mount({ container }) {\n    container.replaceChildren();\n    const panel = document.createElement('div');\n    panel.style.cssText = 'height:100%;display:flex;align-items:center;justify-content:center;font:600 14px Plus Jakarta Sans,sans-serif;color:#1a1816;background:#ffffff';\n    panel.textContent = 'Start building your Axrone scene here.';\n    container.appendChild(panel);\n    return { dispose() { container.replaceChildren(); } };\n  },\n};\n\nexport default example;`,
			},
		];
	};

	const createProject = (): void => {
		const name = shell.newProjectNameInput.value.trim();
		if (!name) {
			return;
		}

		const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `project-${Date.now()}`;
		const palette = ['#c2410c', '#2563eb', '#15803d', '#7c3aed', '#0d9488', '#b45309'];
		projects.push({
			id,
			name,
			color: palette[projects.length % palette.length]!,
			description:
				selectedTemplateId === 'basic'
					? 'Starter project created from the Basic Scene template.'
					: 'Starter project created from the Blank Scene template.',
			category: selectedTemplateId === 'basic' ? 'Starter' : 'Template',
			tags: selectedTemplateId === 'basic' ? ['3D', 'Starter', 'TypeScript'] : ['Starter', 'TypeScript'],
			entryFile: 'main.ts',
			files: createTemplateFiles(selectedTemplateId),
			builtIn: false,
		});
		closeNewProjectModal(false);
		renderExamplesList();
		switchProject(id);
	};

	const setCameraPreset = (preset: PlaygroundCameraPreset): void => {
		runtimeSession?.handle.setCameraPreset?.(preset);
		shell.cameraLabel.textContent = resolveCameraPresetLabel(preset);
		for (const option of shell.cameraDropdown.querySelectorAll<HTMLElement>('.cam-opt')) {
			option.classList.toggle('active', option.dataset.cam === preset);
		}
		shell.cameraDropdown.classList.remove('open');
	};

	const initResize = (
		handle: HTMLElement,
		panel: HTMLElement,
		direction: 'horizontal' | 'vertical',
		minSize: number,
	): void => {
		let startPointer = 0;
		let startSize = 0;

		handle.addEventListener('mousedown', (event) => {
			event.preventDefault();
			startPointer = direction === 'horizontal' ? event.clientX : event.clientY;
			startSize = direction === 'horizontal' ? panel.offsetWidth : panel.offsetHeight;
			handle.classList.add('drag');

			const move = (moveEvent: MouseEvent) => {
				const delta = (direction === 'horizontal' ? moveEvent.clientX : moveEvent.clientY) - startPointer;
				const nextSize = Math.max(minSize, startSize + delta);
				if (direction === 'horizontal') {
					panel.style.width = `${nextSize}px`;
					panel.style.flex = 'none';
				} else {
					panel.style.height = `${nextSize}px`;
					panel.style.flex = 'none';
				}
			};

			const end = () => {
				handle.classList.remove('drag');
				document.removeEventListener('mousemove', move);
				document.removeEventListener('mouseup', end);
			};

			document.addEventListener('mousemove', move);
			document.addEventListener('mouseup', end);
		});
	};

	shell.runButton.addEventListener('click', () => void runCurrentProject());
	shell.stopButton.addEventListener('click', () => void stopCurrentRuntime());
	shell.restartButton.addEventListener('click', () => void runCurrentProject());
	shell.playButton.addEventListener('click', () => {
		playing = !playing;
		runtimeSession?.handle.setPlaying?.(playing);
		updatePlayIcon();
	});
	shell.wireframeButton.addEventListener('click', () => {
		wireframe = !wireframe;
		runtimeSession?.handle.setWireframe?.(wireframe);
		updateControlState();
	});
	shell.gridButton.addEventListener('click', () => {
		gridVisible = !gridVisible;
		runtimeSession?.handle.setGridVisible?.(gridVisible);
		updateControlState();
	});
	shell.axesButton.addEventListener('click', () => {
		axesVisible = !axesVisible;
		runtimeSession?.handle.setAxesVisible?.(axesVisible);
		updateControlState();
	});
	shell.cameraButton.addEventListener('click', () => {
		shell.cameraDropdown.classList.toggle('open');
	});
	for (const option of shell.cameraDropdown.querySelectorAll<HTMLElement>('.cam-opt')) {
		option.addEventListener('click', () => {
			const preset = option.dataset.cam as PlaygroundCameraPreset | undefined;
			if (preset) {
				setCameraPreset(preset);
			}
		});
	}
	shell.toggleConsoleButton.addEventListener('click', toggleConsole);
	shell.toggleSidebarButton.addEventListener('click', toggleSidebar);
	shell.toggleLayoutButton.addEventListener('click', toggleLayout);
	shell.projectTrigger.addEventListener('click', () => {
		if (examplesModalOpen) {
			closeExamplesModal();
			return;
		}
		openExamplesModal();
	});
	for (const closeButton of shell.examplesCloseButtons) {
		closeButton.addEventListener('click', () => closeExamplesModal());
	}
	shell.examplesOpenButton.addEventListener('click', openSelectedExample);
	shell.examplesNewButton.addEventListener('click', openNewProjectModal);
	shell.examplesSearchInput.addEventListener('input', renderExamplesList);
	for (const scopeButton of shell.examplesScopeButtons) {
		scopeButton.addEventListener('click', () => {
			const scope = scopeButton.dataset.exampleScope as ExamplesScope | undefined;
			if (scope) {
				setExamplesScope(scope);
			}
		});
	}
	shell.examplesList.addEventListener('click', (event) => {
		const row = (event.target as HTMLElement).closest<HTMLElement>('[data-example-id]');
		if (!row?.dataset.exampleId) {
			return;
		}

		if (row.dataset.exampleId !== selectedExampleId) {
			selectedExampleId = row.dataset.exampleId;
			renderExamplesList();
		}

		if (event.detail === 0) {
			openSelectedExample();
		}
	});
	shell.examplesList.addEventListener('dblclick', (event) => {
		const row = (event.target as HTMLElement).closest<HTMLElement>('[data-example-id]');
		if (row?.dataset.exampleId) {
			selectedExampleId = row.dataset.exampleId;
			openSelectedExample();
		}
	});
	for (const closeButton of shell.newProjectCloseButtons) {
		closeButton.addEventListener('click', () => closeNewProjectModal());
	}
	shell.newProjectCreateButton.addEventListener('click', createProject);
	shell.newProjectNameInput.addEventListener('input', () => {
		shell.newProjectCreateButton.disabled = shell.newProjectNameInput.value.trim().length === 0;
	});
	shell.newProjectNameInput.addEventListener('keydown', (event) => {
		if (event.key === 'Enter') {
			event.preventDefault();
			createProject();
		}
	});
	shell.newProjectTemplates.addEventListener('click', (event) => {
		const target = (event.target as HTMLElement).closest<HTMLElement>('[data-template-id]');
		if (!target?.dataset.templateId) {
			return;
		}

		selectedTemplateId = target.dataset.templateId;
		renderTemplateCards(shell, selectedTemplateId);
	});
	shell.fileTree.addEventListener('click', (event) => {
		const folder = (event.target as HTMLElement).closest<HTMLElement>('[data-folder-path]');
		if (folder?.dataset.folderPath) {
			if (collapsedFolders.has(folder.dataset.folderPath)) {
				collapsedFolders.delete(folder.dataset.folderPath);
			} else {
				collapsedFolders.add(folder.dataset.folderPath);
			}
			renderFileTree();
			return;
		}

		const item = (event.target as HTMLElement).closest<HTMLElement>('[data-file-path]');
		if (item?.dataset.filePath) {
			selectFile(item.dataset.filePath);
		}
	});
	shell.editorTabs.addEventListener('click', (event) => {
		const closeButton = (event.target as HTMLElement).closest<HTMLElement>('[data-close-tab]');
		if (closeButton?.dataset.closeTab) {
			event.stopPropagation();
			closeTab(closeButton.dataset.closeTab);
			return;
		}

		const tab = (event.target as HTMLElement).closest<HTMLElement>('[data-tab-path]');
		if (tab?.dataset.tabPath) {
			selectFile(tab.dataset.tabPath);
		}
	});
	shell.consoleTabs.forEach((tab) => {
		tab.addEventListener('click', () => {
			activeConsoleTab = tab.dataset.ct as ConsoleTab;
			for (const candidate of shell.consoleTabs) {
				candidate.classList.toggle('active', candidate === tab);
			}
			renderConsoleOutput();
		});
	});
	requireElement(root, '#clear-console').addEventListener('click', () => {
		consoleEntries.length = 0;
		problemEntries.length = 0;
		outputEntries.length = 0;
		renderConsoleOutput();
	});
	requireElement(root, '#close-console').addEventListener('click', toggleConsole);
	shell.fullscreenButton.addEventListener('click', async () => {
		if (document.fullscreenElement) {
			await document.exitFullscreen();
			return;
		}

		await shell.previewContainer.requestFullscreen();
	});

	initResize(shell.sidebarResize, shell.sidebar, 'horizontal', 160);
	initResize(shell.editorResize, shell.editorPanel, 'horizontal', 280);
	initResize(shell.consoleResize, shell.consolePanel, 'vertical', 80);

	renderExamplesList();
	renderFileTree();
	renderEditorTabs();
	renderConsoleOutput();
	syncProjectHeader();
	shell.cameraLabel.textContent = resolveCameraPresetLabel('perspective');
	updateControlState();
	fpsLoop();
	appendConsoleEntry(outputEntries, 'info', 'Axrone Playground initialized.');
	appendConsoleEntry(outputEntries, 'log', 'Press Ctrl+Enter to run the current project.');
	void runCurrentProject();

	document.addEventListener('click', (event) => {
		const target = event.target as Node | null;
		if (!target) {
			return;
		}

		if (!shell.cameraDropdown.contains(target) && !shell.cameraButton.contains(target)) {
			shell.cameraDropdown.classList.remove('open');
		}
	});

	document.addEventListener('keydown', (event) => {
		const modifier = event.ctrlKey || event.metaKey;

		if (modifier && event.key.toLowerCase() === 'k') {
			event.preventDefault();
			if (examplesModalOpen) {
				closeExamplesModal();
			} else if (!shell.newProjectModal.classList.contains('is-open')) {
				openExamplesModal();
			}
			return;
		}

		if (modifier && event.key === 'Enter') {
			event.preventDefault();
			void runCurrentProject();
			return;
		}

		if (event.key === 'Escape') {
			if (examplesModalOpen) {
				closeExamplesModal();
				return;
			}
			if (shell.newProjectModal.classList.contains('is-open')) {
				closeNewProjectModal();
				return;
			}
			shell.cameraDropdown.classList.remove('open');
			return;
		}

		if (!examplesModalOpen) {
			return;
		}

		if (event.key === 'Tab') {
			const focusable = [
				...shell.examplesDialog.querySelectorAll<HTMLElement>(
					'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
				),
			].filter((element) => element.offsetParent !== null);
			const first = focusable[0];
			const last = focusable[focusable.length - 1];
			if (!first || !last) {
				return;
			}
			if (!shell.examplesDialog.contains(document.activeElement)) {
				event.preventDefault();
				first.focus();
				return;
			}
			if (event.shiftKey && document.activeElement === first) {
				event.preventDefault();
				last.focus();
			} else if (!event.shiftKey && document.activeElement === last) {
				event.preventDefault();
				first.focus();
			}
			return;
		}

		if (event.key === 'ArrowDown') {
			event.preventDefault();
			moveExampleSelection(1);
			return;
		}

		if (event.key === 'ArrowUp') {
			event.preventDefault();
			moveExampleSelection(-1);
			return;
		}

		if (event.target === shell.examplesSearchInput && event.key === 'Enter') {
			event.preventDefault();
			openSelectedExample();
		}
	}, true);
};

const requireElement = <T extends Element>(root: ParentNode, selector: string): T => {
	const element = root.querySelector<T>(selector);
	if (!element) {
		throw new Error(`Missing required element: ${selector}`);
	}

	return element;
};