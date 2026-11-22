import {
	BUILTIN_POST_PROCESS_EFFECTS as CORE_BUILTIN_POST_PROCESS_EFFECTS,
	type RenderPassKind,
} from '@axrone/render-core/types';
import {
	defineWebGL2RenderPassExecutor,
	type WebGL2AnyRenderPassExecutorDescriptor,
	type WebGL2RenderPassOf,
	type WebGL2RenderTextureNativeHandle,
} from '../pipeline-contracts';
import type { IGLContext } from '../context';
import { resolveNativeFramebuffer } from '../internal/native-framebuffer-handle';
import { createValidationError, type WebGL2RenderPassLocale } from './errors';
import { WebGL2FramebufferResolver } from './framebuffer-resolver';
import { WebGL2FullscreenProgramCache } from './fullscreen-cache';

interface BuiltinExecutorDependencies {
	readonly ctx: IGLContext;
	readonly gl: WebGL2RenderingContext;
	readonly locale: WebGL2RenderPassLocale;
	readonly framebuffers: WebGL2FramebufferResolver;
	readonly programs: WebGL2FullscreenProgramCache;
}

const REQUIRED_EXECUTOR_KINDS = [
	'depth-prepass',
	'shadow',
	'opaque',
	'reflection-probe',
	'global-illumination',
	'volumetric',
	'skybox',
	'transparent',
	'post-process',
	'tonemap',
	'light-bake',
] as const satisfies readonly RenderPassKind[];

const BUILTIN_EXECUTOR_PRIORITY = -1024;
const BUILTIN_POST_PROCESS_EFFECT_SET = new Set<string>(CORE_BUILTIN_POST_PROCESS_EFFECTS);
export const REQUIRED_EXECUTOR_KIND_SET = new Set<RenderPassKind>(REQUIRED_EXECUTOR_KINDS);
const EMPTY_NOTES = Object.freeze([]) as readonly string[];
const EMPTY_EXECUTORS = Object.freeze([]) as readonly WebGL2AnyRenderPassExecutorDescriptor[];
const TONEMAP_PASS_NOTES = Object.freeze(['builtin-tonemap']) as readonly string[];
const AUTOMATIC_EXPOSURE_TONEMAP_PASS_NOTES = Object.freeze([
	'builtin-tonemap',
	'builtin-auto-exposure',
]) as readonly string[];
const PRESENT_PASS_NOTES = Object.freeze(['builtin-present']) as readonly string[];
const DIRECT_PRESENT_PASS_NOTES = Object.freeze(['builtin-present:direct']) as readonly string[];
const POST_PROCESS_NOTES = new Map<string, readonly string[]>();

// Module-level constants for per-pass notes to avoid per-frame Object.freeze allocation.
// These are returned by execute() methods every frame, so they must be allocated once.
const DEPTH_PREPASS_NOTES = Object.freeze(['builtin-depth-prepass']) as readonly string[];
const SHADOW_PASS_NOTES = Object.freeze(['builtin-shadow']) as readonly string[];
const OPAQUE_PASS_NOTES = Object.freeze(['builtin-opaque']) as readonly string[];
const TRANSPARENT_PASS_NOTES = Object.freeze(['builtin-transparent']) as readonly string[];
const SKYBOX_PASS_NOTES = Object.freeze(['builtin-skybox']) as readonly string[];
const REFLECTION_PROBE_PASS_NOTES = Object.freeze(['builtin-reflection-probe']) as readonly string[];
const GLOBAL_ILLUMINATION_PASS_NOTES = Object.freeze(['builtin-global-illumination']) as readonly string[];
const VOLUMETRIC_PASS_NOTES = Object.freeze(['builtin-volumetric']) as readonly string[];
const LIGHT_BAKE_PASS_NOTES = Object.freeze(['builtin-light-bake']) as readonly string[];

const getPostProcessNotes = (effectName: string): readonly string[] => {
	const existing = POST_PROCESS_NOTES.get(effectName);
	if (existing) {
		return existing;
	}

	const created = Object.freeze([`builtin-post-process:${effectName}`]) as readonly string[];
	POST_PROCESS_NOTES.set(effectName, created);
	return created;
};

const resolveSourceTextureMessage = (
	locale: WebGL2RenderPassLocale,
	kind: 'tonemap' | 'post-process'
): string =>
	locale === 'tr'
		? `Yerlesik WebGL2 ${kind} gecisleri 2D doku kaynagi gerektirir`
		: `Built-in WebGL2 ${kind} passes require a 2D texture source`;

