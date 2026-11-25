import { scrubUrl } from '../utils.js';
const eventFormStart = 'form_start';
const eventFormSubmit = 'form_submit';
export const setupFormTracking = (track) => {
    const formsSeen = new WeakSet();
    // Like `action` below, none of these reads is necessarily a string despite the DOM types:
    // HTMLFormElement is [LegacyOverrideBuiltIns], so a control named "id" or "name" — routine markup
    // on signup, contact and CRUD forms — shadows the IDL attribute with the element itself. Shipped
    // unguarded, the element serialized as "{}" (or was dropped with a warning on every
    // form_start/submit when a framework's own enumerable props made JSON.stringify throw), and its
    // truthiness defeated the '(anonymous)' fallback. A non-string reads as absent.
    const formIdentity = (form) => {
        const id = form.id;
        const name = form.name;
        return {
            formId: typeof id === 'string' && id !== '' ? id : '(anonymous)',
            formName: typeof name === 'string' ? name : '',
        };
    };
    // form_start fires on first input, not focus — avoids false positives from tab navigation
    const onInput = (event) => {
        if (!event.target) {
            return;
        }
        const form = event.target.form;
        if (form && !formsSeen.has(form)) {
            formsSeen.add(form);
            track(eventFormStart, formIdentity(form));
        }
    };
    const onSubmit = (event) => {
        if (!event.target) {
            return;
        }
        const form = event.target;
        // '' rather than the shadowing element — serialized, it reads as data.
        const action = form.action;
        track(eventFormSubmit, {
            action: typeof action === 'string' ? scrubUrl(action) : '',
            ...formIdentity(form),
        });
    };
    window.addEventListener('input', onInput, true);
    window.addEventListener('submit', onSubmit, true);
    return () => {
        window.removeEventListener('input', onInput, true);
        window.removeEventListener('submit', onSubmit, true);
    };
};
