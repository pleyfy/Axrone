import type { ComponentType, ComponentMetadata } from '../types/component';
import type { Component } from '../core/component';

export interface ScriptMetadata extends ComponentMetadata {
    readonly version?: string;
    readonly author?: string;
    readonly description?: string;
    readonly tags?: readonly string[];
    readonly experimental?: boolean;
    readonly deprecated?: boolean;
    readonly deprecationMessage?: string;
}

export interface ScriptDecoratorOptions extends Partial<ScriptMetadata> {
    readonly validateDependencies?: boolean;
    readonly enableMetrics?: boolean;
    readonly enableCaching?: boolean;
    readonly strictMode?: boolean;
    readonly hotReload?: boolean;
}

export interface ValidationResult {
    readonly isValid: boolean;
    readonly errors: readonly string[];
    readonly warnings: readonly string[];
}

interface ScriptRegistryEntry {
    readonly metadata: ScriptMetadata;
    readonly componentType: ComponentType;
    readonly registrationTime: number;
    readonly validationResult: ValidationResult;
    accessCount: number;
    lastAccessed: number;
}

const SCRIPT_DECORATOR_VERSION = '1.0.0';
const DEFAULT_CACHE_TTL = 5000;
const MAX_REGISTRY_SIZE = 10000;
const CLEANUP_THRESHOLD = 1000;

const componentMetadataMap = new WeakMap<ComponentType, ScriptMetadata>();

const scriptRegistry = new Map<string, ScriptRegistryEntry>();

const dependencyGraph = new Map<ComponentType, Set<ComponentType>>();

const metricsCache = new Map<
    string,
    {
        data: any;
        timestamp: number;
        ttl: number;
    }
>();

function validateScriptMetadata(
    componentType: ComponentType,
    metadata: ScriptMetadata
): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!metadata.scriptName || typeof metadata.scriptName !== 'string') {
        errors.push('Script name is required and must be a string');
    }

    if (metadata.scriptName && metadata.scriptName.length > 100) {
        warnings.push('Script name is unusually long (>100 characters)');
    }

    if (metadata.priority !== undefined) {
        if (typeof metadata.priority !== 'number') {
            errors.push('Priority must be a number');
        } else if (!Number.isInteger(metadata.priority)) {
            errors.push('Priority must be an integer');
        } else if (metadata.priority < -1000 || metadata.priority > 1000) {
            warnings.push('Priority outside recommended range (-1000 to 1000)');
        }
    }

    if (metadata.dependencies) {
        if (!Array.isArray(metadata.dependencies)) {
            errors.push('Dependencies must be an array');
        } else {
            for (const dep of metadata.dependencies) {
                if (typeof dep !== 'function') {
                    errors.push('All dependencies must be component constructors');
                }
            }

            if (hasCircularDependency(componentType, metadata.dependencies)) {
                errors.push('Circular dependency detected');
            }
        }
    }

    if (metadata.version && !/^\d+\.\d+\.\d+(-[\w\.-]+)?$/.test(metadata.version)) {
        warnings.push('Version should follow semantic versioning (x.y.z)');
    }

    if (metadata.deprecated && !metadata.deprecationMessage) {
        warnings.push('Deprecated scripts should include a deprecation message');
    }

    return {
        isValid: errors.length === 0,
        errors,
        warnings,
    };
}

function hasCircularDependency(
    componentType: ComponentType,
    dependencies: readonly ComponentType[]
): boolean {
    const visited = new Set<ComponentType>();
    const recursionStack = new Set<ComponentType>();

    function dfs(current: ComponentType): boolean {
        if (recursionStack.has(current)) {
            return true;
        }

        if (visited.has(current)) {
            return false;
        }

        visited.add(current);
        recursionStack.add(current);

        const currentDeps = dependencyGraph.get(current);
        if (currentDeps) {
            for (const dep of currentDeps) {
                if (dfs(dep)) {
                    return true;
                }
            }
        }

        recursionStack.delete(current);
        return false;
    }

    dependencyGraph.set(componentType, new Set(dependencies));
    const hasCycle = dfs(componentType);

    if (hasCycle) {
        dependencyGraph.delete(componentType);
    }

    return hasCycle;
}

