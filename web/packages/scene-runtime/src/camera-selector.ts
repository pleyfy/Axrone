import type { Actor } from '../../core/src/component-system/core/actor';
import { Camera } from './components/camera';

export const selectSceneCamera = (actors: readonly Actor[]): Camera | undefined => {
    let fallback: Camera | undefined;

    for (const actor of actors) {
        if (!actor.active) {
            continue;
        }

        const camera = actor.getComponent(Camera);
        if (!camera || !camera.enabled) {
            continue;
        }

        if (camera.primary) {
            return camera;
        }

        if (!fallback) {
            fallback = camera;
        }
    }

    return fallback;
};
