import { getSafeElementText, isElement } from '../utils.js';
const eventClick = 'click';
const MAX_TEXT_LENGTH = 50;
export const setupClickTracking = (track) => {
    const onClick = (event) => {
        const target = event.target;
        if (!isElement(target)) {
            return;
        }
        track(eventClick, {
            class: target.getAttribute('class') ?? '',
            id: target.id,
            tag: target.tagName,
            // Own text only; structural fields still send so the click keeps counting.
            text: getSafeElementText(target, MAX_TEXT_LENGTH),
            x: event.clientX,
            y: event.clientY,
        });
    };
    window.addEventListener('click', onClick, true);
    return () => window.removeEventListener('click', onClick, true);
};
