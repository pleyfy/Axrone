import type { PlaygroundSceneExample } from '../../shared/playground-types';
import { createPhysicsStackScene } from './scene';

const example: PlaygroundSceneExample = {
	id: 'physics-stack',
	title: 'Physics Stack',
	description: 'A stable box pyramid under gravity. Drag to orbit, click to drop another body into the stack.',
	mount({ container }) {
		return createPhysicsStackScene(container);
	},
};

export default example;
