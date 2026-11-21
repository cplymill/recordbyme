import type { AudioRegion } from "../types";

export const isNarration = (region: AudioRegion) =>
	/[/\\]Narration-[\da-f-]+\.(?:webm|wav)$/i.test(region.audioPath);
