import { AnimationStateMachineError, AnimationValidationError } from './errors';
import type {
    AnimationParameterDefinition,
    AnimationParameterKind,
    AnimationParameterMap,
    AnimationParameterValue,
} from './types';

const enum AnimationParameterKindId {
    Float = 0,
    Int = 1,
    Bool = 2,
    Trigger = 3,
}

const resolveParameterKindId = (kind: AnimationParameterKind): AnimationParameterKindId => {
    switch (kind) {
        case 'float':
            return AnimationParameterKindId.Float;
        case 'int':
            return AnimationParameterKindId.Int;
        case 'bool':
            return AnimationParameterKindId.Bool;
        case 'trigger':
            return AnimationParameterKindId.Trigger;
        default:
            throw new AnimationValidationError(`Unsupported animation parameter kind '${String(kind)}'`);
    }
};

export class AnimationParameterStore<
    TDefinitions extends readonly AnimationParameterDefinition[] = readonly AnimationParameterDefinition[],
> {
    private readonly _definitions: readonly AnimationParameterDefinition[];
    private readonly _indexByName = new Map<string, number>();
    private readonly _kinds: Uint8Array;
    private readonly _numbers: Float64Array;
    private readonly _booleans: Uint8Array;

    constructor(definitions: TDefinitions = [] as unknown as TDefinitions) {
        this._definitions = Object.freeze(
            definitions.map((definition) => {
                if (!definition || typeof definition.name !== 'string' || definition.name.length === 0) {
                    throw new AnimationValidationError('Animation parameters require a non-empty name');
                }
                return Object.freeze({
                    name: definition.name,
                    kind: definition.kind,
                    defaultValue: definition.defaultValue,
                });
            })
        );
        this._kinds = new Uint8Array(this._definitions.length);
        this._numbers = new Float64Array(this._definitions.length);
        this._booleans = new Uint8Array(this._definitions.length);

        for (let index = 0; index < this._definitions.length; index += 1) {
            const definition = this._definitions[index]!;
            if (this._indexByName.has(definition.name)) {
                throw new AnimationValidationError(
                    `Duplicate animation parameter '${definition.name}'`
                );
            }

            this._indexByName.set(definition.name, index);
            const kindId = resolveParameterKindId(definition.kind);
            this._kinds[index] = kindId;
            switch (kindId) {
                case AnimationParameterKindId.Float:
                case AnimationParameterKindId.Int:
                    this._numbers[index] =
                        typeof definition.defaultValue === 'number' && Number.isFinite(definition.defaultValue)
                            ? definition.defaultValue
                            : 0;
                    break;
                case AnimationParameterKindId.Bool:
                case AnimationParameterKindId.Trigger:
                    this._booleans[index] = definition.defaultValue === true ? 1 : 0;
                    break;
            }
        }
    }

    get definitions(): readonly AnimationParameterDefinition[] {
        return this._definitions;
    }

    has(name: string): boolean {
        return this._indexByName.has(name);
    }

    getKind(name: string): AnimationParameterKind {
        const index = this._getIndex(name);
        return this._definitions[index]!.kind;
    }

    get<TName extends string>(name: TName): AnimationParameterValue {
        const index = this._getIndex(name);
        switch (this._kinds[index]) {
            case AnimationParameterKindId.Float:
            case AnimationParameterKindId.Int:
                return this._numbers[index] as AnimationParameterValue;
            case AnimationParameterKindId.Bool:
            case AnimationParameterKindId.Trigger:
                return Boolean(this._booleans[index]) as AnimationParameterValue;
            default:
                throw new AnimationStateMachineError(`Unsupported parameter runtime kind for '${name}'`);
        }
    }

    set(name: string, value: AnimationParameterValue): this {
        const index = this._getIndex(name);
        switch (this._kinds[index]) {
            case AnimationParameterKindId.Float:
                this._numbers[index] = typeof value === 'number' && Number.isFinite(value) ? value : 0;
                return this;
            case AnimationParameterKindId.Int:
                this._numbers[index] = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : 0;
                return this;
            case AnimationParameterKindId.Bool:
            case AnimationParameterKindId.Trigger:
                this._booleans[index] = value === true ? 1 : 0;
                return this;
            default:
                throw new AnimationStateMachineError(`Unsupported parameter runtime kind for '${name}'`);
        }
    }

    setFloat(name: string, value: number): this {
        return this.set(name, value);
    }

    setInt(name: string, value: number): this {
        return this.set(name, value);
    }

    setBool(name: string, value: boolean): this {
        return this.set(name, value);
    }

    setTrigger(name: string): this {
        return this.set(name, true);
    }

    resetTrigger(name: string): this {
        const index = this._getIndex(name);
        if (this._kinds[index] !== AnimationParameterKindId.Trigger) {
            throw new AnimationStateMachineError(`Parameter '${name}' is not a trigger`);
        }
        this._booleans[index] = 0;
        return this;
    }

    consumeTrigger(name: string): boolean {
        const index = this._getIndex(name);
        if (this._kinds[index] !== AnimationParameterKindId.Trigger) {
            throw new AnimationStateMachineError(`Parameter '${name}' is not a trigger`);
        }
        const active = this._booleans[index] === 1;
        this._booleans[index] = 0;
        return active;
    }

    clearTriggers(): this {
        for (let index = 0; index < this._definitions.length; index += 1) {
            if (this._kinds[index] === AnimationParameterKindId.Trigger) {
                this._booleans[index] = 0;
            }
        }
        return this;
    }

    copyFrom(other: AnimationParameterStore): this {
        if (other._definitions.length !== this._definitions.length) {
            throw new AnimationStateMachineError('Cannot copy animation parameters with different layouts');
        }

        this._numbers.set(other._numbers);
        this._booleans.set(other._booleans);
        return this;
    }

    snapshot(): AnimationParameterMap<TDefinitions> {
        const snapshot: Record<string, AnimationParameterValue> = {};
        for (let index = 0; index < this._definitions.length; index += 1) {
            snapshot[this._definitions[index]!.name] = this.get(this._definitions[index]!.name);
        }
        return snapshot as AnimationParameterMap<TDefinitions>;
    }

    private _getIndex(name: string): number {
        const index = this._indexByName.get(name);
        if (index === undefined) {
            throw new AnimationStateMachineError(`Unknown animation parameter '${name}'`);
        }
        return index;
    }
}