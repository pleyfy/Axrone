import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Dist d.ts health gate. The dts bundling pass must externalize sibling
// packages and own subpath entries; when it inlines them instead, the same
// class gets copied into multiple published d.ts files, creating nominal
// type mismatches for consumers (the "two different types with this name
// exist" class of failure).

const PACKAGES_DIR = path.resolve(process.cwd(), 'packages');

const getAllPackageNames = (): string[] =>
	fs
		.readdirSync(PACKAGES_DIR)
		.filter((name) =>
			fs.existsSync(path.join(PACKAGES_DIR, name, 'package.json'))
		);

const listDistDtsFiles = (pkg: string): string[] => {
	const distDir = path.join(PACKAGES_DIR, pkg, 'dist');
	if (!fs.existsSync(distDir)) {
		return [];
	}

	const files: string[] = [];
	for (const entry of fs.readdirSync(distDir, { recursive: true })) {
		if (entry.endsWith('.d.ts')) {
			files.push(path.join(distDir, entry));
		}
	}
	return files;
};

const CLASS_DECLARATION_PATTERN =
	/(?:^|\n)\s*(?:export\s+)?(?:declare\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/g;

// By-design duplicates: each package defines its own class with this name.
// - Raycaster2D: raycast re-implements it structurally to avoid a
//   raycast -> physics-2d package dependency (raycast-engine.ts).
// - ParticleSystem: scene-runtime declares the scene Component
//   (components/particle-system.ts); the particle-system package declares
//   the simulation engine class (particle-system.ts).
const ALLOWED_DUPLICATE_CLASSES = new Set(['Raycaster2D', 'ParticleSystem']);

const allPackages = getAllPackageNames();

const packagesWithDist = allPackages.filter(
	(pkg) => listDistDtsFiles(pkg).length > 0
);

// Dist-dependent assertions are meaningless without a prior build. Skip
// honestly in local dev; CI builds first and still enforces the gate.
const hasBuiltPackages = packagesWithDist.length > 0;

describe.skipIf(!hasBuiltPackages)('dist d.ts duplication governance', () => {
	it('declares each class in exactly one package', () => {
		const owners = new Map<string, string[]>();

		for (const pkg of packagesWithDist) {
			for (const dtsFile of listDistDtsFiles(pkg)) {
				const source = fs.readFileSync(dtsFile, 'utf8');
				for (const match of source.matchAll(CLASS_DECLARATION_PATTERN)) {
					const className = match[1];
					const ownerList = owners.get(className) ?? [];
					if (!ownerList.includes(pkg)) {
						ownerList.push(pkg);
					}
					owners.set(className, ownerList);
				}
			}
		}

		const duplicates = [...owners.entries()].filter(
			([className, pkgs]) =>
				pkgs.length > 1 && !ALLOWED_DUPLICATE_CLASSES.has(className)
		);

		const detail = duplicates
			.map(([className, pkgs]) => `${className}: ${pkgs.join(', ')}`)
			.join('; ');
		expect(detail).toBe('');
	});

	it('emits no build-machine absolute paths into published d.ts', () => {
		const offenders: string[] = [];

		for (const pkg of packagesWithDist) {
			for (const dtsFile of listDistDtsFiles(pkg)) {
				const source = fs.readFileSync(dtsFile, 'utf8');
				if (/[A-Za-z]:[\\/]|\0/.test(source)) {
					offenders.push(path.relative(process.cwd(), dtsFile));
				}
			}
		}

		expect(offenders).toEqual([]);
	});
});
