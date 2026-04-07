import { describe, it, expect, test } from 'vitest';
import {
    PropertyPath,
    ExtractPropertyType,
    DeepPartial,
    KeysOfType,
    ComparerOptions,
    EqualityComparerOptions,
} from '../../';

describe('TypeScript Type Definitions', () => {
    describe('PropertyPath Type', () => {
        interface Person {
            id: number;
            name: string;
            address: {
                street: string;
                city: string;
                zipCode: string;
            };
            contacts: Array<{
                type: string;
                value: string;
            }>;
        }

        test('PropertyPath should work with direct properties', () => {
            const path1: PropertyPath<Person> = 'id';
            const path2: PropertyPath<Person> = 'name';
            const path3: PropertyPath<Person> = 'address';

            // @ts-expect-error
            const invalid1: PropertyPath<Person> = 'nonExistent';

            // @ts-expect-error
            const invalid2: PropertyPath<Person> = 0;

            expect(true).toBe(true);
        });

        describe('DeepPartial Type', () => {
            interface DeepObject {
                prop1: string;
                prop2: number;
                nested: {
                    inner1: boolean;
                    inner2: string;
                    deeplyNested: {
                        deepProp: number;
                    };
                };
                optionalProp?: string;
                arrayProp: Array<{
                    id: number;
                    name: string;
                }>;
            }

            test('DeepPartial should make all properties optional', () => {
                type PartialDeepObject = DeepPartial<DeepObject>;

                const empty: PartialDeepObject = {};

                const partial1: PartialDeepObject = {
                    prop1: 'test',
                };

                const partial2: PartialDeepObject = {
                    nested: {
                        inner1: true,
                    },
                };

                const partial3: PartialDeepObject = {
                    nested: {
                        deeplyNested: {},
                    },
                };

                const partial4: PartialDeepObject = {
                    arrayProp: [
                        {
                            id: 1,
                        },
                    ],
                };

                const full: PartialDeepObject = {
                    prop1: 'test',
                    prop2: 42,
                    nested: {
                        inner1: true,
                        inner2: 'inner',
                        deeplyNested: {
                            deepProp: 100,
                        },
                    },
                    optionalProp: 'optional',
                    arrayProp: [
                        { id: 1, name: 'one' },
                        { id: 2, name: 'two' },
                    ],
                };

                expect(true).toBe(true);
            });
        });
    });

    describe('KeysOfType Type', () => {
        interface MixedProps {
            id: number;
            name: string;
            active: boolean;
            count: number;
            tags: string[];
            createdAt: Date;
            details: { [key: string]: any };
            update: () => void;
        }

        test('KeysOfType should extract keys of specific type', () => {
            type StringProps = KeysOfType<MixedProps, string>;
            type NumberProps = KeysOfType<MixedProps, number>;
            type BooleanProps = KeysOfType<MixedProps, boolean>;
            type FunctionProps = KeysOfType<MixedProps, Function>;
            type DateProps = KeysOfType<MixedProps, Date>;
            type ArrayProps = KeysOfType<MixedProps, any[]>;

            const strProp: StringProps = 'name';

            // @ts-expect-error
            const invalidStrProp: StringProps = 'id';

            const numProp1: NumberProps = 'id';
            const numProp2: NumberProps = 'count';

            // @ts-expect-error
            const invalidNumProp: NumberProps = 'name';

            const boolProp: BooleanProps = 'active';

            // @ts-expect-error
            const invalidBoolProp: BooleanProps = 'id';

            const fnProp: FunctionProps = 'update';

            // @ts-expect-error
            const invalidFnProp: FunctionProps = 'id';

            const dateProp: DateProps = 'createdAt';

            // @ts-expect-error
            const invalidDateProp: DateProps = 'id';

            const arrayProp: ArrayProps = 'tags';

            // @ts-expect-error
            const invalidArrayProp: ArrayProps = 'id';

            expect(true).toBe(true);
        });
    });

    describe('Option Types', () => {
        test('ComparerOptions should have correct structure', () => {
            const options1: ComparerOptions = {
                nullFirst: true,
                descending: false,
            };

            const options2: ComparerOptions = {
                ignoreCase: true,
                locale: 'tr-TR',
            };

            const options3: ComparerOptions = {
                precision: 2,
                timezone: 'UTC',
            };

            const allOptions: ComparerOptions = {
                nullFirst: true,
                descending: true,
                ignoreCase: true,
                locale: 'en-US',
                precision: 3,
                timezone: 'Europe/London',
            };

            expect(true).toBe(true);
        });

        test('EqualityComparerOptions should have correct structure', () => {
            const options1: EqualityComparerOptions = {
                ignoreCase: true,
            };

            const options2: EqualityComparerOptions = {
                deep: true,
                strict: false,
            };

            const options3: EqualityComparerOptions = {
                customizer: (a, b) => a === b,
            };

            const allOptions: EqualityComparerOptions = {
                ignoreCase: true,
                deep: true,
                strict: true,
                customizer: (a, b) => {
                    return String(a) === String(b);
                },
            };

            expect(true).toBe(true);
        });
    });

    describe('Runtime Type Tests', () => {
        test('Type utilities should behave as expected at runtime', () => {
            interface TestObject {
                name: string;
                value: number;
            }

            const obj: TestObject = { name: 'test', value: 42 };

            function getProperty<T, P extends PropertyPath<T>>(
                obj: T,
                path: P
            ): ExtractPropertyType<T, P> {
                if (typeof path === 'string') {
                    return obj[path as keyof T] as ExtractPropertyType<T, P>;
                } else if (Array.isArray(path)) {
                    return path.reduce((acc, key) => acc[key], obj as any);
                }
                throw new Error('Invalid path');
            }

            expect(getProperty(obj, 'name')).toBe('test');
            expect(getProperty(obj, 'value')).toBe(42);

            const partial: DeepPartial<TestObject> = { name: 'partial' };
            expect(partial.name).toBe('partial');
        });
    });
});
