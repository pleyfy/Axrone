import type { PlaygroundSceneExample } from '../shared/playground-types';
import { createTerrainScene } from './scene';

const example: PlaygroundSceneExample = {
	id: 'terrain-generator',
	title: 'Terrain Generator',
	description: 'Procedural ridge field recreated with Axrone scene primitives.',
	mount({ container }) {
		return createTerrainScene(container);
	},
};

export default example;