function getCachedResult<T>(key: string, factory: () => T, ttl: number = DEFAULT_CACHE_TTL): T {
    const cached = metricsCache.get(key);
    const now = performance.now();

    if (cached && now - cached.timestamp < cached.ttl) {
        return cached.data;
    }

    const result = factory();
    metricsCache.set(key, {
        data: result,
        timestamp: now,
        ttl,
    });

    return result;
}

function performCleanup(): void {
    const now = performance.now();

    for (const [key, entry] of metricsCache.entries()) {
        if (now - entry.timestamp > entry.ttl) {
            metricsCache.delete(key);
        }
    }

    if (scriptRegistry.size > MAX_REGISTRY_SIZE) {
        const entries = Array.from(scriptRegistry.entries())
            .sort((a, b) => a[1].lastAccessed - b[1].lastAccessed)
            .slice(0, CLEANUP_THRESHOLD);

        scriptRegistry.clear();
        for (const [key, value] of entries) {
            scriptRegistry.set(key, value);
        }
    }
}

export function script<T extends ComponentType>(
    options: ScriptDecoratorOptions = {}
): (target: T) => T {
    return function scriptDecorator(target: T): T {
        const startTime = performance.now();

        try {
            const metadata: ScriptMetadata = {
                scriptName: options.scriptName || target.name,
                dependencies: options.dependencies || [],
                singleton: options.singleton || false,
                executeInEditMode: options.executeInEditMode || false,
                priority: options.priority || 0,
                version: options.version,
                author: options.author,
                description: options.description,
                tags: options.tags,
                experimental: options.experimental || false,
                deprecated: options.deprecated || false,
                deprecationMessage: options.deprecationMessage,
            };

            let validationResult: ValidationResult = { isValid: true, errors: [], warnings: [] };

            if (options.strictMode !== false) {
                validationResult = validateScriptMetadata(target, metadata);

                if (!validationResult.isValid) {
                    const errorMessage = `Script validation failed for ${target.name}:\n${validationResult.errors.join('\n')}`;
                    throw new Error(errorMessage);
                }

                if (
                    validationResult.warnings.length > 0 &&
                    typeof process !== 'undefined' &&
                    process.env?.NODE_ENV !== 'production'
                ) {
                    console.warn(`Script warnings for ${target.name}:`, validationResult.warnings);
                }
            }

            componentMetadataMap.set(target, metadata);

            const registryEntry: ScriptRegistryEntry = {
                metadata,
                componentType: target,
                registrationTime: startTime,
                validationResult,
                accessCount: 0,
                lastAccessed: startTime,
            };

            scriptRegistry.set(metadata.scriptName, registryEntry);

            if (metadata.dependencies && metadata.dependencies.length > 0) {
                dependencyGraph.set(target, new Set(metadata.dependencies));
            }

            if (
                metadata.deprecated &&
                typeof process !== 'undefined' &&
                process.env?.NODE_ENV !== 'test'
            ) {
                const message =
                    metadata.deprecationMessage || `Component ${metadata.scriptName} is deprecated`;
                console.warn(`⚠️  ${message}`);
            }

            if (typeof (target as any).setComponentMetadata === 'function') {
                (target as any).setComponentMetadata(target, metadata);
            }

            if (scriptRegistry.size % 100 === 0) {
                queueMicrotask(performCleanup);
            }

            return target;
        } catch (error) {
            if (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'test') {
                console.error(`Failed to apply @script decorator to ${target.name}:`, error);
            }
            throw error;
        }
    };
}

export function getComponentMetadata<T extends Component>(
    componentType: ComponentType<T>
): ScriptMetadata | undefined {
    const metadata = componentMetadataMap.get(componentType);

    if (metadata) {
        const registryEntry = scriptRegistry.get(metadata.scriptName);
        if (registryEntry) {
            registryEntry.accessCount++;
            registryEntry.lastAccessed = performance.now();
        }
    }

    return metadata;
}

export function setComponentMetadata<T extends Component>(
    componentType: ComponentType<T>,
    metadata: ScriptMetadata
): void {
    const validationResult = validateScriptMetadata(componentType, metadata);

    if (!validationResult.isValid) {
        throw new Error(`Invalid metadata: ${validationResult.errors.join(', ')}`);
    }

    componentMetadataMap.set(componentType, metadata);

    const registryEntry: ScriptRegistryEntry = {
        metadata,
        componentType,
        registrationTime: performance.now(),
        validationResult,
        accessCount: 0,
        lastAccessed: performance.now(),
    };

    scriptRegistry.set(metadata.scriptName, registryEntry);
}

