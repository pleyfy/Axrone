import type { PlaygroundSceneExample } from '../../shared/playground-types';
import { createDemoScene } from './scene';

const example: PlaygroundSceneExample = {
	id: 'demo-scene',
	title: 'Material Study',
	description: 'Quiet material study with a clay cube, glazed sphere, and brass cylinder on a lit plinth.',
	mount({ container }) {
		return createDemoScene(container);
	},
};

export default example;
