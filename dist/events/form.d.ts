import type { TrackFn } from '../track.js';
export declare const eventFormStart = "form_start";
export declare const eventFormSubmit = "form_submit";
export declare const setupFormTracking: (track: TrackFn) => () => void;
