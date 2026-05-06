import type { PlaygroundSceneExample } from '../shared/playground-types';
import { createDemoScene } from './scene';

const example: PlaygroundSceneExample = {
	id: 'demo-scene',
	title: 'Demo Scene',
	description: 'Three.js-style reference scene with a box, sphere, torus knot, and floor rebuilt on Axrone.',
	mount({ container }) {
		return createDemoScene(container);
	},
};

export default example;