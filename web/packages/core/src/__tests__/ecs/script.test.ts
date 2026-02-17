import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { Component } from '../../component-system/core/component';
import {
    script,
    getComponentMetadata,
    setComponentMetadata,
    getAllScripts,
    getDependencyTree,
    validateAllScripts,
    getScriptMetrics,
    clearScriptCaches,
    __debugScriptSystem,
} from '../../component-system/decorators/script';

@script({
    scriptName: 'TestComponent',
    priority: 100,
    version: '1.0.0',
    author: 'Test Team',
    description: 'A test component for unit testing',
    tags: ['test', 'unit'],
    dependencies: [],
    singleton: false,
    executeInEditMode: true,
    validateDependencies: true,
    enableMetrics: true,
})
class TestComponent extends Component {
    public value: number = 42;

    constructor(value: number = 42) {
        super();
        this.value = value;
    }
}

@script({
    scriptName: 'DependentComponent',
    dependencies: [TestComponent],
    priority: 50,
    version: '1.1.0',
    tags: ['test', 'dependent'],
})
class DependentComponent extends Component {
    public testComponent?: TestComponent;

    awake(): void {
        this.testComponent = this.requireComponent(TestComponent);
    }
}

@script({
    scriptName: 'DeprecatedComponent',
    deprecated: true,
    deprecationMessage: 'Use NewComponent instead',
    version: '0.9.0',
})
class DeprecatedComponent extends Component {}

@script({
    scriptName: 'ExperimentalComponent',
    experimental: true,
    version: '2.0.0',
    tags: ['experimental', 'alpha'],
})
class ExperimentalComponent extends Component {}

// Mock globals for testing
(global as any).process = {
    env: {
        NODE_ENV: 'test',
    },
};

(global as any).performance = {
    now: () => Date.now(),
};

