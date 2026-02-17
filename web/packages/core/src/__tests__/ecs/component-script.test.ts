import {
    Component,
    script,
    getComponentMetadata,
    setComponentMetadata,
} from '../../component-system/core/component';
import { Transform } from '../../component-system/components/transform';
import type { ComponentMetadata } from '../../component-system/types/component';
import { afterEach, describe, expect, test } from 'vitest';

class TestDependencyComponent extends Component {
    value: number = 42;
}

class CustomDepComponent extends Component {
    name: string = 'custom';
}

class Manual1Component extends Component {
    manual1: boolean = true;
}

class Manual2Component extends Component {
    manual2: boolean = true;
}

class OverrideComponent extends Component {
    override: boolean = true;
}

@script()
class DefaultScriptComponent extends Component {
    value: number = 0;
}

@script({
    dependencies: [Transform, TestDependencyComponent],
    singleton: true,
    executeInEditMode: true,
    priority: 100,
})
class AdvancedScriptComponent extends Component {
    name: string = 'advanced';
}

@script({
    singleton: false,
    priority: -50,
})
class NegativePriorityComponent extends Component {
    data: string = '';
}

class UnDecoratedComponent extends Component {
    plain: boolean = true;
}

@script({
    dependencies: [CustomDepComponent],
    singleton: true,
})
class CustomMetadataComponent extends Component {
    static customMetadata: ComponentMetadata | null = null;

    static setComponentMetadata(target: any, metadata: ComponentMetadata) {
        CustomMetadataComponent.customMetadata = metadata;
    }

    getValue(): string {
        return 'custom';
    }
}

