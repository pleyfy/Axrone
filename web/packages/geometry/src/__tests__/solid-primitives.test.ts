import { describe, expect, it } from 'vitest';
import { createCapsule, createCylinder, createQuad, createSphere, createTorus } from '@axrone/geometry';

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

const readNormals = (
	vertices: { toUint8Array(): Uint8Array },
): Array<[number, number, number]> => {
	const bytes = vertices.toUint8Array();
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const normals: Array<[number, number, number]> = [];
	for (let offset = 0; offset < bytes.byteLength; offset += VERTEX_STRIDE) {
		normals.push([
			view.getFloat32(offset + 12, false),
			view.getFloat32(offset + 16, false),
			view.getFloat32(offset + 20, false),
		]);
	}
	return normals;
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

const resolveTriangleCentroid = (
	positions: Array<[number, number, number]>,
	indices: number[],
	triangleIndex: number,
): [number, number, number] => {
	const offset = triangleIndex * 3;
	const a = positions[indices[offset]!]!;
	const b = positions[indices[offset + 1]!]!;
	const c = positions[indices[offset + 2]!]!;
	return [
		(a[0] + b[0] + c[0]) / 3,
		(a[1] + b[1] + c[1]) / 3,
		(a[2] + b[2] + c[2]) / 3,
	];
};

const dot = (a: [number, number, number], b: [number, number, number]): number =>
	a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

const hasPosition = (
	positions: Array<[number, number, number]>,
	target: [number, number, number],
	epsilon: number = 1e-6,
): boolean =>
	positions.some(
		(position) =>
			Math.abs(position[0] - target[0]) <= epsilon &&
			Math.abs(position[1] - target[1]) <= epsilon &&
			Math.abs(position[2] - target[2]) <= epsilon,
	);

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

	it('preserves authored sphere normals across the duplicated UV seam', () => {
		const widthSegments = 16;
		const heightSegments = 8;
		const geometry = createSphere({ widthSegments, heightSegments });
		const positions = readPositions(geometry.vertices);
		const normals = readNormals(geometry.vertices);
		const stride = widthSegments + 1;

		for (let lat = 1; lat < heightSegments; lat += 1) {
			const seamStart = lat * stride;
			const seamEnd = seamStart + widthSegments;
			const leftPosition = positions[seamStart]!;
			const rightPosition = positions[seamEnd]!;
			const leftNormal = normals[seamStart]!;
			const rightNormal = normals[seamEnd]!;

			expect(Math.abs(leftPosition[0] - rightPosition[0])).toBeLessThan(1e-6);
			expect(Math.abs(leftPosition[1] - rightPosition[1])).toBeLessThan(1e-6);
			expect(Math.abs(leftPosition[2] - rightPosition[2])).toBeLessThan(1e-6);
			expect(Math.abs(leftNormal[0] - rightNormal[0])).toBeLessThan(1e-5);
			expect(Math.abs(leftNormal[1] - rightNormal[1])).toBeLessThan(1e-5);
			expect(Math.abs(leftNormal[2] - rightNormal[2])).toBeLessThan(1e-5);
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
		const radius = 0.5;
		const length = 1;
		const radialSegments = 12;
		const capSegments = 8;
		const geometry = createCapsule({ radius, length, radialSegments, capSegments });
		const positions = readPositions(geometry.vertices);
		const indices = readIndices(geometry.indices);
		const bodyTriangleCount = radialSegments * 2;
		const hemisphereTriangleCount = radialSegments + (capSegments - 1) * radialSegments * 2;
		const halfLength = length * 0.5;

		for (let triangleIndex = 0; triangleIndex < bodyTriangleCount; triangleIndex += 1) {
			const normal = resolveTriangleNormal(positions, indices, triangleIndex);
			const centroid = resolveTriangleCentroid(positions, indices, triangleIndex);
			const outward = [centroid[0], 0, centroid[2]] as [number, number, number];
			expect(dot(normal, outward)).toBeGreaterThan(1e-6);
		}

		const topPoleNormal = resolveTriangleNormal(positions, indices, bodyTriangleCount);
		const bottomPoleNormal = resolveTriangleNormal(
			positions,
			indices,
			bodyTriangleCount + hemisphereTriangleCount,
		);

		expect(hasPosition(positions, [0, halfLength + radius, 0])).toBe(true);
		expect(hasPosition(positions, [0, -(halfLength + radius), 0])).toBe(true);
		expect(hasPosition(positions, [0, halfLength, 0])).toBe(false);
		expect(hasPosition(positions, [0, -halfLength, 0])).toBe(false);
		expect(topPoleNormal[1]).toBeGreaterThan(0);
		expect(bottomPoleNormal[1]).toBeLessThan(0);
	});

	it('winds torus faces outward across the full ring', () => {
		const radius = 1;
		const geometry = createTorus({ radius, tube: 0.35, radialSegments: 12, tubularSegments: 24 });
		const positions = readPositions(geometry.vertices);
		const indices = readIndices(geometry.indices);
		const triangleCount = indices.length / 3;

		for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex += 1) {
			const normal = resolveTriangleNormal(positions, indices, triangleIndex);
			const centroid = resolveTriangleCentroid(positions, indices, triangleIndex);
			const centerLength = Math.hypot(centroid[0], centroid[2]);
			const center = [
				(centroid[0] / centerLength) * radius,
				0,
				(centroid[2] / centerLength) * radius,
			] as [number, number, number];
			const outward = [
				centroid[0] - center[0],
				centroid[1] - center[1],
				centroid[2] - center[2],
			] as [number, number, number];
			expect(dot(normal, outward)).toBeGreaterThan(1e-6);
		}
	});

	it('builds XY quads as single-sided by default', () => {
		const geometry = createQuad({ width: 1, height: 1, orientation: 'xy' });
		const positions = readPositions(geometry.vertices);
		const indices = readIndices(geometry.indices);
		const normals = Array.from({ length: indices.length / 3 }, (_, triangleIndex) =>
			resolveTriangleNormal(positions, indices, triangleIndex),
		);

		expect(indices).toHaveLength(6);
		expect(normals.every((normal) => normal[2] > 0)).toBe(true);
	});

	it('builds XY quads with front and back faces when requested', () => {
		const geometry = createQuad({ width: 1, height: 1, orientation: 'xy', doubleSided: true });
		const positions = readPositions(geometry.vertices);
		const indices = readIndices(geometry.indices);
		const normals = Array.from({ length: indices.length / 3 }, (_, triangleIndex) =>
			resolveTriangleNormal(positions, indices, triangleIndex),
		);

		expect(normals.some((normal) => normal[2] > 0)).toBe(true);
		expect(normals.some((normal) => normal[2] < 0)).toBe(true);
	});
});