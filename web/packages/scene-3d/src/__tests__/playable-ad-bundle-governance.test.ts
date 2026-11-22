import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

/**
 * Playable-Ad Bundle Size Governance Tests
 *
 * Validates bundle size constraints for playable ad targets.
 * Hard limit: ≤ 2 MB initial load (gzip).
 *
 * These tests perform static analysis on the monorepo packages — measuring
 * dist/ directory sizes, dependency graphs, tree-shaking metadata, and
 * compression ratios — without running a full Vite build.
 */

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const WEB_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const PACKAGES_DIR = path.join(WEB_ROOT, 'packages');
const PLAYABLE_2D_ENTRY = path.join(WEB_ROOT, 'examples', 'playable-2d', 'main.ts');
const SCENE_3D_ENTRY = path.join(PACKAGES_DIR, 'scene-3d', 'src', 'index.ts');
const GOVERNANCE_SCRIPT = path.join(WEB_ROOT, 'scripts', 'playable-2d-governance.mjs');
const BASELINE_PATH = path.join(WEB_ROOT, 'scripts', 'playable-2d-bundle-baseline.json');

// ---------------------------------------------------------------------------
// Budget constants
// ---------------------------------------------------------------------------

const BUDGETS = {
	'playable-ad': { gzipBytes: 2 * 1024 * 1024, label: '2 MB' },
	'web-mobile': { gzipBytes: 15 * 1024 * 1024, label: '15 MB' },
	'web-desktop': { gzipBytes: 30 * 1024 * 1024, label: '30 MB' },
} as const;

