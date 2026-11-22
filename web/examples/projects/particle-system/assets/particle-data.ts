export type ParticleVector = {
	x: number;
	y: number;
	z: number;
};

export type EmittedParticle = {
	readonly position: ParticleVector;
	readonly velocity: ParticleVector;
	life: number;
};

export type ParticleEmitterOptions = {
	readonly rate?: number;
	readonly lifetime?: number;
	readonly speed?: number;
	readonly spread?: number;
};

export const PARTICLE_COUNT = 5000;
export const PARTICLE_POINT_SIZE = 0.085;
export const PARTICLE_HORIZONTAL_SPAN = 22;
export const PARTICLE_VERTICAL_SPAN = 12;
export const PARTICLE_CEILING = 14;
export const PARTICLE_CLEAR_COLOR = [0.008, 0.03, 0.026, 0] as const;
export const PARTICLE_GRID_MAJOR = [0.12, 0.3, 0.26] as const;
export const PARTICLE_GRID_MINOR = [0.06, 0.16, 0.14] as const;
export const PARTICLE_DUST_COUNT = 320;
export const PARTICLE_DUST_POINT_SIZE = 0.17;
const PARTICLE_PALETTE = [
	[1, 0.64, 0.28, 1],
	[0.42, 0.94, 0.72, 1],
	[1, 0.43, 0.38, 1],
	[0.86, 0.97, 0.94, 1],
	[0.24, 0.8, 0.72, 1],
] as const;

export class ParticleEmitter {
	readonly rate: number;
	readonly lifetime: number;
	readonly speed: number;
	readonly spread: number;

	constructor(options: ParticleEmitterOptions = {}) {
		this.rate = options.rate ?? 10;
		this.lifetime = options.lifetime ?? 3;
		this.speed = options.speed ?? 1;
		this.spread = options.spread ?? Math.PI / 4;
	}

	emit(origin: Readonly<ParticleVector>, count: number): EmittedParticle[] {
		return Array.from({ length: count }, () => this.emitOne(origin));
	}

	emitOne(origin: Readonly<ParticleVector>): EmittedParticle {
		return {
			position: { x: origin.x, y: origin.y, z: origin.z },
			velocity: {
				x: (Math.random() - 0.5) * this.spread,
				y: Math.random() * this.speed,
				z: (Math.random() - 0.5) * this.spread,
			},
			life: this.lifetime,
		};
	}
}

export const createParticleColor = (): readonly [number, number, number, number] => {
	const color = PARTICLE_PALETTE[Math.floor(Math.random() * PARTICLE_PALETTE.length)] ?? PARTICLE_PALETTE[0];
	return [color[0], color[1], color[2], 0.76 + Math.random() * 0.24] as const;
};
