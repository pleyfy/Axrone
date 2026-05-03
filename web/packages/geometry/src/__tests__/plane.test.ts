import { describe, expect, it } from 'vitest';
import { createCircle, createPlane, createQuad, createRing } from '@axrone/geometry';

const readPositions = (
	vertices: { toUint8Array(): Uint8Array },
): Array<[number, number, number]> => {
	const bytes = vertices.toUint8Array();
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const positions: Array<[number, number, number]> = [];
	for (let offset = 0; offset < bytes.byteLength; offset += 32) {
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

const resolveFaceNormal = (
	positions: Array<[number, number, number]>,
	indices: number[],
): [number, number, number] => {
	const a = positions[indices[0]!]!;
	const b = positions[indices[1]!]!;
	const c = positions[indices[2]!]!;
	const ab: [number, number, number] = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
	const ac: [number, number, number] = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
	return [
		ab[1] * ac[2] - ab[2] * ac[1],
		ab[2] * ac[0] - ab[0] * ac[2],
		ab[0] * ac[1] - ab[1] * ac[0],
	];
};

describe('plane primitive winding', () => {
	it('creates XZ planes with upward-facing front faces', () => {
		const geometry = createPlane({ width: 1, height: 1 });
		const normal = resolveFaceNormal(readPositions(geometry.vertices), readIndices(geometry.indices));
		expect(normal[1]).toBeGreaterThan(0);
	});

	it('creates XZ quads with upward-facing front faces', () => {
		const geometry = createQuad({ width: 1, height: 1, orientation: 'xz' });
		const normal = resolveFaceNormal(readPositions(geometry.vertices), readIndices(geometry.indices));
		expect(normal[1]).toBeGreaterThan(0);
	});

	it('creates YZ quads with +X-facing front faces', () => {
		const geometry = createQuad({ width: 1, height: 1, orientation: 'yz' });
		const normal = resolveFaceNormal(readPositions(geometry.vertices), readIndices(geometry.indices));
		expect(normal[0]).toBeGreaterThan(0);
	});

	it('creates circles with upward-facing front faces', () => {
		const geometry = createCircle({ radius: 1, segments: 16 });
		const normal = resolveFaceNormal(readPositions(geometry.vertices), readIndices(geometry.indices));
		expect(normal[1]).toBeGreaterThan(0);
	});

	it('creates rings with upward-facing front faces', () => {
		const geometry = createRing({ innerRadius: 0.5, outerRadius: 1, segments: 16 });
		const normal = resolveFaceNormal(readPositions(geometry.vertices), readIndices(geometry.indices));
		expect(normal[1]).toBeGreaterThan(0);
	});
});