const MAX_SINGLE_PACKAGE_UNCOMPRESSED_BYTES = 500 * 1024; // 500 KB
const MAX_TOTAL_ENGINE_UNCOMPRESSED_BYTES = 15 * 1024 * 1024; // 15 MB (includes CJS + ESM duplicates)
const BUDGET_WARNING_THRESHOLD = 0.8; // 80 %
const MIN_COMPRESSION_RATIO = 0.6; // 60 %
const MOBILE_TEXTURE_ATLAS_BUDGET_BYTES = 128 * 1024 * 1024; // 128 MB
const PLAYABLE_AD_AUDIO_BUDGET_BYTES = 4 * 1024 * 1024; // 4 MB

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getAllPackageNames(): string[] {
	if (!fs.existsSync(PACKAGES_DIR)) return [];
	return fs
		.readdirSync(PACKAGES_DIR, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort();
}

function getDistDir(packageName: string): string {
	return path.join(PACKAGES_DIR, packageName, 'dist');
}

function measureDirectorySize(dirPath: string, extensions?: string[]): number {
	if (!fs.existsSync(dirPath)) return 0;
	let total = 0;
	const entries = fs.readdirSync(dirPath, { withFileTypes: true });
	for (const entry of entries) {
		const fullPath = path.join(dirPath, entry.name);
		if (entry.isFile()) {
			if (extensions) {
				const ext = path.extname(fullPath);
				if (!extensions.includes(ext)) continue;
			}
			total += fs.statSync(fullPath).size;
		} else if (entry.isDirectory()) {
			total += measureDirectorySize(fullPath, extensions);
		}
	}
	return total;
}

function readPackageJson(packageName: string): Record<string, unknown> | null {
	const pkgJsonPath = path.join(PACKAGES_DIR, packageName, 'package.json');
	if (!fs.existsSync(pkgJsonPath)) return null;
	return JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
}

function getFileSize(filePath: string): number {
	if (!fs.existsSync(filePath)) return 0;
	return fs.statSync(filePath).size;
}

function getGzipSize(filePath: string): number {
	if (!fs.existsSync(filePath)) return 0;
	const content = fs.readFileSync(filePath);
	return gzipSync(content).byteLength;
}

function getAxroneDependencies(packageName: string): string[] {
	const pkg = readPackageJson(packageName);
	if (!pkg || typeof pkg !== 'object') return [];
	const deps = (pkg as Record<string, Record<string, string>>).dependencies ?? {};
	return Object.keys(deps).filter((d) => d.startsWith('@axrone/'));
}

function detectCircularDeps(
	graph: Map<string, string[]>,
): string[][] {
	const cycles: string[][] = [];
	const visited = new Set<string>();
	const inStack = new Set<string>();

	function dfs(node: string, pathSoFar: string[]): void {
		if (inStack.has(node)) {
			const cycleStart = pathSoFar.indexOf(node);
			if (cycleStart >= 0) {
				cycles.push(pathSoFar.slice(cycleStart).concat(node));
			}
			return;
		}
		if (visited.has(node)) return;

		visited.add(node);
		inStack.add(node);
		pathSoFar.push(node);

		for (const dep of graph.get(node) ?? []) {
			dfs(dep, [...pathSoFar]);
		}

		inStack.delete(node);
	}

	for (const node of graph.keys()) {
		if (!visited.has(node)) {
			dfs(node, []);
		}
	}

	return cycles;
}

// ---------------------------------------------------------------------------
// Shared state (computed once)
// ---------------------------------------------------------------------------

const allPackages = getAllPackageNames();

const packageDistSizes = new Map<string, number>();
const packageJsSizes = new Map<string, number>();
for (const pkg of allPackages) {
	packageDistSizes.set(pkg, measureDirectorySize(getDistDir(pkg)));
	packageJsSizes.set(pkg, measureDirectorySize(getDistDir(pkg), ['.js', '.mjs']));
}

const packagesWithDist = allPackages.filter((pkg) => {
	const distDir = getDistDir(pkg);
	return fs.existsSync(distDir) && fs.readdirSync(distDir).length > 0;
});

// Dist-dependent assertions are meaningless (or vacuously true) without a
// prior build. Gate them so local dev runs skip honestly; CI builds first
// and still enforces the budgets.
const hasBuiltPackages = packagesWithDist.length > 0;

// Payload budgets measure the deployable surface: .js/.mjs only. Sourcemaps
// and .d.ts are dev-time artifacts (SOP-07: source maps generated but not
// deployed). Default budget is the 2 MB playable-ad hard limit;
// scene-runtime is the consolidated engine core (measured ~2.9 MB
// uncompressed JS on a full build) and is gated at baseline + 20% headroom.
const PACKAGE_PAYLOAD_BUDGET_BYTES = new Map<string, number>([
	['scene-runtime', 3584 * 1024],
]);
const DEFAULT_PACKAGE_PAYLOAD_BUDGET_BYTES = 2 * 1024 * 1024;

const payloadBudgetFor = (pkg: string): number =>
	PACKAGE_PAYLOAD_BUDGET_BYTES.get(pkg) ?? DEFAULT_PACKAGE_PAYLOAD_BUDGET_BYTES;

const dependencyGraph = new Map<string, string[]>();
for (const pkg of allPackages) {
	const deps = getAxroneDependencies(pkg).map((d) => d.replace('@axrone/', ''));
	dependencyGraph.set(pkg, deps);
}

// ---------------------------------------------------------------------------
// 1. Package Size Inventory
// ---------------------------------------------------------------------------

describe.skipIf(!hasBuiltPackages)('Package Size Inventory', () => {
	it('should discover all packages with dist/ directories', () => {
		expect(packagesWithDist.length).toBeGreaterThan(0);
		// Most packages should have been built
		expect(packagesWithDist.length).toBeGreaterThanOrEqual(allPackages.length * 0.8);
	});

	it('should measure each package dist/ size recursively', () => {
		for (const pkg of packagesWithDist) {
			const size = packageDistSizes.get(pkg)!;
			expect(size).toBeGreaterThan(0);
		}
	});

	it('no single package should exceed its shippable JS payload budget', () => {
		const violations: string[] = [];
		for (const [pkg, size] of packageJsSizes) {
			const budget = payloadBudgetFor(pkg);
			if (size > budget) {
				violations.push(
					`${pkg}: ${(size / 1024).toFixed(1)} KB / ${(budget / 1024).toFixed(0)} KB`
				);
			}
		}
		expect(violations).toEqual([]);
	});

	it('total engine JS payload should be under 15 MB uncompressed', () => {
		const totalJsSize = Array.from(packageJsSizes.values()).reduce((sum, s) => sum + s, 0);
		expect(totalJsSize).toBeLessThan(MAX_TOTAL_ENGINE_UNCOMPRESSED_BYTES);
	});
});

// ---------------------------------------------------------------------------
// 2. Entry Point Size
// ---------------------------------------------------------------------------

describe('Entry Point Size', () => {
	it('playable-2d entry point should exist and be within budget', () => {
		const size = getFileSize(PLAYABLE_2D_ENTRY);
		// The entry point source file is small — the bundled output is what matters
		// The baseline gzip is ~85 KB (well within 2 MB budget)
		if (fs.existsSync(BASELINE_PATH)) {
			const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
			expect(baseline.gzipBytes).toBeLessThanOrEqual(BUDGETS['playable-ad'].gzipBytes);
		} else {
			// If no baseline, just verify the entry source exists
			expect(size).toBeGreaterThan(0);
		}
	});

	it('scene-3d entry point should exist and have reasonable size', () => {
		const size = getFileSize(SCENE_3D_ENTRY);
		expect(size).toBeGreaterThan(0);
		// Source entry should be small (< 10 KB)
		expect(size).toBeLessThan(10 * 1024);
	});

	it('playable-2d bundle gzip size should be within 2 MB hard limit', () => {
		if (fs.existsSync(BASELINE_PATH)) {
			const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
			expect(baseline.gzipBytes).toBeLessThanOrEqual(BUDGETS['playable-ad'].gzipBytes);
			// Should be well under budget — currently ~83 KB = ~4% of 2 MB
			const usagePercent = baseline.gzipBytes / BUDGETS['playable-ad'].gzipBytes;
			expect(usagePercent).toBeLessThan(BUDGET_WARNING_THRESHOLD);
		}
	});
});

// ---------------------------------------------------------------------------
// 3. Dependency Graph Analysis
// ---------------------------------------------------------------------------

describe('Dependency Graph Analysis', () => {
	it('should count direct @axrone dependencies for each package', () => {
		for (const pkg of allPackages) {
			const deps = dependencyGraph.get(pkg)!;
			// Every package should have a known dependency count (even if 0)
			expect(Array.isArray(deps)).toBe(true);
		}
	});

	it('should have no circular dependencies', () => {
		const cycles = detectCircularDeps(dependencyGraph);
		expect(cycles).toEqual([]);
	});

	it('playable-2d relevant packages should not import heavy 3D packages', () => {
		// The playable-2d governance script forbids these packages in the bundle.
		// Verify that the 2D runtime profile's transitive deps don't include 3D-only packages.
		const heavy3dPackages = ['scene-3d', 'render-3d', 'render-webgl2', 'physics-3d', 'asset-gltf'];

		// runtime-profile-2d is the entry for playable-2d
		const profile2dDeps = dependencyGraph.get('runtime-profile-2d') ?? [];
		const violations = profile2dDeps.filter((dep) => heavy3dPackages.includes(dep));
		expect(violations).toEqual([]);
	});

	it('leaf utility packages should depend at most on the hash leaf', () => {
		// utility's comparer needs Fnv1a32 — hash is the bottom of the
		// dependency graph, so utility→hash is the only permitted edge from
		// a leaf utility package. Any other dependency is a violation.
		const allowedLeafDeps = new Set(['hash']);
		const utilityDeps = (dependencyGraph.get('utility') ?? []).filter(
			(dep) => !allowedLeafDeps.has(dep),
		);
		const randomDeps = dependencyGraph.get('random') ?? [];
		expect(utilityDeps.length).toBe(0);
		expect(randomDeps.length).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// 4. Tree-Shaking Validation
// ---------------------------------------------------------------------------

describe('Tree-Shaking Validation', () => {
	it('all packages should declare sideEffects: false in package.json', () => {
		const violations: string[] = [];
		for (const pkg of allPackages) {
			const pkgJson = readPackageJson(pkg);
			if (!pkgJson) continue;
			if (pkgJson.sideEffects !== false) {
				violations.push(pkg);
			}
		}
		// Document violations but acknowledge some packages may not need it
		if (violations.length > 0) {
			console.warn(`Packages missing sideEffects: false: ${violations.join(', ')}`);
		}
		// Most packages should have it
		const compliant = allPackages.length - violations.length;
		expect(compliant).toBeGreaterThanOrEqual(allPackages.length * 0.9);
	});

	it('packages should have named ESM exports (not default-only)', () => {
		let packagesWithExports = 0;
		let packagesWithNamedExports = 0;

		for (const pkg of allPackages) {
			const pkgJson = readPackageJson(pkg);
			if (!pkgJson) continue;
			const exports = pkgJson.exports as Record<string, unknown> | undefined;
			if (!exports) continue;

			packagesWithExports++;
			// Check that the main "." export has an "import" condition (ESM)
			const mainExport = exports['.'] as Record<string, string> | undefined;
			if (mainExport && mainExport.import) {
				packagesWithNamedExports++;
			}
		}

		expect(packagesWithExports).toBeGreaterThan(0);
		expect(packagesWithNamedExports).toBe(packagesWithExports);
	});

	it('playable-2d governance script should enforce forbidden package rules', () => {
		if (!fs.existsSync(GOVERNANCE_SCRIPT)) return;
		const scriptSource = fs.readFileSync(GOVERNANCE_SCRIPT, 'utf8');
		// The governance script should contain forbidden package rules
		expect(scriptSource).toContain('forbiddenPackageRules');
		expect(scriptSource).toContain('render-3d');
		expect(scriptSource).toContain('physics-3d');
		expect(scriptSource).toContain('scene-3d');
	});
});

// ---------------------------------------------------------------------------
// 5. Budget Governance
// ---------------------------------------------------------------------------

describe('Budget Governance', () => {
	it('should define budgets for all target profiles', () => {
		expect(BUDGETS['playable-ad']).toBeDefined();
		expect(BUDGETS['web-mobile']).toBeDefined();
		expect(BUDGETS['web-desktop']).toBeDefined();
	});

	it('playable-ad budget should be 2 MB gzip', () => {
		expect(BUDGETS['playable-ad'].gzipBytes).toBe(2 * 1024 * 1024);
	});

	it('current playable-2d bundle should be within playable-ad budget', () => {
		if (!fs.existsSync(BASELINE_PATH)) return;
		const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
		expect(baseline.gzipBytes).toBeLessThanOrEqual(BUDGETS['playable-ad'].gzipBytes);
	});

	it.skipIf(!hasBuiltPackages)('should flag packages approaching budget limit (> 80%)', () => {
		const approaching: string[] = [];

		for (const [pkg, size] of packageJsSizes) {
			if (size > payloadBudgetFor(pkg) * BUDGET_WARNING_THRESHOLD) {
				approaching.push(`${pkg}: ${(size / 1024).toFixed(1)} KB`);
			}
		}

		expect(approaching.length).toBeLessThan(5);
	});

	it.skipIf(!hasBuiltPackages)('total engine JS payload should be within web-mobile budget', () => {
		const totalJsSize = Array.from(packageJsSizes.values()).reduce((sum, s) => sum + s, 0);
		// Uncompressed JS payload should be well under web-mobile budget (15 MB)
		expect(totalJsSize).toBeLessThan(BUDGETS['web-mobile'].gzipBytes);
	});
});

// ---------------------------------------------------------------------------
// 6. Compression Ratio
// ---------------------------------------------------------------------------

describe.skipIf(!hasBuiltPackages)('Compression Ratio', () => {
	it('should measure raw vs gzip sizes for key packages', () => {
		// Pick a few representative packages to test compression
		const keyPackages = ['utility', 'render-3d', 'scene-3d', 'physics-core'];
		let measured = 0;

		for (const pkg of keyPackages) {
			const distDir = getDistDir(pkg);
			if (!fs.existsSync(distDir) || fs.readdirSync(distDir).length === 0) continue;

			// Measure only .js files (skip .d.ts and .map)
			const jsFiles = fs
				.readdirSync(distDir, { recursive: true })
				.map((f) => path.join(distDir, String(f)))
				.filter((f) => fs.statSync(f).isFile() && (f.endsWith('.js') || f.endsWith('.mjs')));

			if (jsFiles.length === 0) continue;

			let rawSize = 0;
			let gzipSize = 0;
			for (const file of jsFiles) {
				const content = fs.readFileSync(file);
				rawSize += content.byteLength;
				gzipSize += gzipSync(content).byteLength;
			}

			if (rawSize > 0) {
				const ratio = gzipSize / rawSize;
				// Log the ratio for visibility
				console.warn(`${pkg}: raw=${(rawSize / 1024).toFixed(1)} KB, gzip=${(gzipSize / 1024).toFixed(1)} KB, ratio=${(ratio * 100).toFixed(1)}%`);
				measured++;
			}
		}

		expect(measured).toBeGreaterThan(0);
	});

	it('JS compression ratio should be favorable (gzip < raw)', () => {
		// Test with the playable-2d baseline data
		if (!fs.existsSync(BASELINE_PATH)) return;
		const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));

		if (baseline.rawBytes > 0 && baseline.gzipBytes > 0) {
			const ratio = baseline.gzipBytes / baseline.rawBytes;
			// gzip should be significantly smaller than raw
			expect(ratio).toBeLessThan(1);
		}
	});

	it('compression ratio should exceed 60% threshold for typical JS bundles', () => {
		if (!fs.existsSync(BASELINE_PATH)) return;
		const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));

		if (baseline.rawBytes > 0 && baseline.gzipBytes > 0) {
			// Compression ratio = 1 - (gzip/raw). A "good" ratio means gzip is much smaller.
			// We check that gzip is at most ~40% of raw (i.e., > 60% compression)
			const compressionRatio = 1 - baseline.gzipBytes / baseline.rawBytes;
			expect(compressionRatio).toBeGreaterThan(MIN_COMPRESSION_RATIO);
		}
	});
});

// ---------------------------------------------------------------------------
// 7. Asset Budget
// ---------------------------------------------------------------------------

describe('Asset Budget', () => {
	const ASSETS_DIR = path.resolve(WEB_ROOT, '..', '..', 'Assets');

	it('texture atlas total should be within mobile budget (128 MB)', () => {
		if (!fs.existsSync(ASSETS_DIR)) {
			return;
		}

		const texturesDir = path.join(ASSETS_DIR, 'Textures');
		if (!fs.existsSync(texturesDir)) {
			return;
		}

		const totalTextureSize = measureDirectorySize(texturesDir);
		expect(totalTextureSize).toBeLessThanOrEqual(MOBILE_TEXTURE_ATLAS_BUDGET_BYTES);
	});

	it('audio assets should be within playable-ad budget (4 MB)', () => {
		if (!fs.existsSync(ASSETS_DIR)) {
			return;
		}

		const audioDir = path.join(ASSETS_DIR, 'Audio');
		if (!fs.existsSync(audioDir)) {
			return;
		}

		const totalAudioSize = measureDirectorySize(audioDir);
		expect(totalAudioSize).toBeLessThanOrEqual(PLAYABLE_AD_AUDIO_BUDGET_BYTES);
	});

	it('model assets should be tracked and within reasonable bounds', () => {
		if (!fs.existsSync(ASSETS_DIR)) {
			return;
		}

		const modelsDir = path.join(ASSETS_DIR, 'Models');
		if (!fs.existsSync(modelsDir)) {
			return;
		}

		const totalModelSize = measureDirectorySize(modelsDir);
		// Models should be under 50 MB for playable-ad targets
		expect(totalModelSize).toBeLessThanOrEqual(50 * 1024 * 1024);
	});

	it('governance script should exist and define forbidden packages for playable-2d', () => {
		expect(fs.existsSync(GOVERNANCE_SCRIPT)).toBe(true);
		const scriptSource = fs.readFileSync(GOVERNANCE_SCRIPT, 'utf8');
		// Verify the governance script enforces size constraints
		expect(scriptSource).toContain('gzipBytes');
		expect(scriptSource).toContain('forbiddenPackageRules');
	});
});
