import { script } from '@axrone/ecs-runtime/decorators';
import type { Rigidbody3D } from './rigidbody3d';
import { Joint3D, INVALID_CONSTRAINT_ID } from './joint3d';

/**
 * WASM-backed spring joint component.
 *
 * Mirrors the serialized field names and scriptName of the reference
 * `SpringJoint3D` in `physics-3d`.
 *
 * The WASM compat adapter does not expose constraint creation directly.
 * The constraint definition is stored locally; a higher-level bridge
 * materializes it against the inner WasmPhysicsWorld3D when available.
 */
@script({ scriptName: 'SpringJoint3D' })
export class SpringJoint3D extends Joint3D {
    private _minDistance: number = 0;
    private _maxDistance: number = 0;
    private _spring: number = 0;
    private _damper: number = 0;
    private _tolerance: number = 0.025;
    private _autoConfigureDistance: boolean = true;

    get minDistance(): number {
        return this._minDistance;
    }

    set minDistance(value: number) {
        this._minDistance = Math.max(0, value);
        this._updateConstraint();
    }

    get maxDistance(): number {
        return this._maxDistance;
    }

    set maxDistance(value: number) {
        this._maxDistance = Math.max(0, value);
        this._updateConstraint();
    }

    get springValue(): number {
        return this._spring;
    }

    set springValue(value: number) {
        this._spring = Math.max(0, value);
        this._updateConstraint();
    }

    get damper(): number {
        return this._damper;
    }

    set damper(value: number) {
        this._damper = Math.max(0, value);
        this._updateConstraint();
    }

    get tolerance(): number {
        return this._tolerance;
    }

    set tolerance(value: number) {
        this._tolerance = Math.max(0, value);
    }

    get autoConfigureDistance(): boolean {
        return this._autoConfigureDistance;
    }

    set autoConfigureDistance(value: boolean) {
        this._autoConfigureDistance = value;
        if (value) this._configureDistance();
    }

    protected override _createConstraint(_ownerBody: Rigidbody3D): void {
        // WASM compat does not expose createSpringJoint.
        this._constraintId = INVALID_CONSTRAINT_ID;
    }

    protected override _updateConstraint(): void {
        this._recreateConstraint();
    }

    override serialize(): Record<string, any> {
        return {
            ...super.serialize(),
            minDistance: this._minDistance,
            maxDistance: this._maxDistance,
            spring: this._spring,
            damper: this._damper,
            tolerance: this._tolerance,
            autoConfigureDistance: this._autoConfigureDistance,
        };
    }

    override deserialize(data: Record<string, any>): void {
        super.deserialize(data);
        if (data.minDistance !== undefined) this._minDistance = Math.max(0, data.minDistance);
        if (data.maxDistance !== undefined) this._maxDistance = Math.max(0, data.maxDistance);
        if (data.spring !== undefined) this._spring = Math.max(0, data.spring);
        if (data.damper !== undefined) this._damper = Math.max(0, data.damper);
        if (data.tolerance !== undefined) this._tolerance = Math.max(0, data.tolerance);
        if (data.autoConfigureDistance !== undefined) this._autoConfigureDistance = !!data.autoConfigureDistance;
    }

    private _configureDistance(): void {
        if (!this._connectedBody || !this.transform) return;
        const worldAnchor = this._getWorldAnchor();
        const connectedPos = this._connectedBody.position;
        const connectedWorldAnchor = {
            x: connectedPos.x + this._connectedAnchor.x,
            y: connectedPos.y + this._connectedAnchor.y,
            z: connectedPos.z + this._connectedAnchor.z,
        };
        const dx = worldAnchor.x - connectedWorldAnchor.x;
        const dy = worldAnchor.y - connectedWorldAnchor.y;
        const dz = worldAnchor.z - connectedWorldAnchor.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        this._minDistance = dist;
        this._maxDistance = dist;
    }
}
