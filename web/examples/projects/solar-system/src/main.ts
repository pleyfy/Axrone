import type { PlaygroundSceneExample } from '../../shared/playground-types';
import { createSolarSystemScene } from './scene';

const example: PlaygroundSceneExample = {
	id: 'solar-system',
	title: 'Solar System',
	description: 'Three.js-style solar system rebuilt with Axrone spheres, orbit rings, and Kepler-inspired motion.',
	mount({ container }) {
		return createSolarSystemScene(container);
	},
};

export default example;