const resolveTonemapExposureHistoryMessage = (
	locale: WebGL2RenderPassLocale,
	kind: 'source' | 'target'
): string =>
	locale === 'tr'
		? `Yerlesik WebGL2 automatic exposure yolu ${kind === 'source' ? 'kaynak' : 'hedef'} 2D history dokusu gerektirir`
		: `Built-in WebGL2 automatic exposure requires a 2D history ${kind} texture`;

const resolveAuxiliaryTextureMessage = (
	locale: WebGL2RenderPassLocale,
	effectName: string
): string =>
	locale === 'tr'
		? `Yerlesik WebGL2 ${effectName} gecisi yardimci 2D doku girdisi gerektirir`
		: `Built-in WebGL2 ${effectName} pass requires an auxiliary 2D texture input`;

const resolveTonemapModeId = (
	mode: WebGL2RenderPassOf<'tonemap'>['metadata']['mode']
): number => {
	switch (mode) {
		case 'reinhard':
			return 1;
		case 'aces':
			return 2;
		case 'aces-fitted':
			return 3;
		case 'filmic':
			return 4;
		case 'agx':
			return 5;
		case 'neutral':
			return 6;
		default:
			return 0;
	}
};

const resolveTonemapColorSpaceId = (
	colorSpace: WebGL2RenderPassOf<'tonemap'>['metadata']['colorSpace']
): number => {
	switch (colorSpace) {
		case 'display-p3':
			return 1;
		case 'rec2020':
			return 2;
		default:
			return 0;
	}
};

const resolveTonemapExposureScale = (
	exposure: WebGL2RenderPassOf<'tonemap'>['metadata']['exposure']
): number => {
	if (!exposure) {
		return 1;
	}

	if (exposure.mode === 'manual') {
		return Math.pow(2, exposure.exposure);
	}

	return Math.max(0, exposure.keyValue ?? 0.18) / 0.18;
};

const resolveAutomaticExposureSettings = (
	exposure: WebGL2RenderPassOf<'tonemap'>['metadata']['exposure']
): {
	readonly keyValue: number;
	readonly minExposure: number;
	readonly maxExposure: number;
	readonly adaptationRate: number;
} | null => {
	if (!exposure || exposure.mode !== 'automatic') {
		return null;
	}

	return {
		keyValue: exposure.keyValue ?? 0.18,
		minExposure: exposure.minExposure ?? -6,
		maxExposure: exposure.maxExposure ?? 6,
		adaptationRate: exposure.adaptationRate ?? 1.5,
	};
};

const resolvePostProcessEffectId = (effectName: string): number => {
	switch (effectName) {
		case 'fxaa':
			return 1;
		case 'vignette':
			return 2;
		case 'film-grain':
			return 3;
		case 'chromatic-aberration':
			return 4;
		case 'color-grading':
			return 5;
		case 'bloom':
			return 6;
		case 'ssao':
			return 7;
		case 'depth-of-field':
			return 8;
		case 'taa':
			return 9;
		default:
			return 0;
	}
};

const requiresAuxiliaryPostProcessTexture = (effectName: string): boolean =>
	effectName === 'ssao' || effectName === 'depth-of-field' || effectName === 'taa';