describe('Script Decorator System', () => {
    // Mock console methods to suppress expected output during testing
    let originalConsoleError: typeof console.error;
    let originalConsoleWarn: typeof console.warn;

    beforeAll(() => {
        originalConsoleError = console.error;
        originalConsoleWarn = console.warn;
        console.error = vi.fn();
        console.warn = vi.fn();
    });

    afterAll(() => {
        console.error = originalConsoleError;
        console.warn = originalConsoleWarn;
    });

    beforeEach(() => {
        clearScriptCaches();
        // Clear mock calls between tests
        (console.error as any).mockClear();
        (console.warn as any).mockClear();
    });

    describe('Basic Functionality', () => {
        test('should register component metadata correctly', () => {
            const metadata = getComponentMetadata(TestComponent);

            expect(metadata).toBeDefined();
            expect(metadata?.scriptName).toBe('TestComponent');
            expect(metadata?.priority).toBe(100);
            expect(metadata?.version).toBe('1.0.0');
            expect(metadata?.author).toBe('Test Team');
            expect(metadata?.description).toBe('A test component for unit testing');
            expect(metadata?.tags).toEqual(['test', 'unit']);
            expect(metadata?.singleton).toBe(false);
            expect(metadata?.executeInEditMode).toBe(true);
        });

        test('should handle components without explicit metadata', () => {
            @script()
            class MinimalComponent extends Component {}

            const metadata = getComponentMetadata(MinimalComponent);

            expect(metadata).toBeDefined();
            expect(metadata?.scriptName).toBe('MinimalComponent');
            expect(metadata?.priority).toBe(0);
            expect(metadata?.dependencies).toEqual([]);
            expect(metadata?.singleton).toBe(false);
        });

        test('should allow programmatic metadata setting', () => {
            class ProgrammaticComponent extends Component {}

            setComponentMetadata(ProgrammaticComponent, {
                scriptName: 'ProgrammaticComponent',
                priority: 200,
                version: '2.0.0',
                dependencies: [],
                singleton: true,
                executeInEditMode: false,
            });

            const metadata = getComponentMetadata(ProgrammaticComponent);
            expect(metadata?.priority).toBe(200);
            expect(metadata?.singleton).toBe(true);
            expect(metadata?.version).toBe('2.0.0');
        });
    });

    describe('Dependency Management', () => {
        test('should track dependencies correctly', () => {
            const dependencyTree = getDependencyTree(DependentComponent);
            expect(dependencyTree).toContain(TestComponent);
        });

        test('should detect circular dependencies', () => {
            expect(() => {
                @script({
                    scriptName: 'CircularA',
                    dependencies: [],
                })
                class CircularA extends Component {}

                @script({
                    scriptName: 'CircularB',
                    dependencies: [CircularA],
                })
                class CircularB extends Component {}

                setComponentMetadata(CircularA, {
                    scriptName: 'CircularA',
                    dependencies: [CircularB],
                    singleton: false,
                    executeInEditMode: false,
                });
            }).toThrow();
        });
    });

    describe('Validation System', () => {
        test('should validate all scripts successfully', () => {
            const result = validateAllScripts();
            expect(result.isValid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        test('should catch validation errors', () => {
            expect(() => {
                setComponentMetadata(TestComponent, {
                    scriptName: '',
                    dependencies: [],
                    singleton: false,
                    executeInEditMode: false,
                });
            }).toThrow();
        });

        test('should handle invalid priority values', () => {
            expect(() => {
                @script({
                    scriptName: 'InvalidPriority',
                    priority: 1.5, // Invalid priority (not integer)
                })
                class InvalidPriorityComponent extends Component {}
            }).toThrow('Priority must be an integer');
        });
    });

    describe('Script Registry', () => {
        test('should list all registered scripts', () => {
            const scripts = getAllScripts();

            const scriptNames = scripts.map((s) => s.metadata.scriptName);
            expect(scriptNames).toContain('TestComponent');
            expect(scriptNames).toContain('DependentComponent');
            expect(scriptNames).toContain('DeprecatedComponent');
            expect(scriptNames).toContain('ExperimentalComponent');
        });

        test('should filter scripts by tag', () => {
            const testScripts = getAllScripts({ tag: 'test' });
            const scriptNames = testScripts.map((s) => s.metadata.scriptName);

            expect(scriptNames).toContain('TestComponent');
            expect(scriptNames).toContain('DependentComponent');
            expect(scriptNames).not.toContain('ExperimentalComponent');
        });

        test('should filter scripts by author', () => {
            const testTeamScripts = getAllScripts({ author: 'Test Team' });
            expect(testTeamScripts).toHaveLength(1);
            expect(testTeamScripts[0].metadata.scriptName).toBe('TestComponent');
        });

        test('should filter deprecated scripts', () => {
            const deprecatedScripts = getAllScripts({ deprecated: true });
            expect(deprecatedScripts).toHaveLength(1);
            expect(deprecatedScripts[0].metadata.scriptName).toBe('DeprecatedComponent');
            expect(deprecatedScripts[0].metadata.deprecated).toBe(true);
            expect(deprecatedScripts[0].metadata.deprecationMessage).toBe(
                'Use NewComponent instead'
            );
        });

        test('should filter experimental scripts', () => {
            const experimentalScripts = getAllScripts({ experimental: true });
            expect(experimentalScripts).toHaveLength(1);
            expect(experimentalScripts[0].metadata.scriptName).toBe('ExperimentalComponent');
        });
    });

    describe('Performance Metrics', () => {
        test('should track script metrics', () => {
            getComponentMetadata(TestComponent);
            getComponentMetadata(DependentComponent);
            getComponentMetadata(TestComponent);

            const metrics = getScriptMetrics();

            expect(metrics.totalScripts).toBeGreaterThan(0);
            expect(metrics.topAccessedScripts).toBeDefined();
            expect(metrics.memoryUsage).toBeGreaterThan(0);
        });

        test('should handle cache operations', () => {
            getComponentMetadata(TestComponent);
            getAllScripts();
            getScriptMetrics();

            clearScriptCaches();

            const metadata = getComponentMetadata(TestComponent);
            expect(metadata).toBeDefined();
        });
    });

    describe('Development Utilities', () => {
        test('should provide debug information in development', () => {
            const originalEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'development';

            try {
                const debugInfo = __debugScriptSystem();

                expect(debugInfo.version).toBeDefined();
                expect(debugInfo.registrySize).toBeGreaterThan(0);
                expect(debugInfo.scripts).toContain('TestComponent');
            } finally {
                process.env.NODE_ENV = originalEnv;
            }
        });

        test('should throw error in production for debug functions', () => {
            const originalEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'production';

            try {
                expect(() => __debugScriptSystem()).toThrow();
            } finally {
                process.env.NODE_ENV = originalEnv;
            }
        });
    });

    describe('Error Handling', () => {
        test('should handle decorator application errors gracefully', () => {
            expect(() => {
                @script({
                    scriptName: 'ErrorComponent',
                    priority: 1.5, // Invalid priority (not integer)
                })
                class ErrorComponent extends Component {}
            }).toThrow('Script validation failed for ErrorComponent');
        });

        test('should validate version format', () => {
            @script({
                scriptName: 'InvalidVersionComponent',
                version: 'not-a-version',
            })
            class InvalidVersionComponent extends Component {}

            const result = validateAllScripts();
            const hasVersionWarning = result.warnings.some((warning) =>
                warning.includes('Version should follow semantic versioning')
            );

            expect(hasVersionWarning).toBe(true);
        });
    });

    describe('Memory Management', () => {
        test('should handle large numbers of components', () => {
            const components: any[] = [];

            for (let i = 0; i < 150; i++) {
                @script({
                    scriptName: `TestComponent${i}`,
                    priority: i,
                })
                class DynamicComponent extends Component {}

                components.push(DynamicComponent);
            }

            const metrics = getScriptMetrics();
            expect(metrics.totalScripts).toBeGreaterThan(100);

            clearScriptCaches();
        });
    });
});

describe('Script Decorator Integration', () => {
    test('should work with component instantiation', () => {
        const component = new TestComponent(100);
        expect(component.value).toBe(100);

        const metadata = getComponentMetadata(TestComponent);
        expect(metadata?.scriptName).toBe('TestComponent');
    });

    test('should support component cloning with metadata', () => {
        const original = new TestComponent(200);
        const cloned = original.clone();

        expect(cloned.value).toBe(200);
        expect(cloned).not.toBe(original);

        const metadata = getComponentMetadata(TestComponent);
        expect(metadata?.scriptName).toBe('TestComponent');
    });
});
