import type { PlaygroundSceneExample } from '../../shared/playground-types';
import { createPhysicsBounceScene } from './scene';

const example: PlaygroundSceneExample = {
	id: 'physics-bounce',
	title: 'Bounce Lab',
	description: 'High-restitution spheres rain into a dark test chamber. Click to drop another ball and watch it bounce.',
	mount({ container }) {
		return createPhysicsBounceScene(container);
	},
};

export default example;
