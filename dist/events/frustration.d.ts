import type { TrackFn } from '../track.js';
export declare const eventRageClick = "rage_click";
export declare const eventDeadClick = "dead_click";
export declare const setupRageClickTracking: (track: TrackFn) => () => void;
export declare const setupDeadClickTracking: (track: TrackFn) => () => void;
