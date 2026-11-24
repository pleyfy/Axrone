import { Entity, Component, Transform, property, script } from '@axrone/ecs-runtime';
import { Vec3 } from '@axrone/numeric';

@script({
	scriptName: 'HydratedFollower',
})
export class HydratedFollower extends Component {
	@property({ type: EntityId })
	public targetEntity: EntityId | null = null;

	@property({ type: Transform })
	public targetTransform: Transform | null = null;

	@property({ type: 'vec3' })
	public offset = new Vec3(0, 0, 0);

	@property({ type: 'number' })
	public speed = 0;

	@property({ type: 'boolean' })
	public enabledFlag = false;

	@property({ type: 'string' })
	public tintHex = '#ffffff';
}
