import type { Disposable } from '@axrone/utility';
import { brandLightingRigId, brandLightingVersion } from './brands';
import { LightKind } from './constants';
import { LightingDisposedError, LightingValidationError } from './errors';
import { LIGHTING_RIG_ACCESS, type InternalLightRecord, type LightingRigReadable } from './internal';
import type {
    DirectionalLightCreateInput,
    DirectionalLightDefinition,
    DirectionalLightPatch,
    LightDefinition,
    LightingEnvironment,
    LightingRigOptions,
    LightingSelectionOptions,
    LightingSelectionState,
    PointLightCreateInput,
    PointLightDefinition,
    PointLightPatch,
    SpotLightCreateInput,
    SpotLightDefinition,
    SpotLightPatch,
} from './types';
import {
    DEFAULT_LIGHTING_ENVIRONMENT,
    applyDirectionalLightPatch,
    applyPointLightPatch,
    applySpotLightPatch,
    createDirectionalLightDefinition,
    createLightingEnvironment,
    createPointLightDefinition,
    createSpotLightDefinition,
    updateLightingEnvironment,
} from './validation';

let lightingRigOrdinal = 0;

const createDefaultRigId = (): string => `lighting-rig:${++lightingRigOrdinal}`;

export class LightingRig implements Disposable, LightingRigReadable {
    readonly #id;

    #environment: LightingEnvironment;
    #version = 0;
    #sequence = 0;
    #lightOrdinal = 0;
    #isDisposed = false;
    #records = new Map<string, InternalLightRecord>();
    #orderedRecords: readonly InternalLightRecord[] = Object.freeze([] as InternalLightRecord[]);
    #orderedDefinitions: readonly LightDefinition[] = Object.freeze([] as LightDefinition[]);