describe('Component Script Decorator', () => {
    afterEach(() => {
        DefaultScriptComponent.getAllInstances().forEach((c) => c._internalDestroy());
        AdvancedScriptComponent.getAllInstances().forEach((c) => c._internalDestroy());
        NegativePriorityComponent.getAllInstances().forEach((c) => c._internalDestroy());
        UnDecoratedComponent.getAllInstances().forEach((c) => c._internalDestroy());
        CustomMetadataComponent.getAllInstances().forEach((c) => c._internalDestroy());
    });

    describe('Default Configuration', () => {
        test('should apply default metadata to component', () => {
            const metadata = getComponentMetadata(DefaultScriptComponent);

            expect(metadata).toBeDefined();
            expect(metadata!.scriptName).toBe('DefaultScriptComponent');
            expect(metadata!.dependencies).toEqual([]);
            expect(metadata!.singleton).toBe(false);
            expect(metadata!.executeInEditMode).toBe(false);
            expect(metadata!.priority).toBe(0);
        });

        test('should create component instances normally', () => {
            const component = new DefaultScriptComponent();

            expect(component).toBeInstanceOf(DefaultScriptComponent);
            expect(component).toBeInstanceOf(Component);
            expect(component.value).toBe(0);

            component._internalDestroy();
        });
    });

    describe('Advanced Configuration', () => {
        test('should apply custom metadata correctly', () => {
            const metadata = getComponentMetadata(AdvancedScriptComponent);

            expect(metadata).toBeDefined();
            expect(metadata!.scriptName).toBe('AdvancedScriptComponent');
            expect(metadata!.dependencies).toEqual([Transform, TestDependencyComponent]);
            expect(metadata!.singleton).toBe(true);
            expect(metadata!.executeInEditMode).toBe(true);
            expect(metadata!.priority).toBe(100);
        });

        test('should handle negative priority', () => {
            const metadata = getComponentMetadata(NegativePriorityComponent);

            expect(metadata).toBeDefined();
            expect(metadata!.priority).toBe(-50);
            expect(metadata!.singleton).toBe(false);
        });

        test('should preserve component functionality', () => {
            const component = new AdvancedScriptComponent();

            expect(component.name).toBe('advanced');
            expect(component.state).toBe('uninitialized');
            expect(component.priority).toBe(0);

            component._internalDestroy();
        });
    });

    describe('Undecorated Components', () => {
        test('should return undefined metadata for undecorated components', () => {
            const metadata = getComponentMetadata(UnDecoratedComponent);

            expect(metadata).toBeUndefined();
        });

        test('should work normally without decorator', () => {
            const component = new UnDecoratedComponent();

            expect(component).toBeInstanceOf(UnDecoratedComponent);
            expect(component.plain).toBe(true);

            component._internalDestroy();
        });
    });

    describe('Custom Metadata Handler', () => {
        test('should call custom setComponentMetadata if available', () => {
            const metadata = getComponentMetadata(CustomMetadataComponent);

            expect(metadata).toBeDefined();
            expect(CustomMetadataComponent.customMetadata).toBeDefined();
            expect(CustomMetadataComponent.customMetadata!.dependencies).toEqual([
                CustomDepComponent,
            ]);
            expect(CustomMetadataComponent.customMetadata!.singleton).toBe(true);
        });

        test('should maintain both standard and custom metadata', () => {
            const standardMetadata = getComponentMetadata(CustomMetadataComponent);
            const customMetadata = CustomMetadataComponent.customMetadata;

            expect(standardMetadata).toEqual(customMetadata);
            expect(standardMetadata!.scriptName).toBe('CustomMetadataComponent');
        });
    });

    describe('Metadata Persistence', () => {
        test('should persist metadata across multiple retrievals', () => {
            const metadata1 = getComponentMetadata(AdvancedScriptComponent);
            const metadata2 = getComponentMetadata(AdvancedScriptComponent);

            expect(metadata1).toBe(metadata2);
            expect(metadata1).toEqual(metadata2);
        });

        test('should maintain metadata for multiple component types', () => {
            const defaultMeta = getComponentMetadata(DefaultScriptComponent);
            const advancedMeta = getComponentMetadata(AdvancedScriptComponent);
            const negativeMeta = getComponentMetadata(NegativePriorityComponent);

            expect(defaultMeta).not.toBe(advancedMeta);
            expect(advancedMeta).not.toBe(negativeMeta);

            expect(defaultMeta!.scriptName).toBe('DefaultScriptComponent');
            expect(advancedMeta!.scriptName).toBe('AdvancedScriptComponent');
            expect(negativeMeta!.scriptName).toBe('NegativePriorityComponent');
        });
    });

    describe('Manual Metadata Management', () => {
        test('should allow setting metadata manually', () => {
            const customMetadata: ComponentMetadata = {
                scriptName: 'ManuallySet',
                dependencies: [Manual1Component, Manual2Component],
                singleton: true,
                executeInEditMode: false,
                priority: 200,
            };

            setComponentMetadata(UnDecoratedComponent, customMetadata);

            const retrievedMetadata = getComponentMetadata(UnDecoratedComponent);
            expect(retrievedMetadata).toEqual(customMetadata);
        });

        test('should override decorator metadata when set manually', () => {
            const originalMetadata = getComponentMetadata(DefaultScriptComponent);
            expect(originalMetadata!.priority).toBe(0);

            const newMetadata: ComponentMetadata = {
                scriptName: 'Overridden',
                dependencies: [OverrideComponent],
                singleton: true,
                executeInEditMode: true,
                priority: 999,
            };

            setComponentMetadata(DefaultScriptComponent, newMetadata);

            const updatedMetadata = getComponentMetadata(DefaultScriptComponent);
            expect(updatedMetadata).toEqual(newMetadata);
            expect(updatedMetadata!.priority).toBe(999);
        });
    });

    describe('Edge Cases and Error Handling', () => {
        test('should handle partial metadata configuration', () => {
            class PartialDepComponent extends Component {}

            @script({
                dependencies: [PartialDepComponent],
            })
            class PartialConfigComponent extends Component {}

            const metadata = getComponentMetadata(PartialConfigComponent);

            expect(metadata!.dependencies).toEqual([PartialDepComponent]);
            expect(metadata!.singleton).toBe(false);
            expect(metadata!.executeInEditMode).toBe(false);
            expect(metadata!.priority).toBe(0);

            PartialConfigComponent.getAllInstances().forEach((c) => c._internalDestroy());
        });

        test('should handle empty dependencies array', () => {
            @script({
                dependencies: [],
                singleton: true,
            })
            class EmptyDepsComponent extends Component {}

            const metadata = getComponentMetadata(EmptyDepsComponent);

            expect(metadata!.dependencies).toEqual([]);
            expect(metadata!.singleton).toBe(true);

            EmptyDepsComponent.getAllInstances().forEach((c) => c._internalDestroy());
        });

        test('should handle multiple decorators on same component class', () => {
            const TestClass = class extends Component {};

            const decorator1 = script({ priority: 1 });
            const decorator2 = script({ priority: 2 });

            const DecoratedClass1 = decorator1(TestClass);
            const DecoratedClass2 = decorator2(DecoratedClass1);

            const metadata = getComponentMetadata(DecoratedClass2);
            expect(metadata!.priority).toBe(2);
        });

        test('should handle components with inheritance', () => {
            class InheritedComponent extends Component {}

            @script({
                priority: 50,
                singleton: true,
            })
            class BaseScriptComponent extends Component {
                baseValue: number = 10;
            }

            @script({
                priority: 75,
                dependencies: [InheritedComponent],
            })
            class DerivedScriptComponent extends BaseScriptComponent {
                derivedValue: string = 'derived';
            }

            const baseMeta = getComponentMetadata(BaseScriptComponent);
            const derivedMeta = getComponentMetadata(DerivedScriptComponent);

            expect(baseMeta!.priority).toBe(50);
            expect(baseMeta!.singleton).toBe(true);

            expect(derivedMeta!.priority).toBe(75);
            expect(derivedMeta!.dependencies).toEqual([InheritedComponent]);
            expect(derivedMeta!.singleton).toBe(false);

            const derived = new DerivedScriptComponent();
            expect(derived.baseValue).toBe(10);
            expect(derived.derivedValue).toBe('derived');

            derived._internalDestroy();
            BaseScriptComponent.getAllInstances().forEach((c) => c._internalDestroy());
            DerivedScriptComponent.getAllInstances().forEach((c) => c._internalDestroy());
        });
    });

    describe('Integration with Component System', () => {
        test('should work with component lifecycle', async () => {
            let awakeCallCount = 0;
            let startCallCount = 0;

            @script({
                priority: 10,
                executeInEditMode: true,
            })
            class LifecycleScriptComponent extends Component {
                awake(): void {
                    awakeCallCount++;
                }

                start(): void {
                    startCallCount++;
                }
            }

            const component = new LifecycleScriptComponent();

            await component._internalAwake();
            await component._internalStart();

            expect(awakeCallCount).toBe(1);
            expect(startCallCount).toBe(1);

            const metadata = getComponentMetadata(LifecycleScriptComponent);
            expect(metadata!.executeInEditMode).toBe(true);

            component._internalDestroy();
            LifecycleScriptComponent.getAllInstances().forEach((c) => c._internalDestroy());
        });

        test('should maintain metadata through component operations', () => {
            const component = new AdvancedScriptComponent();

            component.priority = 200;
            component.enabled = false;
            component.enabled = true;

            const metadata = getComponentMetadata(AdvancedScriptComponent);
            expect(metadata!.priority).toBe(100);
            expect(metadata!.singleton).toBe(true);

            component._internalDestroy();
        });
    });
});
