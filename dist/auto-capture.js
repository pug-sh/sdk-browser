import { setupClickTracking } from './events/click.js';
import { setupFormTracking } from './events/form.js';
import { setupDeadClickTracking, setupRageClickTracking } from './events/frustration.js';
import { setupPageViewTracking } from './events/page_view.js';
import { setupScrollTracking } from './events/scroll.js';
import { log } from './logger.js';
const trackers = {
    pageView: setupPageViewTracking,
    click: setupClickTracking,
    scroll: setupScrollTracking,
    form: setupFormTracking,
    rageClick: setupRageClickTracking,
    deadClick: setupDeadClickTracking,
};
const trackerKeys = Object.keys(trackers);
/**
 * Resolves a selection to the trackers it enables. Pure — diagnostics live in `validateAutoCapture`,
 * since this runs on every reconcile while warnings must fire once, at config time. A wrong
 * top-level type defaults to all trackers; a mostly-valid object keeps its good keys.
 */
const resolveAutoCapture = (autoCapture) => {
    if (autoCapture === undefined || autoCapture === true) {
        return trackerKeys;
    }
    if (autoCapture === false) {
        return [];
    }
    if (typeof autoCapture !== 'object' || autoCapture === null || Array.isArray(autoCapture)) {
        return trackerKeys;
    }
    const selection = autoCapture;
    return trackerKeys.filter(key => selection[key] === true);
};
/**
 * Reports a misconfigured selection, once, when it is set. Called from `setDesired` rather than
 * `reconcile`, which only consults the selection while tracking is active — validating there said
 * nothing for the consent-first flows the README recommends, then re-warned on every consent cycle.
 */
const validateAutoCapture = (autoCapture) => {
    if (autoCapture === undefined || typeof autoCapture === 'boolean') {
        return;
    }
    if (typeof autoCapture !== 'object' || autoCapture === null || Array.isArray(autoCapture)) {
        log.warn(`autoCapture must be a boolean or object, got ${typeof autoCapture}. Defaulting to all trackers.`);
        return;
    }
    // The type constrains TS callers to `true`, but this value is runtime-untrusted: the CDN one-tag
    // install feeds it from data-options JSON.
    const selection = autoCapture;
    const unknownKeys = Object.keys(selection).filter(key => !trackerKeys.includes(key));
    if (unknownKeys.length > 0) {
        log.warn(`Unknown autoCapture keys: ${unknownKeys.join(', ')}. Supported keys: ${trackerKeys.join(', ')}`);
    }
    const invalidKeys = trackerKeys.filter(key => selection[key] !== undefined && typeof selection[key] !== 'boolean');
    if (invalidKeys.length > 0) {
        log.warn(`autoCapture values must be \`true\` for keys: ${invalidKeys.join(', ')}. Ignoring invalid values.`);
    }
    // Two spellings of one mistake — the allowlist misread as a denylist — each silently losing
    // capture the integrator believes they kept: an explicit `false` anywhere (reported even when the
    // selection still enables something, since `{ pageView: true, scroll: false }` still loses four
    // trackers), or a selection that names trackers but enables none. Keyed on a written-out value
    // rather than key count, so `{}` and `scroll: flag || undefined` stay silent — they embed no
    // misconception.
    const enabled = trackerKeys.filter(key => selection[key] === true);
    const disabledKeys = trackerKeys.filter(key => selection[key] === false);
    const namesSomething = Object.keys(selection).some(key => selection[key] !== undefined);
    if (disabledKeys.length > 0 || (enabled.length === 0 && namesSomething)) {
        const cause = disabledKeys.length > 0
            ? `\`false\` on ${disabledKeys.join(', ')} changes nothing: those trackers are off either way, as is ` +
                'every key you did not list.'
            : 'a tracker runs only when its key is set to `true`, and this selection sets none.';
        log.warn(`autoCapture is an allowlist — only keys set to \`true\` are enabled — so ${cause} ` +
            `This selection enables ${enabled.length > 0 ? enabled.join(', ') : 'nothing at all'}. Pass ` +
            '`false` as the whole autoCapture value to disable capture deliberately.');
    }
};
/**
 * Owns the auto-capture lifecycle: holds the desired selection and reconciles live listeners against
 * it, gated on `isTrackingActive` (granted **or** cookieless). Cleanup is tracked per tracker, so
 * the selection can change at runtime without tearing down listeners that stay enabled.
 */
export const createAutoCaptureController = (track, isTrackingActive) => {
    const cleanups = new Map();
    let desired;
    const disable = (key) => {
        const cleanup = cleanups.get(key);
        if (!cleanup) {
            return;
        }
        try {
            cleanup();
        }
        catch (err) {
            log.error(`Error during cleanup of "${key}":`, err);
        }
        cleanups.delete(key);
    };
    const enable = (key) => {
        if (cleanups.has(key)) {
            return true;
        }
        try {
            cleanups.set(key, trackers[key](track));
            return true;
        }
        catch (err) {
            log.error(`Failed to initialize tracker "${key}":`, err);
            return false;
        }
    };
    // Effective listeners = desired selection gated by tracking being active. Idempotent:
    // already-enabled trackers that stay enabled are left untouched (no teardown + re-setup).
    const reconcile = () => {
        const enabledTrackers = new Set(isTrackingActive() ? resolveAutoCapture(desired) : []);
        for (const key of trackerKeys) {
            if (!enabledTrackers.has(key)) {
                disable(key);
            }
        }
        let failedCount = 0;
        for (const key of enabledTrackers) {
            if (!enable(key)) {
                failedCount++;
            }
        }
        if (failedCount > 0) {
            log.error(`${failedCount}/${enabledTrackers.size} trackers failed to initialize.`);
        }
        if (enabledTrackers.size === 0) {
            log.debug('Auto-capture disabled: no trackers are active.');
        }
    };
    return {
        /** Store the selection and reconcile against current consent. Validates here so a bad selection
         * is reported when set, even while consent is denied. */
        setDesired: (autoCapture) => {
            validateAutoCapture(autoCapture);
            desired = autoCapture;
            reconcile();
        },
        /** Re-reconcile after a consent change, reusing the stored selection. */
        apply: () => {
            reconcile();
        },
        /** Tear down every active listener (called on `destroy()`). */
        destroy: () => {
            for (const key of trackerKeys) {
                disable(key);
            }
        },
    };
};
