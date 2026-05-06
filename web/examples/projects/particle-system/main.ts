import type { PlaygroundSceneExample } from '../shared/playground-types';
import { createParticleSystemScene } from './scene';

const example: PlaygroundSceneExample = {
	id: 'particle-system',
	title: 'Particle System',
	description: 'Animated kinetic particle arrangement recreated with Axrone scene actors.',
	mount({ container }) {
		return createParticleSystemScene(container);
	},
};

export default example;