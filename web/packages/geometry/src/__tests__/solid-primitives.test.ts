import { describe, expect, it } from 'vitest';
import { createCapsule, createCylinder, createQuad, createSphere } from '@axrone/geometry';

const VERTEX_STRIDE = 32;

const readPositions = (
	vertices: { toUint8Array(): Uint8Array },
): Array<[number, number, number]> => {
	const bytes = vertices.toUint8Array();
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const positions: Array<[number, number, number]> = [];
	for (let offset = 0; offset < bytes.byteLength; offset += VERTEX_STRIDE) {
		positions.push([
			view.getFloat32(offset, false),
			view.getFloat32(offset + 4, false),
			view.getFloat32(offset + 8, false),
		]);
	}
	return positions;
};

const readIndices = (indices: { toUint8Array(): Uint8Array }): number[] => {
	const bytes = indices.toUint8Array();
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const values: number[] = [];
	for (let offset = 0; offset < bytes.byteLength; offset += 2) {
		values.push(view.getUint16(offset, false));
	}
	return values;
};

const resolveTriangleNormal = (
	positions: Array<[number, number, number]>,
	indices: number[],
	triangleIndex: number,
): [number, number, number] => {
	const offset = triangleIndex * 3;
	const a = positions[indices[offset]!]!;
	const b = positions[indices[offset + 1]!]!;
	const c = positions[indices[offset + 2]!]!;
	const ab: [number, number, number] = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
	const ac: [number, number, number] = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
	return [
		ab[1] * ac[2] - ab[2] * ac[1],
		ab[2] * ac[0] - ab[0] * ac[2],
		ab[0] * ac[1] - ab[1] * ac[0],
	];
};

const resolveTriangleArea = (
	positions: Array<[number, number, number]>,
	indices: number[],
	triangleIndex: number,
): number => {
	const normal = resolveTriangleNormal(positions, indices, triangleIndex);
	return Math.hypot(normal[0], normal[1], normal[2]) * 0.5;
};

describe('solid primitive generation', () => {
	it('builds spheres without degenerate pole triangles', () => {
		const geometry = createSphere({ widthSegments: 16, heightSegments: 8 });
		const positions = readPositions(geometry.vertices);
		const indices = readIndices(geometry.indices);
		const triangleCount = indices.length / 3;

		for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex += 1) {
			expect(resolveTriangleArea(positions, indices, triangleIndex)).toBeGreaterThan(1e-6);
		}
	});

	it('winds cylinder caps outward on both ends', () => {
		const radialSegments = 12;
		const geometry = createCylinder({ radialSegments, heightSegments: 1 });
		const positions = readPositions(geometry.vertices);
		const indices = readIndices(geometry.indices);
		const torsoTriangleCount = radialSegments * 2;
		const topCapNormal = resolveTriangleNormal(positions, indices, torsoTriangleCount);
		const bottomCapNormal = resolveTriangleNormal(
			positions,
			indices,
			torsoTriangleCount + radialSegments,
		);

		expect(topCapNormal[1]).toBeGreaterThan(0);
		expect(bottomCapNormal[1]).toBeLessThan(0);
	});

	it('winds capsule pole fans outward on both ends', () => {
		const radialSegments = 12;
		const capSegments = 8;
		const geometry = createCapsule({ radialSegments, capSegments });
		const positions = readPositions(geometry.vertices);
		const indices = readIndices(geometry.indices);
		const bodyTriangleCount = radialSegments * 2;
		const hemisphereTriangleCount = radialSegments + (capSegments - 1) * radialSegments * 2;
		const topPoleNormal = resolveTriangleNormal(positions, indices, bodyTriangleCount);
		const bottomPoleNormal = resolveTriangleNormal(
			positions,
			indices,
			bodyTriangleCount + hemisphereTriangleCount,
		);

		expect(topPoleNormal[1]).toBeGreaterThan(0);
		expect(bottomPoleNormal[1]).toBeLessThan(0);
	});

	it('builds XY quads with front and back faces', () => {
		const geometry = createQuad({ width: 1, height: 1, orientation: 'xy' });
		const positions = readPositions(geometry.vertices);
		const indices = readIndices(geometry.indices);
		const normals = Array.from({ length: indices.length / 3 }, (_, triangleIndex) =>
			resolveTriangleNormal(positions, indices, triangleIndex),
		);

		expect(normals.some((normal) => normal[2] > 0)).toBe(true);
		expect(normals.some((normal) => normal[2] < 0)).toBe(true);
	});
});