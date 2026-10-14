/**
 * Dual-channel feature configuration.
 *
 * `PDF_DUAL_CHANNEL_MODE` is the single rollback lever the plan asks for: an unrecognised
 * or absent value means `off`, and `off` must produce byte-identical behaviour to the code
 * before this feature existed. It is read at module load like the other worker flags
 * (LLM_WORKER_MODE / SOURCE_GATE_ENABLED), so changing it takes effect on restart.
 */

export type DualChannelMode = 'off' | 'shadow' | 'enforce';

const VALID_MODES: DualChannelMode[] = ['off', 'shadow', 'enforce'];

function normaliseMode(raw: string | undefined): DualChannelMode {
    const value = String(raw || '').trim().toLowerCase();
    return (VALID_MODES as string[]).includes(value) ? (value as DualChannelMode) : 'off';
}

export function readDualChannelMode(env: NodeJS.ProcessEnv = process.env): DualChannelMode {
    return normaliseMode(env.PDF_DUAL_CHANNEL_MODE);
}

export function readDualChannelVersion(env: NodeJS.ProcessEnv = process.env): string {
    return String(env.PDF_DUAL_CHANNEL_VERSION || 'v1').trim() || 'v1';
}

export const PDF_DUAL_CHANNEL_MODE: DualChannelMode = readDualChannelMode();
export const PDF_DUAL_CHANNEL_VERSION: string = readDualChannelVersion();

/** Enforce is only reachable after shadow has data; shadow is the maximum Phase 1 mode. */
export function isShadowMode(mode: DualChannelMode = PDF_DUAL_CHANNEL_MODE): boolean {
    return mode === 'shadow';
}

export function isEnforceMode(mode: DualChannelMode = PDF_DUAL_CHANNEL_MODE): boolean {
    return mode === 'enforce';
}

export function isDualChannelEnabled(mode: DualChannelMode = PDF_DUAL_CHANNEL_MODE): boolean {
    return mode !== 'off';
}

/**
 * Minimum agreement score for enforce to accept without the LLM. Values outside (0, 1]
 * fall back to the default rather than silently disabling the check.
 */
export function readMinConfidence(env: NodeJS.ProcessEnv = process.env): number {
    const raw = Number(env.PDF_DUAL_CHANNEL_MIN_CONFIDENCE);
    return Number.isFinite(raw) && raw > 0 && raw <= 1 ? raw : 0.99;
}

export const PDF_DUAL_CHANNEL_MIN_CONFIDENCE: number = readMinConfidence();
