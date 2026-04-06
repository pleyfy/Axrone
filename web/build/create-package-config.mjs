import fs from 'node:fs';
import path from 'node:path';
import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';
import commonjs from '@rollup/plugin-commonjs';
import resolve from '@rollup/plugin-node-resolve';
import typescript from 'rollup-plugin-typescript2';
import dts from 'rollup-plugin-dts';
import peerDepsExternal from 'rollup-plugin-peer-deps-external';

const buildDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceDir = path.resolve(buildDir, '..');
const defaultTsconfigPath = path.join(workspaceDir, 'tsconfig.build.json');

const builtinModuleIds = new Set([
    ...builtinModules,
    ...builtinModules.map((moduleName) => `node:${moduleName}`),
]);

const createExternalMatcher = (packageJson, additionalExternalIds) => {
    const packageIds = new Set([
        ...Object.keys(packageJson.dependencies ?? {}),
        ...Object.keys(packageJson.peerDependencies ?? {}),
        ...additionalExternalIds,
    ]);

    return (id) => {
        if (builtinModuleIds.has(id)) {
            return true;
        }

        for (const packageId of packageIds) {
            if (id === packageId || id.startsWith(`${packageId}/`)) {
                return true;
            }
        }

        return false;
    };
};

export const createPackageConfig = ({ packageDir, external = [] }) => {
    const packageJsonPath = path.join(packageDir, 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const packageTsconfigPath = fs.existsSync(path.join(packageDir, 'tsconfig.build.json'))
        ? path.join(packageDir, 'tsconfig.build.json')
        : defaultTsconfigPath;
    const input = path.join(packageDir, 'src/index.ts');
    const distDir = path.join(packageDir, 'dist');
    const isExternal = createExternalMatcher(packageJson, external);

    return [
        {
            input,
            external: isExternal,
            output: [
                {
                    file: path.join(distDir, 'index.js'),
                    format: 'cjs',
                    sourcemap: true,
                    exports: 'named',
                },
                {
                    file: path.join(distDir, 'index.mjs'),
                    format: 'es',
                    sourcemap: true,
                },
            ],
            plugins: [
                peerDepsExternal(),
                resolve({
                    extensions: ['.mjs', '.js', '.json', '.ts'],
                }),
                commonjs(),
                typescript({
                    tsconfig: packageTsconfigPath,
                    clean: true,
                    useTsconfigDeclarationDir: false,
                    tsconfigOverride: {
                        compilerOptions: {
                            declaration: false,
                            declarationMap: false,
                        },
                    },
                }),
            ],
        },
        {
            input,
            external: isExternal,
            output: {
                file: path.join(distDir, 'index.d.ts'),
                format: 'es',
            },
            plugins: [
                dts({
                    tsconfig: packageTsconfigPath,
                }),
            ],
        },
    ];
};
