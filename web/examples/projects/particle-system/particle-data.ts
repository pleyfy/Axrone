export type ParticleSeed = {
	readonly id: string;
	readonly orbitRadius: number;
	readonly speed: number;
	readonly phase: number;
	readonly heightOffset: number;
	readonly size: number;
	readonly wobble: number;
	readonly color: readonly [number, number, number, number];
};

const PARTICLE_PALETTE = [
	[0.97, 0.46, 0.18, 1],
	[0.21, 0.66, 0.42, 1],
	[0.17, 0.47, 0.95, 1],
	[0.95, 0.72, 0.21, 1],
	[0.69, 0.34, 0.92, 1],
	[0.11, 0.67, 0.82, 1],
] as const;

export const PARTICLE_CLEAR_COLOR = [0.943, 0.955, 0.934, 1] as const;
export const PARTICLE_AMBIENT = [0.32, 0.36, 0.31] as const;
export const PARTICLE_KEY_LIGHT_DIRECTION = [0.34, -1, 0.26] as const;
export const PARTICLE_KEY_LIGHT_COLOR = [1, 0.96, 0.88] as const;
export const PARTICLE_FILL_LIGHT_DIRECTION = [-0.64, -0.2, -0.52] as const;
export const PARTICLE_FILL_LIGHT_COLOR = [0.42, 0.54, 0.74] as const;

export const PARTICLE_SEEDS: readonly ParticleSeed[] = Array.from({ length: 24 }, (_, index) => ({
	id: `particle-${index + 1}`,
	orbitRadius: 1.4 + (index % 6) * 0.38,
	speed: 0.7 + (index % 5) * 0.18,
	phase: index * 0.52,
	heightOffset: ((index % 4) - 1.5) * 0.16,
	size: 0.1 + (index % 3) * 0.035,
	wobble: 1.1 + (index % 7) * 0.22,
	color: PARTICLE_PALETTE[index % PARTICLE_PALETTE.length]!,
}));