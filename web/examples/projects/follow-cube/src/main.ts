import type { PlaygroundSceneExample } from '../../shared/playground-types';
import { createFollowCubeScene } from './scene';

const example: PlaygroundSceneExample = {
	id: 'follow-cube',
	title: 'Follow Cube Controller',
	description: 'Viewport-focused WASD movement with a polished follow camera and presentation floor.',
	mount({ container }) {
		return createFollowCubeScene(container);
	},
};

export default example;