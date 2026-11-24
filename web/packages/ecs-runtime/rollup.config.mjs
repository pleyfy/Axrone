import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMultiEntryConfig } from '../../build/create-package-config.mjs';

const packageDir = path.dirname(fileURLToPath(import.meta.url));

export default createMultiEntryConfig({
    packageDir,
    entries: {
        index: 'src/index.ts',
        core: 'src/core.ts',
        world: 'src/world.ts',
        entity: 'src/entity.ts',
        component: 'src/component.ts',
        decorators: 'src/decorators.ts',
        components: 'src/components.ts',
        systems: 'src/systems.ts',
        observers: 'src/observers.ts',
        memory: 'src/memory.ts',
        archetype: 'src/archetype.ts',
        types: 'src/types.ts',
        storage: 'src/storage.ts',
        query: 'src/query.ts',
        support: 'src/support.ts',
    },
});
