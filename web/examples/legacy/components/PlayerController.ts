import { Component, script, Transform } from '@axrone/ecs-runtime';
import { Quat, Vec3 } from '@axrone/numeric';

@script({ scriptName: 'PlayerController' })
export default class PlayerController extends Component {
    public speed = 5;
    public rotationSpeed = 10;
    private readonly _pressedKeys = new Set<string>();
    private _yaw = 0;

    onLoad(): void {
        const onKeyDown = (event: KeyboardEvent) => this._pressedKeys.add(event.code);
        const onKeyUp = (event: KeyboardEvent) => this._pressedKeys.delete(event.code);

        globalThis.addEventListener('keydown', onKeyDown);
        globalThis.addEventListener('keyup', onKeyUp);

        (this as any)._cleanupInput = () => {
            globalThis.removeEventListener('keydown', onKeyDown);
            globalThis.removeEventListener('keyup', onKeyUp);
        };

        const transform = this.transform as Transform | undefined;
        if (transform) {
            const forward = Quat.rotateVector(transform.rotation, Vec3.FORWARD, new Vec3()) as Vec3;
            this._yaw = Math.atan2(forward.x, forward.z);
        }
    }

    update(deltaTime: number): void {
        const transform = this.transform as Transform | undefined;
        if (!transform) return;

        const moveX =
            (this._pressedKeys.has('KeyD') ? 1 : 0) -
            (this._pressedKeys.has('KeyA') ? 1 : 0);
        const moveZ =
            (this._pressedKeys.has('KeyS') ? 1 : 0) -
            (this._pressedKeys.has('KeyW') ? 1 : 0);

        if (moveX !== 0 || moveZ !== 0) {
            const deltaSeconds = deltaTime / 1000;
            const direction = new Vec3(moveX, 0, moveZ).normalize();
            const speed = this.speed * deltaSeconds;
            const movement = new Vec3(
                direction.x * speed,
                direction.y * speed,
                direction.z * speed
            );

            const position = transform.position.clone();
            position.x += movement.x;
            position.z += movement.z;
            transform.position = position;

            const targetYaw = Math.atan2(direction.x, direction.z);
            const deltaYaw = Math.atan2(
                Math.sin(targetYaw - this._yaw),
                Math.cos(targetYaw - this._yaw)
            );
            this._yaw += deltaYaw * Math.min(1, this.rotationSpeed * deltaSeconds);
            transform.rotation = Quat.fromEuler(0, this._yaw, 0);
        }
    }

    onDestroy(): void {
        (this as any)._cleanupInput?.();
    }
}