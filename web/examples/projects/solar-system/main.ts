import type { PlaygroundSceneExample } from '../shared/playground-types';
import { createSolarSystemScene } from './scene';

const example: PlaygroundSceneExample = {
	id: 'solar-system',
	title: 'Solar System',
	description: 'Animated orbital system recreated with Axrone scene primitives.',
	mount({ container }) {
		return createSolarSystemScene(container);
	},
};

export default example;