import type { PlaygroundSceneExample } from '../../shared/playground-types';
import { createFollowCubeScene } from './scene';

const example: PlaygroundSceneExample = {
	id: 'follow-cube',
	title: 'Follow Cube',
	description: 'Sunset arena with a rounded player cube, contact shadow, and WASD follow-camera movement.',
	mount({ container }) {
		return createFollowCubeScene(container);
	},
};

export default example;
