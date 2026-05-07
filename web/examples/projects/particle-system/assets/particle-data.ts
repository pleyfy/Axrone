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
export const PARTICLE_CLEAR_COLOR = [0.9411764706, 0.9333333333, 0.9176470588, 1] as const;
export const PARTICLE_GRID_MAJOR = [0.8784313725, 0.8666666667, 0.8431372549] as const;
export const PARTICLE_GRID_MINOR = [0.9176470588, 0.9098039216, 0.8901960784] as const;

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
	return [0.8392156863, 0.4117647059, 0.1529411765, 1] as const;
};

console.log('ParticleEmitter class loaded');