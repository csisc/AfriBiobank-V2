/* In-memory registry of files the user opened locally in this browser tab. Nothing is uploaded anywhere. */
export const localImages = new Map();   // id -> { img, meta:{...}, name }
