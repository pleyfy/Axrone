export type SolarBodyConfig = {
	readonly id: string;
	readonly label: string;
	readonly radius: number;
	readonly orbitRadius: number;
	readonly orbitSpeed: number;
	readonly spinSpeed: number;
	readonly height: number;
	readonly color: readonly [number, number, number, number];
	readonly tilt?: number;
	readonly ringScale?: readonly [number, number, number];
	readonly moon?: {
		readonly radius: number;
		readonly orbitRadius: number;
		readonly orbitSpeed: number;
		readonly color: readonly [number, number, number, number];
	};
};

export const SOLAR_CLEAR_COLOR = [0.89, 0.93, 0.99, 1] as const;
export const SOLAR_AMBIENT = [0.3, 0.33, 0.41] as const;
export const SOLAR_KEY_LIGHT_DIRECTION = [0.5, -1, 0.26] as const;
export const SOLAR_KEY_LIGHT_COLOR = [1, 0.93, 0.84] as const;
export const SOLAR_FILL_LIGHT_DIRECTION = [-0.62, -0.25, -0.48] as const;
export const SOLAR_FILL_LIGHT_COLOR = [0.3, 0.45, 0.8] as const;

export const SOLAR_BODIES: readonly SolarBodyConfig[] = [
	{
		id: 'mercury',
		label: 'Mercury',
		radius: 0.2,
		orbitRadius: 2.2,
		orbitSpeed: 1.4,
		spinSpeed: 1.8,
		height: 0.05,
		color: [0.64, 0.58, 0.54, 1],
	},
	{
		id: 'venus',
		label: 'Venus',
		radius: 0.32,
		orbitRadius: 3.05,
		orbitSpeed: 0.98,
		spinSpeed: 1.3,
		height: 0.08,
		color: [0.89, 0.71, 0.35, 1],
	},
	{
		id: 'earth',
		label: 'Earth',
		radius: 0.38,
		orbitRadius: 4.15,
		orbitSpeed: 0.78,
		spinSpeed: 2.4,
		height: 0.1,
		color: [0.16, 0.48, 0.93, 1],
		moon: {
			radius: 0.11,
			orbitRadius: 0.72,
			orbitSpeed: 2.4,
			color: [0.82, 0.82, 0.84, 1],
		},
	},
	{
		id: 'mars',
		label: 'Mars',
		radius: 0.29,
		orbitRadius: 5.35,
		orbitSpeed: 0.62,
		spinSpeed: 1.6,
		height: -0.06,
		color: [0.82, 0.36, 0.2, 1],
	},
	{
		id: 'saturn',
		label: 'Saturn',
		radius: 0.68,
		orbitRadius: 7.65,
		orbitSpeed: 0.32,
		spinSpeed: 1.15,
		height: 0.16,
		color: [0.91, 0.78, 0.56, 1],
		tilt: 0.42,
		ringScale: [1.8, 1, 1.8],
	},
] as const;