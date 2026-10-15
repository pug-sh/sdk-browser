import { getSafeElementText } from '../utils.js';
const eventRageClick = 'rage_click';
const eventDeadClick = 'dead_click';
const MAX_TEXT_LENGTH = 20;
export const setupRageClickTracking = (track) => {
    const CLICKS_THRESHOLD = 3;
    const TIME_WINDOW = 1000; // ms
    const DISTANCE_THRESHOLD = 40; // pixels
    let clicks = [];
    let cooldownUntil = 0;
    const onClick = (event) => {
        const now = Date.now();
        if (now < cooldownUntil) {
            return;
        }
        const newClick = { x: event.clientX, y: event.clientY, time: now };
        clicks = clicks.filter(c => now - c.time < TIME_WINDOW);
        clicks.push(newClick);
        if (clicks.length >= CLICKS_THRESHOLD) {
            const first = clicks[0];
            const allClose = clicks.every(c => Math.abs(c.x - first.x) < DISTANCE_THRESHOLD && Math.abs(c.y - first.y) < DISTANCE_THRESHOLD);
            if (allClose) {
                track(eventRageClick, {
                    clickCount: clicks.length,
                    element: event.target?.tagName ?? '',
                    x: first.x,
                    y: first.y,
                });
                clicks = [];
                // Drops all clicks during cooldown to avoid duplicate events from the same burst
                cooldownUntil = now + TIME_WINDOW;
            }
        }
    };
    window.addEventListener('click', onClick, true);
    return () => window.removeEventListener('click', onClick, true);
};
export const setupDeadClickTracking = (track) => {
    let mutationCount = 0;
    const pendingTimers = new Set();
    const observer = new MutationObserver(() => (mutationCount += 1));
    observer.observe(document.documentElement, { childList: true, attributes: true, subtree: true, characterData: true });
    const onClick = (event) => {
        if (!event.target) {
            return;
        }
        const target = event.target;
        if (target === document.body || target === document.documentElement) {
            return;
        }
        const urlBefore = window.location.href;
        const countAtClick = mutationCount;
        const timer = setTimeout(() => {
            pendingTimers.delete(timer);
            const urlAfter = window.location.href;
            if (urlBefore === urlAfter && mutationCount === countAtClick) {
                // Focus on an input is an effect, not a dead click
                if (document.activeElement === target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) {
                    return;
                }
                track(eventDeadClick, {
                    element: target.tagName,
                    text: getSafeElementText(target, MAX_TEXT_LENGTH),
                    x: event.clientX,
                    y: event.clientY,
                });
            }
        }, 500);
        pendingTimers.add(timer);
    };
    window.addEventListener('click', onClick, true);
    return () => {
        window.removeEventListener('click', onClick, true);
        observer.disconnect();
        for (const timer of pendingTimers) {
            clearTimeout(timer);
        }
        pendingTimers.clear();
    };
};
