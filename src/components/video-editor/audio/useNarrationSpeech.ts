import { useEffect, useMemo, useState } from "react";
import { resolveMediaElementSource } from "@/lib/exporter/localMediaSource";
import type { AudioRegion } from "../types";
import { detectSpeech, timelineSpeech, type SpeechSpan } from "./ducking";
import { isSpeechSource } from "./narrationRegion";

export function useNarrationSpeech(regions: AudioRegion[]) {
	const paths = regions.some(r => r.duckingAmount)
		? [...new Set(regions.filter(isSpeechSource).map(r => r.audioPath))].sort() : [];
	const pathsKey = JSON.stringify(paths);
	const [sources, setSources] = useState(new Map<string, SpeechSpan[]>());
	useEffect(() => {
		let active = true;
		async function analyze() {
			const result = new Map<string, SpeechSpan[]>();
			for (const path of JSON.parse(pathsKey) as string[]) {
				if (!active) return;
				const source = await resolveMediaElementSource(path);
				try {
					const bytes = await (await fetch(source.src)).arrayBuffer();
					if (!active) return;
					const context = new OfflineAudioContext(1, 1, 48000);
					result.set(path, detectSpeech(await context.decodeAudioData(bytes)));
				} finally {
					source.revoke();
				}
			}
			if (active) setSources(result);
		}
		void analyze().catch(error => console.warn("Voice-over analysis failed", error));
		return () => { active = false; };
	}, [pathsKey]);
	return useMemo(() => timelineSpeech(regions, sources), [regions, sources]);
}
