import type { PlaygroundSceneExample } from '../../shared/playground-types';
import { createParticleSystemScene } from './scene';

const example: PlaygroundSceneExample = {
	id: 'particle-system',
	title: 'Particle System',
	description: 'Three.js-style floating particle cloud rebuilt with Axrone point rendering and emitter utilities.',
	mount({ container }) {
		return createParticleSystemScene(container);
	},
};

export default example;