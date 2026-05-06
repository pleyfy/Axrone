export type TerrainColumn = {
	readonly id: string;
	readonly x: number;
	readonly z: number;
	readonly height: number;
	readonly band: 'low' | 'mid' | 'high';
};

export const TERRAIN_CLEAR_COLOR = [0.95, 0.944, 0.921, 1] as const;
export const TERRAIN_AMBIENT = [0.34, 0.31, 0.27] as const;
export const TERRAIN_KEY_LIGHT_DIRECTION = [0.38, -1, 0.14] as const;
export const TERRAIN_KEY_LIGHT_COLOR = [0.99, 0.94, 0.86] as const;
export const TERRAIN_FILL_LIGHT_DIRECTION = [-0.55, -0.32, -0.44] as const;
export const TERRAIN_FILL_LIGHT_COLOR = [0.42, 0.52, 0.66] as const;

const TERRAIN_SIZE = 11;
const CELL_SPACING = 0.88;

const sampleHeight = (gridX: number, gridZ: number): number => {
	const ridge = Math.sin(gridX * 0.7) * 0.58 + Math.cos(gridZ * 0.55) * 0.42;
	const basin = Math.cos((gridX + gridZ) * 0.28) * 0.22;
	const rawHeight = 0.38 + (ridge + basin + 1.2) * 0.62;
	return Math.max(0.18, Number(rawHeight.toFixed(3)));
};

export const TERRAIN_COLUMNS: readonly TerrainColumn[] = Array.from(
	{ length: TERRAIN_SIZE * TERRAIN_SIZE },
	(_, index) => {
		const gridX = index % TERRAIN_SIZE;
		const gridZ = Math.floor(index / TERRAIN_SIZE);
		const x = (gridX - (TERRAIN_SIZE - 1) * 0.5) * CELL_SPACING;
		const z = (gridZ - (TERRAIN_SIZE - 1) * 0.5) * CELL_SPACING;
		const height = sampleHeight(gridX, gridZ);
		const band = height < 0.95 ? 'low' : height < 1.45 ? 'mid' : 'high';

		return {
			id: `column-${gridX}-${gridZ}`,
			x,
			z,
			height,
			band,
		} satisfies TerrainColumn;
	},
);