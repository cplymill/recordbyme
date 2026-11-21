import { describe, expect, it } from "vitest";
import type { AudioRegion } from "../types";
import { detectSpeech, duckGain, timelineSpeech, scheduleDuckGain } from "./ducking";

describe("lower audio during voice-over", () => {
	const region: AudioRegion = { id: "voice", audioPath: "/Narration-ab.wav", startMs: 1000, endMs: 3500, volume: 1, sourceOffsetMs: 200 };
	const samples = new Float32Array(3000);
	samples.fill(0.2, 300, 500);
	samples.fill(0.2, 800, 1000);
	samples.fill(0.2, 2200, 2400);
	const detected = detectSpeech({ numberOfChannels: 1, length: samples.length, sampleRate: 1000, getChannelData: () => samples } as AudioBuffer);
	const sources = new Map([[region.audioPath, detected]]);
	const spans = timelineSpeech([region], sources);
	it("holds through breaths, releases in longer pauses and respects trims, moves and mute", () => {
		expect(spans).toEqual([{start:1100,end:1800},{start:3000,end:3200}]);
		expect(duckGain(1430, spans, 0.65)).toBeCloseTo(0.35);
		expect(duckGain(1930, spans, 0.65)).toBeCloseTo(0.675);
		expect(duckGain(2300, spans, 0.65)).toBe(1);
		expect(timelineSpeech([{...region,startMs:2000,endMs:2500}], sources)).toEqual([{start:2100,end:2300}]);
		expect(timelineSpeech([{...region,volume:0}],sources)).toEqual([]);
	});
	it("uses the preview envelope for export, including chunks starting and ending mid-fade", () => {
		const points: [number, number][] = [];
		const save = (v:number,t:number) => points.push([t,v]);
		const param = {setValueAtTime:save,linearRampToValueAtTime:save} as unknown as AudioParam;
		scheduleDuckGain(param,spans,0.65,0.8,1040,0,0.9);
		for (let i=1;i<points.length;i++) {
			const [t0,v0]=points[i-1], [t1,v1]=points[i];
			expect((v0+v1)/2).toBeCloseTo(0.8*duckGain(1040+500*(t0+t1),spans,0.65));
		}
	});
});
