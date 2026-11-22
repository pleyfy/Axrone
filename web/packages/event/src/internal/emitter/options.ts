import {
    normalizeBufferOverflow,
    normalizeBufferSize,
    normalizeConcurrency,
    normalizeGcInterval,
    normalizeMaxListeners,
} from '../normalize';
import { DEFAULT_OPTIONS } from '../../definition';
import type { EventOptions } from '../../definition';

export function normalizeOptions(options: EventOptions): Required<EventOptions> {
    return {
        captureRejections:
            typeof options.captureRejections === 'boolean'
                ? options.captureRejections
                : DEFAULT_OPTIONS.captureRejections,
        maxListeners: normalizeMaxListeners(options.maxListeners, DEFAULT_OPTIONS.maxListeners),
        weakReferences:
            typeof options.weakReferences === 'boolean'
                ? options.weakReferences
                : DEFAULT_OPTIONS.weakReferences,
        concurrencyLimit: normalizeConcurrency(
            options.concurrencyLimit,
            DEFAULT_OPTIONS.concurrencyLimit
        ),
        bufferSize: normalizeBufferSize(options.bufferSize, DEFAULT_OPTIONS.bufferSize),
        gcIntervalMs: normalizeGcInterval(options.gcIntervalMs, DEFAULT_OPTIONS.gcIntervalMs),
        bufferOverflow: normalizeBufferOverflow(options.bufferOverflow, DEFAULT_OPTIONS.bufferOverflow),
        metrics: typeof options.metrics === 'boolean' ? options.metrics : DEFAULT_OPTIONS.metrics,
    };
}
