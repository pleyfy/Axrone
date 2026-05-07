export type OrbitalBodyOptions = {
	readonly mass?: number;
	readonly semiMajorAxis?: number;
	readonly eccentricity?: number;
	readonly period?: number;
	readonly meanAnomaly?: number;
};

export type SolarPlanetDefinition = {
	readonly id: string;
	readonly label: string;
	readonly radius: number;
	readonly distance: number;
	readonly color: readonly [number, number, number, number];
	readonly speed: number;
	readonly tilt: number;
	readonly roughness: number;
	readonly eccentricity: number;
	readonly period: number;
	readonly meanAnomaly: number;
	readonly ring?: {
		readonly innerRadius: number;
		readonly outerRadius: number;
		readonly tilt: number;
		readonly opacity: number;
		readonly color: readonly [number, number, number, number];
	};
};

const rgbFromHex = (hex: number): readonly [number, number, number] => [
	((hex >> 16) & 0xff) / 255,
	((hex >> 8) & 0xff) / 255,
	(hex & 0xff) / 255,
] as const;

const rgbaFromHex = (hex: number, alpha = 1): readonly [number, number, number, number] => [
	((hex >> 16) & 0xff) / 255,
	((hex >> 8) & 0xff) / 255,
	(hex & 0xff) / 255,
	alpha,
] as const;

const periodFromSpeed = (speed: number): number => (Math.PI * 2) / (speed * 0.24);

export class OrbitalBody {
	mass: number;
	a: number;
	e: number;
	period: number;
	meanAnomaly: number;

	constructor(options: OrbitalBodyOptions = {}) {
		this.mass = options.mass ?? 1;
		this.a = options.semiMajorAxis ?? 1;
		this.e = options.eccentricity ?? 0;
		this.period = options.period ?? 1;
		this.meanAnomaly = options.meanAnomaly ?? 0;
	}

	getPosition(t: number): { x: number; y: number } {
		const meanAnomaly = this.meanAnomaly + (2 * Math.PI * t) / this.period;
		const eccentricAnomaly = this.solveKepler(meanAnomaly);
		const x = this.a * (Math.cos(eccentricAnomaly) - this.e);
		const y = this.a * Math.sqrt(1 - this.e * this.e) * Math.sin(eccentricAnomaly);
		return { x, y };
	}

	solveKepler(meanAnomaly: number, tolerance = 1e-6): number {
		let eccentricAnomaly = meanAnomaly;
		for (let iteration = 0; iteration < 20; iteration += 1) {
			const delta =
				(eccentricAnomaly - this.e * Math.sin(eccentricAnomaly) - meanAnomaly) /
				(1 - this.e * Math.cos(eccentricAnomaly));
			eccentricAnomaly -= delta;
			if (Math.abs(delta) < tolerance) {
				break;
			}
		}
		return eccentricAnomaly;
	}
}

export const SOLAR_CLEAR_COLOR = rgbaFromHex(0xe8f4ff);
export const SOLAR_AMBIENT_LIGHT = [0.18, 0.24, 0.32] as const;
export const SOLAR_GRID_MAJOR = rgbFromHex(0x8aaee0);
export const SOLAR_GRID_MINOR = rgbFromHex(0xc7def7);
export const SOLAR_SUN_COLOR = rgbaFromHex(0xdff6ff);
export const SOLAR_SUN_WIREFRAME_COLOR = rgbaFromHex(0x5b9bc9);
export const SOLAR_LIGHT_COLOR = rgbFromHex(0xc9eeff);
export const SOLAR_LIGHT_INTENSITY = 1.8;
export const SOLAR_LIGHT_RANGE = 100;

export const SOLAR_PLANETS: readonly SolarPlanetDefinition[] = [
	{
		id: 'mercury',
		label: 'Mercury',
		radius: 0.35,
		distance: 7,
		color: rgbaFromHex(0x91a7c7),
		speed: 4.7,
		tilt: 0.03,
		roughness: 0.6,
		eccentricity: 0.205,
		period: periodFromSpeed(4.7),
		meanAnomaly: 0.35,
	},
	{
		id: 'venus',
		label: 'Venus',
		radius: 0.6,
		distance: 10,
		color: rgbaFromHex(0xc8d7ff),
		speed: 1.85,
		tilt: 2.6,
		roughness: 0.6,
		eccentricity: 0.007,
		period: periodFromSpeed(1.85),
		meanAnomaly: 1.1,
	},
	{
		id: 'earth',
		label: 'Earth',
		radius: 0.65,
		distance: 14,
		color: rgbaFromHex(0x2563eb),
		speed: 1,
		tilt: 0.41,
		roughness: 0.6,
		eccentricity: 0.017,
		period: periodFromSpeed(1),
		meanAnomaly: 2.25,
	},
	{
		id: 'mars',
		label: 'Mars',
		radius: 0.45,
		distance: 18,
		color: rgbaFromHex(0x7d7cff),
		speed: 0.53,
		tilt: 0.44,
		roughness: 0.6,
		eccentricity: 0.093,
		period: periodFromSpeed(0.53),
		meanAnomaly: 0.9,
	},
	{
		id: 'jupiter',
		label: 'Jupiter',
		radius: 1.6,
		distance: 25,
		color: rgbaFromHex(0x61c7ff),
		speed: 0.08,
		tilt: 0.05,
		roughness: 0.6,
		eccentricity: 0.049,
		period: periodFromSpeed(0.08),
		meanAnomaly: 1.8,
	},
	{
		id: 'saturn',
		label: 'Saturn',
		radius: 1.3,
		distance: 32,
		color: rgbaFromHex(0xdaf4ff),
		speed: 0.03,
		tilt: 0.47,
		roughness: 0.6,
		eccentricity: 0.056,
		period: periodFromSpeed(0.03),
		meanAnomaly: 2.8,
		ring: {
			innerRadius: 1.8,
			outerRadius: 2.8,
			tilt: Math.PI / 3,
			opacity: 0.5,
			color: rgbaFromHex(0xc9ecff, 0.5),
		},
	},
	{
		id: 'neptune',
		label: 'Neptune',
		radius: 1,
		distance: 40,
		color: rgbaFromHex(0x1d4ed8),
		speed: 0.01,
		tilt: 0.49,
		roughness: 0.6,
		eccentricity: 0.009,
		period: periodFromSpeed(0.01),
		meanAnomaly: 0.55,
	},
] as const;

console.log('OrbitalBody class loaded');