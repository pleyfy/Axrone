import { script } from '@axrone/ecs-runtime/decorators';
import type { Rigidbody3D } from './rigidbody3d';
import { Joint3D, INVALID_CONSTRAINT_ID } from './joint3d';

/**
 * WASM-backed fixed joint component.
 *
 * Mirrors the serialized field names and scriptName of the reference
 * `FixedJoint3D` in `physics-3d`.
 *
 * The WASM compat adapter does not expose constraint creation directly.
 * The constraint definition is stored locally; a higher-level bridge
 * materializes it against the inner WasmPhysicsWorld3D when available.
 */
@script({ scriptName: 'FixedJoint3D' })
export class FixedJoint3D extends Joint3D {
    protected override _createConstraint(_ownerBody: Rigidbody3D): void {
        // WASM compat does not expose createFixedJoint.
        // Store definition locally for bridge-level materialization.
        this._constraintId = INVALID_CONSTRAINT_ID;
    }

    protected override _updateConstraint(): void {
        this._recreateConstraint();
    }
}
