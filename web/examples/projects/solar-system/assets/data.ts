export type OrbitalBodyOptions = {
	readonly mass?: number;
	readonly semiMajorAxis?: number;
	readonly eccentricity?: number;
	readonly period?: number;
	readonly meanAnomaly?: number;
};

export type SolarBandDefinition = {
	readonly color: readonly [number, number, number];
	readonly strength: number;
	readonly frequency: number;
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
	readonly bands?: SolarBandDefinition;
	readonly rim?: {
		readonly color: readonly [number, number, number];
		readonly strength: number;
	};
	readonly moon?: {
		readonly radius: number;
		readonly distance: number;
		readonly speed: number;
		readonly color: readonly [number, number, number, number];
	};
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

export const SOLAR_CLEAR_COLOR = rgbaFromHex(0x05070e, 0);
export const SOLAR_AMBIENT_LIGHT = [0.18, 0.2, 0.3] as const;
export const SOLAR_GRID_MAJOR = rgbFromHex(0x141d33);
export const SOLAR_GRID_MINOR = rgbFromHex(0x0b1220);
export const SOLAR_SUN_COLOR = rgbaFromHex(0xe8952c);
export const SOLAR_SUN_WIREFRAME_COLOR = rgbaFromHex(0xc97b22);
export const SOLAR_LIGHT_COLOR = rgbFromHex(0xffd08a);
export const SOLAR_LIGHT_INTENSITY = 1.8;
export const SOLAR_LIGHT_RANGE = 150;

export const SOLAR_PLANETS: readonly SolarPlanetDefinition[] = [
	{
		id: 'mercury',
		label: 'Mercury',
		radius: 0.35,
		distance: 7,
		color: rgbaFromHex(0xb9ab9a),
		speed: 4.7,
		tilt: 0.03,
		roughness: 0.72,
		eccentricity: 0.205,
		period: periodFromSpeed(4.7),
		meanAnomaly: 0.35,
		rim: { color: rgbFromHex(0xd8c8b6), strength: 0.1 },
	},
	{
		id: 'venus',
		label: 'Venus',
		radius: 0.6,
		distance: 10.5,
		color: rgbaFromHex(0xe8c07e),
		speed: 1.85,
		tilt: 2.6,
		roughness: 0.54,
		eccentricity: 0.007,
		period: periodFromSpeed(1.85),
		meanAnomaly: 1.1,
		bands: { color: rgbFromHex(0xf6dfb7), strength: 0.32, frequency: 12 },
		rim: { color: rgbFromHex(0xffe9b8), strength: 0.14 },
	},
	{
		id: 'earth',
		label: 'Earth',
		radius: 0.65,
		distance: 14.5,
		color: rgbaFromHex(0x2f8fa8),
		speed: 1,
		tilt: 0.41,
		roughness: 0.48,
		eccentricity: 0.017,
		period: periodFromSpeed(1),
		meanAnomaly: 2.25,
		bands: { color: rgbFromHex(0x57b7a9), strength: 0.26, frequency: 7 },
		rim: { color: rgbFromHex(0x8bd7e6), strength: 0.26 },
		moon: {
			radius: 0.17,
			distance: 1.5,
			speed: 2.4,
			color: rgbaFromHex(0xc7c1b6),
		},
	},
	{
		id: 'mars',
		label: 'Mars',
		radius: 0.45,
		distance: 19,
		color: rgbaFromHex(0xc8694b),
		speed: 0.53,
		tilt: 0.44,
		roughness: 0.66,
		eccentricity: 0.093,
		period: periodFromSpeed(0.53),
		meanAnomaly: 0.9,
		bands: { color: rgbFromHex(0xde9271), strength: 0.18, frequency: 9 },
		rim: { color: rgbFromHex(0xe9a07d), strength: 0.16 },
	},
	{
		id: 'jupiter',
		label: 'Jupiter',
		radius: 1.65,
		distance: 27,
		color: rgbaFromHex(0xc9a376),
		speed: 0.08,
		tilt: 0.05,
		roughness: 0.58,
		eccentricity: 0.049,
		period: periodFromSpeed(0.08),
		meanAnomaly: 1.8,
		bands: { color: rgbFromHex(0xe9d0ae), strength: 0.5, frequency: 11 },
		rim: { color: rgbFromHex(0xf0dcbe), strength: 0.14 },
	},
	{
		id: 'saturn',
		label: 'Saturn',
		radius: 1.35,
		distance: 35,
		color: rgbaFromHex(0xe0c98f),
		speed: 0.03,
		tilt: 0.47,
		roughness: 0.6,
		eccentricity: 0.056,
		period: periodFromSpeed(0.03),
		meanAnomaly: 2.8,
		bands: { color: rgbFromHex(0xf3e4bd), strength: 0.42, frequency: 14 },
		rim: { color: rgbFromHex(0xf8eac8), strength: 0.16 },
		ring: {
			innerRadius: 1.8,
			outerRadius: 2.8,
			tilt: Math.PI / 3,
			opacity: 0.45,
			color: rgbaFromHex(0xd9bf87, 0.45),
		},
	},
	{
		id: 'neptune',
		label: 'Neptune',
		radius: 1,
		distance: 44,
		color: rgbaFromHex(0x5566c9),
		speed: 0.01,
		tilt: 0.49,
		roughness: 0.5,
		eccentricity: 0.009,
		period: periodFromSpeed(0.01),
		meanAnomaly: 0.55,
		bands: { color: rgbFromHex(0x7c8ce2), strength: 0.2, frequency: 6 },
		rim: { color: rgbFromHex(0x8fa2ff), strength: 0.26 },
	},
] as const;
