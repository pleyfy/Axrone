import type { ComponentConstructor } from '@axrone/ecs-runtime';
import { SceneCapabilityError } from './errors';

export interface SceneCapabilityGuardHost {
    isComponentRegistered(componentTypeOrName: string | ComponentConstructor): boolean;
}

export const requireRegisteredComponent = (
    host: SceneCapabilityGuardHost,
    componentType: ComponentConstructor,
    message: string
): void => {
    if (host.isComponentRegistered(componentType)) {
        return;
    }

    throw new SceneCapabilityError(message);
};
