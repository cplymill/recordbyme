import type { AudioRegion } from "../types";

export const isNarration = (region: AudioRegion) =>
	region.isVoiceOver === true || /[/\\]Narration-[\da-f-]+\.(?:webm|wav)$/i.test(region.audioPath);

export const isMicrophone = (region: AudioRegion) =>
	region.isMicrophone === true || /(?:[/\\]Microphone-[\da-f-]+\.wav$|\.mic\.[^/\\]+$)/i.test(region.audioPath);

export const isSpeechSource = (region: AudioRegion) => isNarration(region) || isMicrophone(region);
