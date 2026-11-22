import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMultiEntryConfig } from '../../build/create-package-config.mjs';

const packageDir = path.dirname(fileURLToPath(import.meta.url));

export default createMultiEntryConfig({
    packageDir,
    entries: {
        index: 'src/index.ts',
        facade: 'src/facade.ts',
        support: 'src/support.ts',
        profile: 'src/profile.ts',
        types: 'src/types.ts',
        lean: 'src/lean.ts',
        tilemap: 'src/tilemap.ts',
        errors: 'src/errors.ts',
    },
});
