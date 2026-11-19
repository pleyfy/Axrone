import type { PlaygroundSceneExample } from '../../shared/playground-types';
import { createSolarSystemScene } from './scene';

const example: PlaygroundSceneExample = {
	id: 'solar-system',
	title: 'Solar System',
	description: 'Deep-space orbital system with a glowing sun, banded planets, a moon, and drifting stars.',
	mount({ container }) {
		return createSolarSystemScene(container);
	},
};

export default example;
