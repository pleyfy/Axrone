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

export const PARTICLE_COUNT = 3000;
export const PARTICLE_POINT_SIZE = 0.02;
export const PARTICLE_HORIZONTAL_SPAN = 22;
export const PARTICLE_VERTICAL_SPAN = 12;
export const PARTICLE_CEILING = 14;
export const PARTICLE_CLEAR_COLOR = [0.9254901961, 0.9647058824, 1, 1] as const;
export const PARTICLE_GRID_MAJOR = [0.6901960784, 0.8, 0.9411764706] as const;
export const PARTICLE_GRID_MINOR = [0.8235294118, 0.9019607843, 0.9803921569] as const;
const PARTICLE_PALETTE = [
	[0.2274509804, 0.6509803922, 1, 1],
	[0.1411764706, 0.8823529412, 0.9490196078, 1],
	[0.4196078431, 0.5647058824, 1, 1],
	[0.7215686275, 0.7882352941, 1, 1],
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

console.log('ParticleEmitter class loaded');