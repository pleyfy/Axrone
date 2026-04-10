export { Hierarchy, Transform } from '@axrone/ecs';
export * from './physics';

import { Hierarchy, Transform } from '@axrone/ecs';

(globalThis as any).Hierarchy = Hierarchy;
(globalThis as any).Transform = Transform;