import { blendWorldPose } from '@axrone/animation';
import { Transform } from '@axrone/ecs-runtime';
import type { Actor } from '@axrone/ecs-runtime';
import type { Animator } from './animator';

interface SceneRagdollBinding {
    readonly animator: Animator;
    readonly boneActors: readonly Actor[];
    readonly positions: Float32Array;
    readonly rotations: Float32Array;
    captured: boolean;
}

/**
 * Binds one animated actor's bones to scene actors driven by physics and blends
 * their world transforms into the animation pose.
 *
 * The physics layer creates the bodies and joints; this source only reads the
 * resulting actor transforms, so it stays independent of a specific ragdoll
 * solver. The call order is explicit because it matters:
 *
 * 1. the physics step writes the bone actors,
 * 2. {@link capture} reads their world pose,
 * 3. the animator advances its own pose,
 * 4. {@link apply} blends the captured pose into the animator frame and
 *    republishes it to the scene.
 */
export class SceneRagdollPoseSource {
    private readonly _bindings = new Map<Animator, SceneRagdollBinding>();

    /** Number of bound ragdolls. */
    get count(): number {
        return this._bindings.size;
    }

    /**
     * Binds bone actors in rig order. The array length must equal the rig's
     * bone count at apply time; rebinding replaces the previous mapping.
     */
    bind(animator: Animator, boneActors: readonly Actor[]): void {
        const controller = animator.controller;
        if (!controller) {
            throw new Error('Cannot bind a ragdoll to an animator without a controller');
        }

        const boneCount = controller.rig.boneCount;
        if (boneActors.length !== boneCount) {
            throw new Error(
                `Ragdoll binding requires ${boneCount} bone actors but received ${boneActors.length}`
            );
        }

        this._bindings.set(animator, {
            animator,
            boneActors: Object.freeze([...boneActors]),
            positions: new Float32Array(boneCount * 3),
            rotations: new Float32Array(boneCount * 4),
            captured: false,
        });
    }

    /** Removes a binding. */
    unbind(animator: Animator): boolean {
        return this._bindings.delete(animator);
    }

    /** Whether an animator is bound. */
    has(animator: Animator): boolean {
        return this._bindings.has(animator);
    }

    /**
     * Reads the physics-driven world pose of every bound bone actor. Call after
     * the physics step and before the animator writes its pose.
     */
    capture(): number {
        let captured = 0;
        for (const binding of this._bindings.values()) {
            binding.captured = this._captureBinding(binding);
            if (binding.captured) {
                captured += 1;
            }
        }
        return captured;
    }

    /**
     * Blends the captured physics pose into the animator frame and republishes
     * the pose. Returns the number of ragdolls that were applied.
     */
    apply(weight: number = 1): number {
        const resolvedWeight = Math.max(0, Math.min(1, Number.isFinite(weight) ? weight : 0));
        if (resolvedWeight <= 0) {
            return 0;
        }

        let applied = 0;
        for (const binding of this._bindings.values()) {
            if (!binding.captured) {
                continue;
            }
            const controller = binding.animator.controller;
            if (!controller) {
                continue;
            }
            blendWorldPose(
                controller.rig,
                controller.currentFrame.pose,
                binding.positions,
                binding.rotations,
                resolvedWeight
            );
            binding.animator.applyCurrentPose();
            applied += 1;
        }
        return applied;
    }

    /** Drops every binding. */
    clear(): void {
        this._bindings.clear();
    }

    private _captureBinding(binding: SceneRagdollBinding): boolean {
        const controller = binding.animator.controller;
        if (!controller) {
            return false;
        }

        const boneCount = controller.rig.boneCount;
        if (binding.boneActors.length !== boneCount) {
            return false;
        }

        for (let index = 0; index < boneCount; index += 1) {
            const actor = binding.boneActors[index]!;
            if (!actor || actor.isDestroyed) {
                return false;
            }
            const transform = actor.getComponent(Transform);
            if (!transform) {
                return false;
            }

            const position = transform.worldPosition;
            const rotation = transform.worldRotation;
            binding.positions[index * 3] = position.x;
            binding.positions[index * 3 + 1] = position.y;
            binding.positions[index * 3 + 2] = position.z;
            binding.rotations[index * 4] = rotation.x;
            binding.rotations[index * 4 + 1] = rotation.y;
            binding.rotations[index * 4 + 2] = rotation.z;
            binding.rotations[index * 4 + 3] = rotation.w;
        }

        return true;
    }
}
