import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMultiEntryConfig } from '../../build/create-package-config.mjs';

const packageDir = path.dirname(fileURLToPath(import.meta.url));

export default createMultiEntryConfig({
    packageDir,
    entries: {
        index: 'src/index.ts',
        types: 'src/types.ts',
        errors: 'src/errors.ts',
        memory: 'src/memory.ts',
        graph: 'src/graph.ts',
        'post-process': 'src/post-process.ts',
        pipeline: 'src/pipeline.ts',
        planner: 'src/planner.ts',
        'shader-effect': 'src/shader-effect.ts',
        'material-contract': 'src/material-contract.ts',
        'nine-slice': 'src/nine-slice.ts',
    },
});
