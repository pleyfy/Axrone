import { AudioListenerComponent, AudioSourceComponent } from './components';
import { AudioSystem } from './system';
import type {
    AudioAssetSchema,
    AudioSourceComponentCommand,
} from './types';

export class AudioComponentBinder<TSchema extends AudioAssetSchema = AudioAssetSchema> {
    readonly #listeners = new Set<AudioListenerComponent>();
    readonly #sources = new Set<AudioSourceComponent<TSchema>>();

    constructor(readonly system: AudioSystem<TSchema>) {}

    attachListener(component: AudioListenerComponent): this {
        this.#listeners.add(component);
        return this;
    }

    detachListener(component: AudioListenerComponent): boolean {
        return this.#listeners.delete(component);
    }

    attachSource(component: AudioSourceComponent<TSchema>): this {
        this.#sources.add(component);
        return this;
    }

    detachSource(component: AudioSourceComponent<TSchema>): boolean {
        return this.#sources.delete(component);
    }

    clear(): void {
        this.#listeners.clear();
        this.#sources.clear();
    }

    async update(): Promise<void> {
        for (const listener of this.#listeners) {
            this.system.upsertListener(listener.toDescriptor());
            if (listener.active) {
                this.system.setActiveListener(listener.listenerId);
            }
        }

        for (const source of this.#sources) {
            const state = this.system.upsertSource(source.toDescriptor());
            source.syncState(state);
            const commands = source.consumeCommands();
            for (const command of commands) {
                await this.#dispatchSourceCommand(source, command);
            }
        }

        this.system.refreshSpatialAudio();
    }

    async #dispatchSourceCommand(
        component: AudioSourceComponent<TSchema>,
        command: AudioSourceComponentCommand<TSchema>
    ): Promise<void> {
        switch (command.kind) {
            case 'play':
                component.syncState(
                    await this.system
                        .playSource(component.sourceId, command.request)
                        .then(() => this.system.getSource(component.sourceId)!)
                );
                break;
            case 'pause':
                this.system.pauseSource(component.sourceId);
                break;
            case 'resume':
                component.syncState(
                    await this.system
                        .resumeSource(component.sourceId)
                        .then(() => this.system.getSource(component.sourceId)!)
                );
                break;
            case 'stop':
                this.system.stopSource(component.sourceId, command.options);
                break;
        }
    }
}
