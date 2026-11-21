import { getSafeElementText, isElement } from '../utils.js';
import { createForwardedClickDetector } from './forwarded-click.js';
const eventRageClick = 'rage_click';
const eventDeadClick = 'dead_click';
const MAX_TEXT_LENGTH = 20;
const MAX_NATIVE_CLICKS = 3; // a triple-click, the longest native multi-click gesture
const FIELD_TAGS = ['INPUT', 'TEXTAREA', 'SELECT'];
export const setupRageClickTracking = (track) => {
    const CLICKS_THRESHOLD = MAX_NATIVE_CLICKS + 1;
    const TIME_WINDOW = 1000; // ms
    const DISTANCE_THRESHOLD = 40; // pixels
    const forwardedTo = createForwardedClickDetector();
    let origin = { x: 0, y: 0 };
    let recent = [];
    let clickCount = 0;
    let reported = false;
    const onClick = (event) => {
        if (forwardedTo(event)) {
            return;
        }
        const now = Date.now();
        recent = recent.filter(time => now - time < TIME_WINDOW);
        const nearOrigin = Math.abs(event.clientX - origin.x) < DISTANCE_THRESHOLD && Math.abs(event.clientY - origin.y) < DISTANCE_THRESHOLD;
        if (recent.length === 0 || !nearOrigin) {
            origin = { x: event.clientX, y: event.clientY };
            recent = [];
            clickCount = 0;
            reported = false;
        }
        recent.push(now);
        clickCount += 1;
        // Sent once per burst, as soon as it qualifies, so clickCount is the clicks so far: holding it
        // for the final count loses it whenever the burst ends in a navigation.
        if (!reported && recent.length >= CLICKS_THRESHOLD) {
            reported = true;
            const target = event.target;
            track(eventRageClick, {
                clickCount,
                element: isElement(target) ? target.tagName : '',
                x: origin.x,
                y: origin.y,
            });
        }
    };
    window.addEventListener('click', onClick, true);
    return () => window.removeEventListener('click', onClick, true);
};
export const setupDeadClickTracking = (track) => {
    let mutationCount = 0;
    let selectionCount = 0;
    let gesture;
    const pendingTimers = new Set();
    const observer = new MutationObserver(() => (mutationCount += 1));
    observer.observe(document.documentElement, { childList: true, attributes: true, subtree: true, characterData: true });
    // Selecting text is a response, but every click on text also moves the invisible caret, so only a
    // highlighted selection counts: one in the target, or a change to or from one.
    const hasSelection = () => document.getSelection()?.isCollapsed === false;
    const selectedTextIn = (target) => {
        const selection = document.getSelection();
        return (selection?.isCollapsed === false &&
            (target.contains(selection.anchorNode) || target.contains(selection.focusNode)));
    };
    let hadSelection = hasSelection();
    const onSelectionChange = () => {
        const selected = hasSelection();
        if (selected || hadSelection) {
            selectionCount += 1;
        }
        hadSelection = selected;
    };
    const forwardedTo = createForwardedClickDetector();
    const settle = (current) => {
        if (current.settled) {
            return;
        }
        current.settled = true;
        // No native gesture selects with four clicks, so text a rage burst selects is incidental.
        const selected = current.clicks <= MAX_NATIVE_CLICKS && (selectionCount !== current.selections || selectedTextIn(current.target));
        const answered = current.forwards.some(forward => !forward.defaultPrevented);
        if (window.location.href !== current.url || mutationCount !== current.mutations || selected || answered) {
            return;
        }
        // Focus on an input is an effect, not a dead click
        if (document.activeElement === current.target && FIELD_TAGS.includes(current.target.tagName)) {
            return;
        }
        track(eventDeadClick, {
            element: current.target.tagName,
            text: getSafeElementText(current.target, MAX_TEXT_LENGTH),
            x: current.x,
            y: current.y,
        });
    };
    const onClick = (event) => {
        const control = forwardedTo(event);
        if (control) {
            // A field answers its label click by toggling or taking focus; a <button> only by what it does.
            if (gesture && FIELD_TAGS.includes(control.tagName)) {
                gesture.forwards.push(event);
            }
            return;
        }
        const target = event.target;
        if (!isElement(target) || target === document.body || target === document.documentElement) {
            return;
        }
        // A double or triple click is one gesture, even if its first click replaced the element under the
        // pointer: its later clicks extend the wait instead of being judged on their own.
        if (!gesture || event.detail <= 1) {
            gesture = {
                target,
                x: event.clientX,
                y: event.clientY,
                url: window.location.href,
                mutations: mutationCount,
                selections: selectionCount,
                clicks: 0,
                forwards: [],
                settled: false,
            };
        }
        const current = gesture;
        const click = ++current.clicks;
        const timer = setTimeout(() => {
            pendingTimers.delete(timer);
            if (current.clicks === click) {
                settle(current);
            }
        }, 500);
        pendingTimers.add(timer);
    };
    window.addEventListener('click', onClick, true);
    document.addEventListener('selectionchange', onSelectionChange);
    return () => {
        window.removeEventListener('click', onClick, true);
        document.removeEventListener('selectionchange', onSelectionChange);
        observer.disconnect();
        for (const timer of pendingTimers) {
            clearTimeout(timer);
        }
        pendingTimers.clear();
    };
};
