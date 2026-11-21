import { toast } from "sonner";
import type { Span } from "dnd-timeline";
import { type Dispatch, type MutableRefObject, type SetStateAction, useCallback } from "react";
import type { AudioRegion, EditorEffectSection } from "../types";

interface UseAudioRegionCommandsParams {
	setAudioRegions: Dispatch<SetStateAction<AudioRegion[]>>;
	selectedAudioId: string | null;
	setSelectedAudioId: Dispatch<SetStateAction<string | null>>;
	setSelectedClipId: Dispatch<SetStateAction<string | null>>;
	setSelectedZoomId: Dispatch<SetStateAction<string | null>>;
	setSelectedAnnotationId: Dispatch<SetStateAction<string | null>>;
	setSelectedCaptionId: Dispatch<SetStateAction<string | null>>;
	setActiveEffectSection: Dispatch<SetStateAction<EditorEffectSection>>;
	nextAudioIdRef: MutableRefObject<number>;
}

export function useAudioRegionCommands({
	setAudioRegions,
	selectedAudioId,
	setSelectedAudioId,
	setSelectedClipId,
	setSelectedZoomId,
	setSelectedAnnotationId,
	setSelectedCaptionId,
	setActiveEffectSection,
	nextAudioIdRef,
}: UseAudioRegionCommandsParams) {
	const handleSelectAudio = useCallback(
		(id: string | null) => {
			setSelectedAudioId(id);
			if (id) {
				setSelectedClipId(null);
				setSelectedZoomId(null);
				setSelectedAnnotationId(null);
				setSelectedCaptionId(null);
				setActiveEffectSection("audio");
			}
		},
		[
			setActiveEffectSection,
			setSelectedClipId,
			setSelectedAnnotationId,
			setSelectedAudioId,
			setSelectedCaptionId,
			setSelectedZoomId,
		],
	);

	const handleAudioAdded = useCallback(
		(span: Span, audioPath: string, trackIndex?: number, settings?: { volume: number; normalize: boolean }) => {
			const id = `audio-${nextAudioIdRef.current++}`;
			const newRegion: AudioRegion = {
				id,
				startMs: Math.round(span.start),
				endMs: Math.round(span.end),
				audioPath,
				volume: settings?.volume ?? 1,
				normalize: settings?.normalize ?? false,
				trackIndex,
			};
			setAudioRegions((current) => [...current, newRegion]);
			setSelectedAudioId(id);
			setSelectedClipId(null);
			setSelectedZoomId(null);
			setSelectedAnnotationId(null);
			setSelectedCaptionId(null);
			setActiveEffectSection("audio");
		},
		[
			nextAudioIdRef,
			setSelectedClipId,
			setActiveEffectSection,
			setAudioRegions,
			setSelectedAnnotationId,
			setSelectedAudioId,
			setSelectedCaptionId,
			setSelectedZoomId,
		],
	);

	const handleAudioSpanChange = useCallback(
		(id: string, span: Span, trackIndex?: number) => {
			const normalizedTrackIndex =
				typeof trackIndex === "number" && Number.isFinite(trackIndex)
					? Math.max(0, Math.floor(trackIndex))
					: undefined;
			setAudioRegions((current) =>
				current.map((region) => {
					if (region.id !== id) return region;
					const offset = region.sourceOffsetMs ?? 0;
					const limit = region.sourceDurationMs ?? offset + region.endMs - region.startMs;
					let startMs = Math.round(span.start);
					let endMs = Math.round(span.end);
					let sourceOffsetMs = offset;
					if (endMs === region.endMs && startMs !== region.startMs) {
						startMs = Math.max(startMs, region.startMs - offset);
						sourceOffsetMs += startMs - region.startMs;
					}
					endMs = Math.min(endMs, startMs + limit - sourceOffsetMs);
					if (endMs <= startMs) return region;
					return { ...region, startMs, endMs, sourceOffsetMs, sourceDurationMs: limit,
						trackIndex: normalizedTrackIndex ?? region.trackIndex };
				}),
			);
		},
		[setAudioRegions],
	);

	const handleAudioVolumeChange = useCallback(
		(volume: number) => {
			if (!selectedAudioId || !Number.isFinite(volume)) return;
			const nextVolume = Math.max(0, Math.min(1, volume));
			setAudioRegions((current) =>
				current.map((region) =>
					region.id === selectedAudioId ? { ...region, volume: nextVolume } : region,
				),
			);
		},
		[selectedAudioId, setAudioRegions],
	);

	const handleAudioSplit = (positionMs: number, regions: AudioRegion[]) => {
		const region = regions.find(r => r.id === selectedAudioId);
		const at = Math.round(positionMs);
		if (!region || at <= region.startMs || at >= region.endMs) {
			toast.info("Place the playhead inside the selected audio clip.");
			return;
		}
		const offset = region.sourceOffsetMs ?? 0;
		const sourceDurationMs = region.sourceDurationMs ?? offset + region.endMs - region.startMs;
		const id = `audio-${nextAudioIdRef.current++}`;
		setAudioRegions(items => items.flatMap(r => r.id !== region.id ? [r] : [
			{ ...r, endMs: at, sourceDurationMs },
			{ ...r, id, startMs: at, sourceOffsetMs: offset + at - r.startMs, sourceDurationMs },
		]));
		handleSelectAudio(id);
	};

	const handleAudioDelete = useCallback(
		(id: string) => {
			setAudioRegions((current) => current.filter((region) => region.id !== id));
			if (selectedAudioId === id) setSelectedAudioId(null);
		},
		[selectedAudioId, setAudioRegions, setSelectedAudioId],
	);

	const handleAudioNormalizeChange = useCallback(
		(normalize: boolean) => {
			if (!selectedAudioId) return;
			setAudioRegions((current) =>
				current.map((region) =>
					region.id === selectedAudioId ? { ...region, normalize } : region,
				),
			);
		},
		[selectedAudioId, setAudioRegions],
	);

	return {
		handleSelectAudio,
		handleAudioAdded,
		handleAudioSplit,
		handleAudioSpanChange,
		handleAudioVolumeChange,
		handleAudioDelete,
		handleAudioNormalizeChange,
	};
}
