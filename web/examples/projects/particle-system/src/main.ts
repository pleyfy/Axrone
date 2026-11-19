import type { PlaygroundSceneExample } from '../../shared/playground-types';
import { createParticleSystemScene } from './scene';

const example: PlaygroundSceneExample = {
	id: 'particle-system',
	title: 'Particle Nebula',
	description: 'Emerald particle nebula with soft additive embers, drifting dust, and layered depth.',
	mount({ container }) {
		return createParticleSystemScene(container);
	},
};

export default example;
