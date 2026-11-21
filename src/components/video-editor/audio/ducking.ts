import type { AudioRegion } from "../types";
import { isSpeechSource } from "./narrationRegion";

export interface SpeechSpan {
	start: number;
	end: number;
}

const attackMs = 90;
const releaseMs = 260;
const pauseMs = 450;

export function detectSpeech(buffer: AudioBuffer): SpeechSpan[] {
	const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
	const frame = Math.max(1, Math.round(buffer.sampleRate * 0.02));
	const spans: SpeechSpan[] = [];
	for (let offset = 0; offset < buffer.length; offset += frame) {
		const end = Math.min(offset + frame, buffer.length);
		const audible = channels.some(channel => {
			let power = 0;
			for (let i = offset; i < end; i++) power += channel[i] * channel[i];
			return power / (end - offset) >= 0.0001;
		});
		if (!audible) continue;
		const start = offset * 1000 / buffer.sampleRate;
		const finish = end * 1000 / buffer.sampleRate;
		const previous = spans[spans.length - 1];
		if (previous && previous.end >= start - 0.01) previous.end = finish;
		else spans.push({ start, end: finish });
	}
	return spans;
}

export function timelineSpeech(regions: AudioRegion[], sources: ReadonlyMap<string, SpeechSpan[]>): SpeechSpan[] {
	const spans: SpeechSpan[] = [];
	for (const region of regions) {
		if (!isSpeechSource(region) || region.volume <= 0) continue;
		const origin = region.startMs - (region.sourceOffsetMs ?? 0);
		for (const span of sources.get(region.audioPath) ?? []) {
			const start = Math.max(region.startMs, origin + span.start);
			const end = Math.min(region.endMs, origin + span.end);
			if (end > start) spans.push({ start, end });
		}
	}
	const merged: SpeechSpan[] = [];
	for (const span of spans.sort((a, b) => a.start - b.start)) {
		const last = merged[merged.length - 1];
		if (last && span.start - last.end <= pauseMs) last.end = Math.max(last.end, span.end);
		else merged.push(span);
	}
	return merged;
}

export function duckGain(ms: number, spans: SpeechSpan[], amount = 0) {
	if (!amount) return 1;
	let lo = 0, hi = spans.length;
	while (lo < hi) {
		const mid = (lo + hi) >>> 1;
		if (spans[mid].end + releaseMs <= ms) lo = mid + 1;
		else hi = mid;
	}
	const span = spans[lo];
	if (!span) return 1;
	const depth = Math.max(0, Math.min(1, (ms - span.start + attackMs) / attackMs, (span.end + releaseMs - ms) / releaseMs));
	return 1 - depth * amount;
}

export function scheduleDuckGain(param: AudioParam, spans: SpeechSpan[], amount: number, base: number, chunkMs: number, begin: number, end: number) {
	const at = (ms: number) => base * duckGain(ms, spans, amount);
	param.setValueAtTime(at(chunkMs + begin * 1000), begin);
	for (const span of spans) {
		if (span.end + releaseMs <= chunkMs + begin * 1000) continue;
		if (span.start - attackMs >= chunkMs + end * 1000) break;
		for (const ms of [span.start - attackMs, span.start, span.end, span.end + releaseMs]) {
			const t = (ms - chunkMs) / 1000;
			if (t > begin && t < end) param.linearRampToValueAtTime(at(ms), t);
		}
	}
	param.linearRampToValueAtTime(at(chunkMs + end * 1000), end);
}
