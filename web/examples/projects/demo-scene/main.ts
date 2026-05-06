import type { PlaygroundSceneExample } from '../shared/playground-types';
import { createDemoScene } from './scene';

const example: PlaygroundSceneExample = {
	id: 'demo-scene',
	title: 'Demo Scene',
	description: 'Art-directed hero composition recreated with Axrone runtime primitives.',
	mount({ container }) {
		return createDemoScene(container);
	},
};

export default example;