    constructor(options: LightingRigOptions = {}) {
        this.#id = brandLightingRigId(
            typeof options.id === 'string' ? options.id : createDefaultRigId()
        );
        this.#environment = options.environment
            ? createLightingEnvironment(options.environment)
            : DEFAULT_LIGHTING_ENVIRONMENT;
    }

    get id() {
        return this.#id;
    }

    get version() {
        this.#assertNotDisposed();
        return brandLightingVersion(this.#version);
    }

    get size(): number {
        this.#assertNotDisposed();
        return this.#records.size;
    }

    get isDisposed(): boolean {
        return this.#isDisposed;
    }

    get environment(): LightingEnvironment {
        this.#assertNotDisposed();
        return this.#environment;
    }

    setEnvironment(patch: Partial<LightingEnvironment>): this;
    setEnvironment(patch: Parameters<typeof updateLightingEnvironment>[1]): this;
    setEnvironment(patch: Parameters<typeof updateLightingEnvironment>[1]): this {
        this.#assertNotDisposed();
        this.#environment = updateLightingEnvironment(this.#environment, patch);
        this.#bumpVersion();
        return this;
    }

    resetEnvironment(): this {
        this.#assertNotDisposed();
        this.#environment = DEFAULT_LIGHTING_ENVIRONMENT;
        this.#bumpVersion();
        return this;
    }

    addDirectional(input: DirectionalLightCreateInput): DirectionalLightDefinition {
        this.#assertNotDisposed();
        const definition = createDirectionalLightDefinition(
            input,
            this.#createLightId(LightKind.Directional)
        );
        const record = this.#createRecord(definition);
        this.#insertRecord(record);
        return definition;
    }

    addPoint(input: PointLightCreateInput): PointLightDefinition {
        this.#assertNotDisposed();
        const definition = createPointLightDefinition(input, this.#createLightId(LightKind.Point));
        const record = this.#createRecord(definition);
        this.#insertRecord(record);
        return definition;
    }

    addSpot(input: SpotLightCreateInput): SpotLightDefinition {
        this.#assertNotDisposed();
        const definition = createSpotLightDefinition(input, this.#createLightId(LightKind.Spot));
        const record = this.#createRecord(definition);
        this.#insertRecord(record);
        return definition;
    }

    get(id: string): LightDefinition | null;
    get(id: DirectionalLightDefinition['id']): DirectionalLightDefinition | null;
    get(id: PointLightDefinition['id']): PointLightDefinition | null;
    get(id: SpotLightDefinition['id']): SpotLightDefinition | null;
    get(id: string): LightDefinition | null {
        this.#assertNotDisposed();
        return this.#records.get(id)?.definition ?? null;
    }

    has(id: string): boolean {
        this.#assertNotDisposed();
        return this.#records.has(id);
    }

    list(): readonly LightDefinition[] {
        this.#assertNotDisposed();
        return this.#orderedDefinitions;
    }

    update(id: DirectionalLightDefinition['id'], patch: DirectionalLightPatch): DirectionalLightDefinition;
    update(id: PointLightDefinition['id'], patch: PointLightPatch): PointLightDefinition;
    update(id: SpotLightDefinition['id'], patch: SpotLightPatch): SpotLightDefinition;
    update(id: string, patch: DirectionalLightPatch | PointLightPatch | SpotLightPatch): LightDefinition;
    update(id: string, patch: DirectionalLightPatch | PointLightPatch | SpotLightPatch): LightDefinition {
        this.#assertNotDisposed();
        const current = this.#records.get(id);

        if (!current) {
            throw new LightingValidationError('lighting.light.not-found', `No light with id ${id} exists in this rig`, {
                id,
            });
        }

        let definition: LightDefinition;

        switch (current.definition.kind) {
            case LightKind.Directional:
                definition = applyDirectionalLightPatch(
                    current.definition,
                    patch as DirectionalLightPatch
                );
                break;
            case LightKind.Point:
                definition = applyPointLightPatch(current.definition, patch as PointLightPatch);
                break;
            case LightKind.Spot:
                definition = applySpotLightPatch(current.definition, patch as SpotLightPatch);
                break;
        }

        const nextRecord: InternalLightRecord = Object.freeze({
            definition,
            sequence: current.sequence,
        });
        this.#records.set(id, nextRecord);
        this.#orderedRecords = Object.freeze(
            this.#orderedRecords.map((entry) => (entry.sequence === current.sequence ? nextRecord : entry))
        );
        this.#orderedDefinitions = Object.freeze(
            this.#orderedRecords.map((entry) => entry.definition)
        );
        this.#bumpVersion();
        return definition;
    }

    remove(id: string): boolean {
        this.#assertNotDisposed();
        const existing = this.#records.get(id);

        if (!existing) {
            return false;
        }

        this.#records.delete(id);
        this.#orderedRecords = Object.freeze(
            this.#orderedRecords.filter((entry) => entry.sequence !== existing.sequence)
        );
        this.#orderedDefinitions = Object.freeze(
            this.#orderedRecords.map((entry) => entry.definition)
        );
        this.#bumpVersion();
        return true;
    }

    clear(): this {
        this.#assertNotDisposed();

        if (this.#records.size === 0) {
            return this;
        }

        this.#records.clear();
        this.#orderedRecords = Object.freeze([] as InternalLightRecord[]);
        this.#orderedDefinitions = Object.freeze([] as LightDefinition[]);
        this.#bumpVersion();
        return this;
    }

    resolveFrame(
        resolver: Pick<LightingRigReadable & { resolve: (rig: LightingRigReadable, options?: LightingSelectionOptions) => LightingSelectionState }, 'resolve'>,
        options?: LightingSelectionOptions
    ): LightingSelectionState {
        this.#assertNotDisposed();
        return resolver.resolve(this, options);
    }

    dispose(): void {
        if (this.#isDisposed) {
            return;
        }

        this.#records.clear();
        this.#orderedRecords = Object.freeze([] as InternalLightRecord[]);
        this.#orderedDefinitions = Object.freeze([] as LightDefinition[]);
        this.#environment = DEFAULT_LIGHTING_ENVIRONMENT;
        this.#isDisposed = true;
    }

    readonly [LIGHTING_RIG_ACCESS] = () => {
        this.#assertNotDisposed();
        return {
            id: this.#id,
            version: brandLightingVersion(this.#version),
            environment: this.#environment,
            entries: this.#orderedRecords,
        };
    };

    #createLightId(kind: string): string {
        this.#lightOrdinal += 1;
        return `${kind}:${this.#lightOrdinal}`;
    }

    #createRecord<K extends LightKind>(definition: LightDefinition<K>): InternalLightRecord<K> {
        return Object.freeze({
            definition,
            sequence: ++this.#sequence,
        });
    }

    #insertRecord(record: InternalLightRecord): void {
        const id = String(record.definition.id);

        if (this.#records.has(id)) {
            throw new LightingValidationError('lighting.light.duplicate-id', `A light with id ${id} already exists in this rig`, {
                id,
            });
        }

        this.#records.set(id, record);
        this.#orderedRecords = Object.freeze([...this.#orderedRecords, record]);
        this.#orderedDefinitions = Object.freeze(
            this.#orderedRecords.map((entry) => entry.definition)
        );
        this.#bumpVersion();
    }

    #bumpVersion(): void {
        this.#version += 1;
    }

    #assertNotDisposed(): void {
        if (this.#isDisposed) {
            throw new LightingDisposedError('LightingRig');
        }
    }
}