export function getAllScripts(filter?: {
    tag?: string;
    author?: string;
    deprecated?: boolean;
    experimental?: boolean;
}): readonly ScriptRegistryEntry[] {
    return getCachedResult(
        'getAllScripts',
        () => {
            let entries = Array.from(scriptRegistry.values());

            if (filter) {
                entries = entries.filter((entry) => {
                    const { metadata } = entry;

                    if (filter.tag && (!metadata.tags || !metadata.tags.includes(filter.tag))) {
                        return false;
                    }

                    if (filter.author && metadata.author !== filter.author) {
                        return false;
                    }

                    if (
                        filter.deprecated !== undefined &&
                        metadata.deprecated !== filter.deprecated
                    ) {
                        return false;
                    }

                    if (
                        filter.experimental !== undefined &&
                        metadata.experimental !== filter.experimental
                    ) {
                        return false;
                    }

                    return true;
                });
            }

            return entries.sort((a, b) =>
                a.metadata.scriptName.localeCompare(b.metadata.scriptName)
            );
        },
        1000
    );
}

export function getDependencyTree(componentType: ComponentType): ComponentType[] {
    const visited = new Set<ComponentType>();
    const result: ComponentType[] = [];

    function traverse(current: ComponentType): void {
        if (visited.has(current)) return;

        visited.add(current);
        result.push(current);

        const deps = dependencyGraph.get(current);
        if (deps) {
            for (const dep of deps) {
                traverse(dep);
            }
        }
    }

    traverse(componentType);
    return result.slice(1);
}

export function validateAllScripts(): ValidationResult {
    const allErrors: string[] = [];
    const allWarnings: string[] = [];

    for (const entry of scriptRegistry.values()) {
        const result = validateScriptMetadata(entry.componentType, entry.metadata);
        allErrors.push(...result.errors.map((err) => `${entry.metadata.scriptName}: ${err}`));
        allWarnings.push(...result.warnings.map((warn) => `${entry.metadata.scriptName}: ${warn}`));
    }

    return {
        isValid: allErrors.length === 0,
        errors: allErrors,
        warnings: allWarnings,
    };
}

export function getScriptMetrics(): {
    totalScripts: number;
    cacheHitRate: number;
    averageAccessTime: number;
    memoryUsage: number;
    topAccessedScripts: Array<{ name: string; accessCount: number }>;
} {
    return getCachedResult(
        'scriptMetrics',
        () => {
            const totalScripts = scriptRegistry.size;
            const cacheSize = metricsCache.size;

            let totalAccess = 0;
            let totalAccessTime = 0;
            const accessData: Array<{ name: string; accessCount: number }> = [];

            for (const entry of scriptRegistry.values()) {
                totalAccess += entry.accessCount;
                totalAccessTime += entry.lastAccessed - entry.registrationTime;
                accessData.push({
                    name: entry.metadata.scriptName,
                    accessCount: entry.accessCount,
                });
            }

            const topAccessedScripts = accessData
                .sort((a, b) => b.accessCount - a.accessCount)
                .slice(0, 10);

            return {
                totalScripts,
                cacheHitRate: cacheSize > 0 ? totalAccess / cacheSize : 0,
                averageAccessTime: totalAccess > 0 ? totalAccessTime / totalAccess : 0,
                memoryUsage: scriptRegistry.size * 200 + metricsCache.size * 100,
                topAccessedScripts,
            };
        },
        2000
    );
}

export function clearScriptCaches(): void {
    metricsCache.clear();
    performCleanup();
}

export function __debugScriptSystem(): {
    version: string;
    registrySize: number;
    cacheSize: number;
    dependencyGraphSize: number;
    scripts: string[];
} {
    if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'production') {
        throw new Error('Debug functions are not available in production');
    }

    return {
        version: SCRIPT_DECORATOR_VERSION,
        registrySize: scriptRegistry.size,
        cacheSize: metricsCache.size,
        dependencyGraphSize: dependencyGraph.size,
        scripts: Array.from(scriptRegistry.keys()),
    };
}

export { script as Script };
