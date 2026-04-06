export { Hierarchy } from './hierarchy';
export { Transform } from './transform';

import { Hierarchy } from './hierarchy';
import { Transform } from './transform';
(globalThis as any).Hierarchy = Hierarchy;
(globalThis as any).Transform = Transform;

export { Mat4, Vec3, Quat } from '@axrone/numeric';

export * from './physics';