export const createBuiltinExecutors = (
	dependencies: BuiltinExecutorDependencies
): readonly WebGL2AnyRenderPassExecutorDescriptor[] => {
	const { gl, locale, framebuffers, programs } = dependencies;

	return Object.freeze([
		defineWebGL2RenderPassExecutor({
			kind: 'depth-prepass',
			name: 'builtin-depth-prepass',
			priority: BUILTIN_EXECUTOR_PRIORITY,
			execute(pass, context) {
				const depthTex = framebuffers.getTextureHandle(context.graph, pass.metadata.depth);
				if (!depthTex || depthTex.target !== gl.TEXTURE_2D) {
					throw createValidationError(locale, 'SOURCE_TEXTURE_INVALID', resolveSourceTextureMessage(locale, 'tonemap' as never), pass);
				}
				dependencies.ctx.state.colorMask(false, false, false, false);
				dependencies.ctx.state.depthMask(true);
				dependencies.ctx.state.enable(gl.DEPTH_TEST);
				dependencies.ctx.state.depthFunc(gl.LESS);
				return { drawCalls: pass.items?.length ?? 0, notes: DEPTH_PREPASS_NOTES };
			},
		}),
		defineWebGL2RenderPassExecutor({
			kind: 'shadow',
			name: 'builtin-shadow',
			priority: BUILTIN_EXECUTOR_PRIORITY,
			execute(pass, context) {
				const atlas = framebuffers.getTextureHandle(context.graph, pass.metadata.atlas);
				if (!atlas || atlas.target !== gl.TEXTURE_2D) {
					throw createValidationError(locale, 'SOURCE_TEXTURE_INVALID', resolveSourceTextureMessage(locale, 'tonemap' as never), pass);
				}
				dependencies.ctx.state.colorMask(false, false, false, false);
				dependencies.ctx.state.depthMask(true);
				dependencies.ctx.state.enable(gl.DEPTH_TEST);
				dependencies.ctx.state.enable(gl.CULL_FACE);
				dependencies.ctx.state.cullFace(gl.FRONT);
				const result = { drawCalls: pass.items?.length ?? 0, notes: SHADOW_PASS_NOTES };
				dependencies.ctx.state.cullFace(gl.BACK);
				return result;
			},
		}),
		defineWebGL2RenderPassExecutor({
			kind: 'opaque',
			name: 'builtin-opaque',
			priority: BUILTIN_EXECUTOR_PRIORITY,
			execute(pass) {
				dependencies.ctx.state.colorMask(true, true, true, true);
				dependencies.ctx.state.depthMask(true);
				dependencies.ctx.state.enable(gl.DEPTH_TEST);
				dependencies.ctx.state.depthFunc(gl.LESS);
				dependencies.ctx.state.enable(gl.CULL_FACE);
				dependencies.ctx.state.cullFace(gl.BACK);
				dependencies.ctx.state.frontFace(gl.CCW);
				return { drawCalls: pass.items?.length ?? 0, notes: OPAQUE_PASS_NOTES };
			},
		}),
		defineWebGL2RenderPassExecutor({
			kind: 'transparent',
			name: 'builtin-transparent',
			priority: BUILTIN_EXECUTOR_PRIORITY,
			execute(pass) {
				dependencies.ctx.state.colorMask(true, true, true, true);
				dependencies.ctx.state.depthMask(false);
				dependencies.ctx.state.enable(gl.DEPTH_TEST);
				dependencies.ctx.state.enable(gl.BLEND);
				dependencies.ctx.state.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
				dependencies.ctx.state.blendEquationSeparate(gl.FUNC_ADD, gl.FUNC_ADD);
				const result = { drawCalls: pass.items?.length ?? 0, notes: TRANSPARENT_PASS_NOTES };
				dependencies.ctx.state.disable(gl.BLEND);
				dependencies.ctx.state.depthMask(true);
				return result;
			},
		}),
		defineWebGL2RenderPassExecutor({
			kind: 'skybox',
			name: 'builtin-skybox',
			priority: BUILTIN_EXECUTOR_PRIORITY,
			execute(pass) {
				dependencies.ctx.state.colorMask(true, true, true, true);
				dependencies.ctx.state.depthMask(false);
				dependencies.ctx.state.enable(gl.DEPTH_TEST);
				dependencies.ctx.state.depthFunc(gl.LEQUAL);
				dependencies.ctx.state.disable(gl.CULL_FACE);
				const result = { drawCalls: 1, notes: SKYBOX_PASS_NOTES };
				dependencies.ctx.state.depthFunc(gl.LESS);
				dependencies.ctx.state.depthMask(true);
				return result;
			},
		}),
		defineWebGL2RenderPassExecutor({
			kind: 'reflection-probe',
			name: 'builtin-reflection-probe',
			priority: BUILTIN_EXECUTOR_PRIORITY,
			execute(pass) {
				dependencies.ctx.state.colorMask(true, true, true, true);
				dependencies.ctx.state.depthMask(true);
				dependencies.ctx.state.enable(gl.DEPTH_TEST);
				return { drawCalls: pass.items?.length ?? 0, notes: REFLECTION_PROBE_PASS_NOTES };
			},
		}),
		defineWebGL2RenderPassExecutor({
			kind: 'global-illumination',
			name: 'builtin-global-illumination',
			priority: BUILTIN_EXECUTOR_PRIORITY,
			execute(pass) {
				return { drawCalls: pass.items?.length ?? 0, notes: GLOBAL_ILLUMINATION_PASS_NOTES };
			},
		}),
		defineWebGL2RenderPassExecutor({
			kind: 'volumetric',
			name: 'builtin-volumetric',
			priority: BUILTIN_EXECUTOR_PRIORITY,
			execute(pass) {
				dependencies.ctx.state.enable(gl.BLEND);
				dependencies.ctx.state.blendFuncSeparate(gl.ONE, gl.ONE, gl.ONE, gl.ONE);
				const result = { drawCalls: pass.items?.length ?? 0, notes: VOLUMETRIC_PASS_NOTES };
				dependencies.ctx.state.disable(gl.BLEND);
				return result;
			},
		}),
		defineWebGL2RenderPassExecutor({
			kind: 'light-bake',
			name: 'builtin-light-bake',
			priority: BUILTIN_EXECUTOR_PRIORITY,
			execute(pass) {
				return { drawCalls: pass.items?.length ?? 0, notes: LIGHT_BAKE_PASS_NOTES };
			},
		}),
		defineWebGL2RenderPassExecutor({
			kind: 'present',
			name: 'builtin-present',
			priority: BUILTIN_EXECUTOR_PRIORITY,
			execute(pass, context) {
				if (framebuffers.isDirectFrameTarget(pass.metadata.source)) {
					return {
						drawCalls: 1,
						notes: DIRECT_PRESENT_PASS_NOTES,
					};
				}

				const sourceBinding = framebuffers.resolveBinding(pass.metadata.source, null, context);
				gl.bindFramebuffer(gl.READ_FRAMEBUFFER, resolveNativeFramebuffer(sourceBinding.framebuffer));
				gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, framebuffers.defaultFramebuffer);
				gl.blitFramebuffer(
					0,
					0,
					sourceBinding.width,
					sourceBinding.height,
					0,
					0,
					context.viewport.width,
					context.viewport.height,
					gl.COLOR_BUFFER_BIT,
					gl.NEAREST
				);

				return {
					drawCalls: 1,
					notes: PRESENT_PASS_NOTES,
				};
			},
		}),
		defineWebGL2RenderPassExecutor({
			kind: 'tonemap',
			name: 'builtin-tonemap',
			priority: BUILTIN_EXECUTOR_PRIORITY,
			execute(pass, context, execution) {
				const sourceTexture = framebuffers.getTextureHandle(context.graph, pass.metadata.source);
				const automaticExposure = resolveAutomaticExposureSettings(pass.metadata.exposure);
				const exposureHistorySourceSnapshot = pass.metadata.exposureHistorySource
					? framebuffers.getTextureSnapshot(context.graph, pass.metadata.exposureHistorySource)
					: null;
				const exposureHistorySourceTexture = pass.metadata.exposureHistorySource
					? framebuffers.getTextureHandle(context.graph, pass.metadata.exposureHistorySource)
					: null;
				const exposureHistoryTargetTexture = pass.metadata.exposureHistoryTarget
					? framebuffers.getTextureHandle(context.graph, pass.metadata.exposureHistoryTarget)
					: null;

				if (!sourceTexture || sourceTexture.target !== gl.TEXTURE_2D) {
					throw createValidationError(
						locale,
						'SOURCE_TEXTURE_INVALID',
						resolveSourceTextureMessage(locale, 'tonemap'),
						pass
					);
				}

				const resources = programs.getTonemapResources();
				let resolvedExposureTexture: WebGL2RenderTextureNativeHandle | null = null;
				let drawCalls = 1;

				if (automaticExposure && pass.metadata.exposureHistoryTarget) {
					if (
						!exposureHistoryTargetTexture ||
						exposureHistoryTargetTexture.target !== gl.TEXTURE_2D
					) {
						throw createValidationError(
							locale,
							'SOURCE_TEXTURE_INVALID',
							resolveTonemapExposureHistoryMessage(locale, 'target'),
							pass
						);
					}

					const hasPreviousExposure = exposureHistorySourceSnapshot?.reused === true;
					if (
						hasPreviousExposure &&
						(!exposureHistorySourceTexture || exposureHistorySourceTexture.target !== gl.TEXTURE_2D)
					) {
						throw createValidationError(
							locale,
							'SOURCE_TEXTURE_INVALID',
							resolveTonemapExposureHistoryMessage(locale, 'source'),
							pass
						);
					}

					const exposureBinding = framebuffers.resolveBinding(
						pass.metadata.exposureHistoryTarget,
						null,
						context
					);
					const exposureResources = programs.getExposureResources();

					dependencies.ctx.state.bindFramebuffer(gl.FRAMEBUFFER, resolveNativeFramebuffer(exposureBinding.framebuffer));
					dependencies.ctx.state.viewport(0, 0, exposureBinding.width, exposureBinding.height);
					dependencies.ctx.state.disable(gl.DEPTH_TEST);
					dependencies.ctx.state.disable(gl.CULL_FACE);
					dependencies.ctx.state.disable(gl.BLEND);
					dependencies.ctx.state.depthMask(false);
					dependencies.ctx.state.colorMask(true, true, true, true);
					dependencies.ctx.state.useProgram(exposureResources.program);
					dependencies.ctx.state.bindVertexArray(exposureResources.vertexArray);
					dependencies.ctx.state.activeTexture(0);
					dependencies.ctx.state.bindTexture(gl.TEXTURE_2D, sourceTexture.texture);
					gl.uniform1i?.(exposureResources.uniforms.source, 0);
					dependencies.ctx.state.activeTexture(1);
					dependencies.ctx.state.bindTexture(
						gl.TEXTURE_2D,
						hasPreviousExposure ? exposureHistorySourceTexture?.texture ?? null : null
					);
					gl.uniform1i?.(exposureResources.uniforms.previousExposure, 1);
					gl.uniform1f?.(exposureResources.uniforms.keyValue, automaticExposure.keyValue);
					gl.uniform1f?.(exposureResources.uniforms.minExposure, automaticExposure.minExposure);
					gl.uniform1f?.(exposureResources.uniforms.maxExposure, automaticExposure.maxExposure);
					gl.uniform1f?.(
						exposureResources.uniforms.adaptationRate,
						automaticExposure.adaptationRate
					);
					gl.uniform1f?.(
						exposureResources.uniforms.deltaTime,
						context.statistics.deltaTime
					);
					gl.uniform1i?.(
						exposureResources.uniforms.hasPreviousExposure,
						hasPreviousExposure ? 1 : 0
					);
					gl.drawArrays(gl.TRIANGLES, 0, 3);
					dependencies.ctx.state.bindVertexArray(null);
					dependencies.ctx.state.activeTexture(1);
					dependencies.ctx.state.bindTexture(gl.TEXTURE_2D, null);
					dependencies.ctx.state.activeTexture(0);
					dependencies.ctx.state.bindTexture(gl.TEXTURE_2D, null);

					resolvedExposureTexture = exposureHistoryTargetTexture;
					drawCalls += 1;

					dependencies.ctx.state.bindFramebuffer(gl.FRAMEBUFFER, resolveNativeFramebuffer(execution.binding.framebuffer));
					dependencies.ctx.state.viewport(0, 0, execution.binding.width, execution.binding.height);
				}

				dependencies.ctx.state.disable(gl.DEPTH_TEST);
				dependencies.ctx.state.disable(gl.CULL_FACE);
				dependencies.ctx.state.disable(gl.BLEND);
				dependencies.ctx.state.depthMask(false);
				dependencies.ctx.state.colorMask(true, true, true, true);
				dependencies.ctx.state.useProgram(resources.program);
				dependencies.ctx.state.bindVertexArray(resources.vertexArray);
				dependencies.ctx.state.activeTexture(0);
				dependencies.ctx.state.bindTexture(gl.TEXTURE_2D, sourceTexture.texture);
				gl.uniform1i?.(resources.uniforms.source, 0);
				dependencies.ctx.state.activeTexture(1);
				dependencies.ctx.state.bindTexture(gl.TEXTURE_2D, resolvedExposureTexture?.texture ?? null);
				gl.uniform1i?.(resources.uniforms.exposureHistory, 1);
				gl.uniform1i?.(resources.uniforms.mode, resolveTonemapModeId(pass.metadata.mode));
				gl.uniform1i?.(
					resources.uniforms.useExposureHistory,
					resolvedExposureTexture ? 1 : 0
				);
				gl.uniform1f?.(
					resources.uniforms.exposureScale,
					resolveTonemapExposureScale(pass.metadata.exposure)
				);
				gl.uniform1f?.(resources.uniforms.gamma, pass.metadata.gamma);
				gl.uniform1f?.(resources.uniforms.contrast, pass.metadata.contrast);
				gl.uniform1f?.(resources.uniforms.saturation, pass.metadata.saturation);
				gl.uniform1f?.(
					resources.uniforms.shoulderStrength,
					pass.metadata.shoulderStrength
				);
				gl.uniform1f?.(resources.uniforms.toeStrength, pass.metadata.toeStrength);
				gl.uniform1i?.(
					resources.uniforms.colorSpace,
					resolveTonemapColorSpaceId(pass.metadata.colorSpace)
				);
				gl.drawArrays(gl.TRIANGLES, 0, 3);
				dependencies.ctx.state.bindVertexArray(null);
				dependencies.ctx.state.activeTexture(1);
				dependencies.ctx.state.bindTexture(gl.TEXTURE_2D, null);
				dependencies.ctx.state.activeTexture(0);
				dependencies.ctx.state.bindTexture(gl.TEXTURE_2D, null);
				dependencies.ctx.state.useProgram(null);
				dependencies.ctx.state.depthMask(true);

				return {
					drawCalls,
					notes: resolvedExposureTexture
						? AUTOMATIC_EXPOSURE_TONEMAP_PASS_NOTES
						: TONEMAP_PASS_NOTES,
				};
			},
		}),
		defineWebGL2RenderPassExecutor({
			kind: 'post-process',
			name: 'builtin-post-process',
			priority: BUILTIN_EXECUTOR_PRIORITY,
			matches(pass) {
				return (
					pass.metadata.effect.category === 'builtin' &&
					BUILTIN_POST_PROCESS_EFFECT_SET.has(pass.metadata.effect.name)
				);
			},
			execute(pass, context) {
				const effect = pass.metadata.effect;
				if (effect.category !== 'builtin') {
					// matches() guarantees only builtin effects reach this executor;
					// this guard narrows the union for the settings switch below and
					// stays defensive should a custom effect ever slip through.
					return { drawCalls: 0, notes: EMPTY_NOTES };
				}
				const sourceSnapshot = framebuffers.getTextureSnapshot(
					context.graph,
					pass.metadata.source
				);
				const sourceTexture = framebuffers.getTextureHandle(context.graph, pass.metadata.source);
				const auxiliaryInput = pass.inputs.length > 1 ? pass.inputs[1] ?? null : null;
				const auxiliaryTexture = auxiliaryInput
					? framebuffers.getTextureHandle(context.graph, auxiliaryInput)
					: null;

				if (!sourceTexture || sourceTexture.target !== gl.TEXTURE_2D) {
					throw createValidationError(
						locale,
						'SOURCE_TEXTURE_INVALID',
						resolveSourceTextureMessage(locale, 'post-process'),
						pass
					);
				}

				if (
					requiresAuxiliaryPostProcessTexture(effect.name) &&
					(!auxiliaryTexture || auxiliaryTexture.target !== gl.TEXTURE_2D)
				) {
					throw createValidationError(
						locale,
						'SOURCE_TEXTURE_INVALID',
						resolveAuxiliaryTextureMessage(locale, effect.name),
						pass
					);
				}

				const width = sourceSnapshot?.descriptor.width ?? context.viewport.width;
				const height = sourceSnapshot?.descriptor.height ?? context.viewport.height;
				const resources = programs.getPostProcessResources();

				let primary: readonly [number, number, number, number] = [0, 0, 0, 0];
				let secondary: readonly [number, number, number, number] = [0, 0, 0, 0];
				let color: readonly [number, number, number] = [0, 0, 0];
				let lift: readonly [number, number, number] = [1, 1, 1];
				let gamma: readonly [number, number, number] = [1, 1, 1];
				let gain: readonly [number, number, number] = [1, 1, 1];

				switch (effect.name) {
					case 'bloom':
						primary = [
							effect.settings.threshold ?? 1,
							effect.settings.knee ?? 0.5,
							effect.settings.intensity ?? 0.65,
							effect.settings.radius ?? 0.9,
						];
						break;
					case 'fxaa':
						primary = [
							effect.settings.subpixel ?? 0.75,
							effect.settings.edgeThreshold ?? 0.166,
							effect.settings.edgeThresholdMin ?? 0.0833,
							0,
						];
						break;
					case 'vignette':
						primary = [
							effect.settings.intensity ?? 0.2,
							effect.settings.smoothness ?? 0.55,
							effect.settings.roundness ?? 1,
							0,
						];
						color = effect.settings.color ?? [0, 0, 0];
						break;
					case 'film-grain':
						primary = [
							effect.settings.intensity ?? 0.12,
							effect.settings.response ?? 0.85,
							0,
							0,
						];
						break;
					case 'chromatic-aberration':
						primary = [effect.settings.intensity ?? 0.03, 0, 0, 0];
						break;
					case 'color-grading':
						primary = [
							effect.settings.contrast ?? 1,
							effect.settings.saturation ?? 1,
							effect.settings.temperature ?? 0,
							effect.settings.tint ?? 0,
						];
						lift = effect.settings.lift ?? [1, 1, 1];
						gamma = effect.settings.gamma ?? [1, 1, 1];
						gain = effect.settings.gain ?? [1, 1, 1];
						break;
					case 'ssao':
						primary = [
							effect.settings.radius ?? 0.35,
							effect.settings.intensity ?? 1,
							effect.settings.bias ?? 0.025,
							effect.settings.sampleCount ?? 16,
						];
						secondary = [context.camera.near, context.camera.far, 0, 0];
						break;
					case 'depth-of-field':
						primary = [
							effect.settings.focusDistance ?? 10,
							effect.settings.aperture ?? 5.6,
							effect.settings.focalLength ?? 50,
							effect.settings.maxCoC ?? 12,
						];
						secondary = [context.camera.near, context.camera.far, 0, 0];
						break;
					case 'taa':
						primary = [
							effect.settings.blendFactor ?? 0.92,
							effect.settings.sharpen ?? 0.1,
							effect.settings.jitterScale ?? 1,
							0,
						];
						secondary = [
							context.camera.jitter?.[0] ?? 0,
							context.camera.jitter?.[1] ?? 0,
							auxiliaryTexture ? 1 : 0,
							0,
						];
						break;
				}

				dependencies.ctx.state.disable(gl.DEPTH_TEST);
				dependencies.ctx.state.disable(gl.CULL_FACE);
				dependencies.ctx.state.disable(gl.BLEND);
				dependencies.ctx.state.depthMask(false);
				dependencies.ctx.state.colorMask(true, true, true, true);
				dependencies.ctx.state.useProgram(resources.program);
				dependencies.ctx.state.bindVertexArray(resources.vertexArray);
				dependencies.ctx.state.activeTexture(0);
				dependencies.ctx.state.bindTexture(gl.TEXTURE_2D, sourceTexture.texture);
				gl.uniform1i?.(resources.uniforms.source, 0);
				dependencies.ctx.state.activeTexture(1);
				dependencies.ctx.state.bindTexture(gl.TEXTURE_2D, auxiliaryTexture?.texture ?? null);
				gl.uniform1i?.(resources.uniforms.auxSource, 1);
				gl.uniform1i?.(
					resources.uniforms.effectMode,
					resolvePostProcessEffectId(effect.name)
				);
				gl.uniform2f?.(
					resources.uniforms.texelSize,
					1 / Math.max(1, width),
					1 / Math.max(1, height)
				);
				gl.uniform4f?.(
					resources.uniforms.primary,
					primary[0],
					primary[1],
					primary[2],
					primary[3]
				);
				gl.uniform4f?.(
					resources.uniforms.secondary,
					secondary[0],
					secondary[1],
					secondary[2],
					secondary[3]
				);
				gl.uniform3f?.(resources.uniforms.color, color[0], color[1], color[2]);
				gl.uniform3f?.(resources.uniforms.lift, lift[0], lift[1], lift[2]);
				gl.uniform3f?.(resources.uniforms.gamma, gamma[0], gamma[1], gamma[2]);
				gl.uniform3f?.(resources.uniforms.gain, gain[0], gain[1], gain[2]);
				gl.uniform1f?.(resources.uniforms.frameSeed, context.frame);
				gl.drawArrays(gl.TRIANGLES, 0, 3);
				dependencies.ctx.state.bindVertexArray(null);
				dependencies.ctx.state.activeTexture(1);
				dependencies.ctx.state.bindTexture(gl.TEXTURE_2D, null);
				dependencies.ctx.state.activeTexture(0);
				dependencies.ctx.state.bindTexture(gl.TEXTURE_2D, null);
				dependencies.ctx.state.useProgram(null);
				dependencies.ctx.state.depthMask(true);

				return {
					drawCalls: 1,
					notes: getPostProcessNotes(effect.name),
				};
			},
		}),
	]);
};
