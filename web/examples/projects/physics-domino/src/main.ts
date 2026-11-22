import type { PlaygroundSceneExample } from '../../shared/playground-types';
import { createPhysicsDominoScene } from './scene';

const example: PlaygroundSceneExample = {
	id: 'physics-domino',
	title: 'Domino Run',
	description: 'A single nudge starts a chain reaction across a row of sixteen dominoes on a display plinth.',
	mount({ container }) {
		return createPhysicsDominoScene(container);
	},
};

export default example;
