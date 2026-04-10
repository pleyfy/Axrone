export { Hierarchy } from '../../../../ecs/src/component-system/components/hierarchy';
export { Transform } from '../../../../ecs/src/component-system/components/transform';

import { Hierarchy } from '../../../../ecs/src/component-system/components/hierarchy';
import { Transform } from '../../../../ecs/src/component-system/components/transform';
(globalThis as any).Hierarchy = Hierarchy;
(globalThis as any).Transform = Transform;

export { Mat4, Vec3, Quat } from '@axrone/numeric';

export * from './physics';
