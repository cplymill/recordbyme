import { isNarration, isMicrophone } from "../audio/narrationRegion";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SOURCE_AUDIO_NORMALIZE_GAIN, type SourceAudioTrackSettings } from "../audio/audioTypes";
import type { useTimelineState } from "../state/useTimelineState";
import type { AudioRegion, ClipRegion } from "../types";

function mergePair<T extends { id: string }>(items: T[], left: T, right: T, merged: T) {
	return items
		.filter((item) => item.id !== right.id)
		.map((item) => (item.id === left.id ? merged : item));
}

async function joinAudio(left: AudioRegion, right: AudioRegion): Promise<AudioRegion> {
	const leftLength = left.endMs - left.startMs;
	const length = leftLength + right.endMs - right.startMs;
	const endMs = left.startMs + length;
	const sameLevel = left.volume === right.volume && !!left.normalize === !!right.normalize;
	if (
		sameLevel &&
		left.audioPath === right.audioPath &&
		(left.sourceOffsetMs ?? 0) + leftLength === (right.sourceOffsetMs ?? 0)
	) {
		return {
			...left,
			endMs,
			sourceDurationMs: Math.max(
				left.sourceDurationMs ?? 0,
				right.sourceDurationMs ?? 0,
				(left.sourceOffsetMs ?? 0) + length,
			),
		};
	}
	const path = await window.electronAPI.joinAudio(
		[left, right].map((region) => ({
			path: region.audioPath,
			offset: region.sourceOffsetMs ?? 0,
			duration: region.endMs - region.startMs,
			gain: sameLevel
				? 1
				: Math.min(1, region.volume * (region.normalize ? SOURCE_AUDIO_NORMALIZE_GAIN : 1)),
		})),
	);
	return {
		...left,
		audioPath: path,
		isMicrophone: isMicrophone(left) && isMicrophone(right),
		isVoiceOver: isNarration(left) && isNarration(right),
		endMs,
		sourceOffsetMs: 0,
		sourceDurationMs: length,
		volume: sameLevel ? left.volume : 1,
		normalize: sameLevel && left.normalize,
	};
}

type Props = {
	timeline: ReturnType<typeof useTimelineState>;
	settingsForClip: (id: string) => SourceAudioTrackSettings;
};

export function JoinClips({ timeline, settingsForClip }: Props) {
	const [busy, setBusy] = useState(false);
	const latest = useRef<Props["timeline"] | null>(timeline);
	latest.current = timeline;
	useEffect(
		() => () => {
			latest.current = null;
		},
		[],
	);
	const audio = timeline.audioRegions.find((r) => r.id === timeline.selectedAudioId);
	const selected = audio ?? timeline.clipRegions.find((r) => r.id === timeline.selectedClipId);
	if (!selected) return null;
	const lane = audio
		? timeline.audioRegions.filter((r) => (r.trackIndex ?? 0) === (audio.trackIndex ?? 0))
		: timeline.clipRegions;
	const sorted = [...lane].sort((a, b) => a.startMs - b.startMs);
	const index = sorted.findIndex((r) => r.id === selected.id);
	const pairs = [
		{ left: sorted[index - 1], right: selected, label: "Join with previous" },
		{ left: selected, right: sorted[index + 1], label: "Join with next" },
	].filter(({ left, right }) => {
		if (!left || !right || left.endMs > right.startMs) return false;
		if ("audioPath" in left && "audioPath" in right) return (left.duckingAmount ?? 0) === (right.duckingAmount ?? 0);
		if ("audioPath" in left) return false;
		const next = right as ClipRegion;
		const a = settingsForClip(left.id),
			b = settingsForClip(right.id);
		return (
			left.endMs === right.startMs &&
			left.speed === 1 &&
			next.speed === 1 &&
			!!left.muted === !!next.muted &&
			!!left.showSourceAudio === !!next.showSourceAudio &&
			[...Object.keys(a), ...Object.keys(b)].every(
				(key) =>
					(a[key]?.volume ?? 1) === (b[key]?.volume ?? 1) &&
					!!a[key]?.normalize === !!b[key]?.normalize,
			)
		);
	});
	async function join({ left, right }: (typeof pairs)[number]) {
		if (busy) return;
		if ("audioPath" in left && "audioPath" in right) {
			setBusy(true);
			try {
				const merged = await joinAudio(left, right);
				if (latest.current?.audioRegions !== timeline.audioRegions) {
					toast.info("The audio changed during the join. Select the clips again.");
					return;
				}
				timeline.setAudioRegions((items) => mergePair(items, left, right, merged));
				timeline.setSelectedAudioId(left.id);
			} catch (error) {
				toast.error(String(error));
			} finally {
				setBusy(false);
			}
		} else if ("speed" in left && "speed" in right) {
			timeline.setClipRegions((items) =>
				mergePair(items, left, right, { ...left, endMs: right.endMs }),
			);
			timeline.setSelectedClipId(left.id);
		}
	}
	if (pairs.length < 2)
		return (
			<Button
				variant="ghost"
				size="sm"
				disabled={!pairs.length || busy}
				title={
					pairs[0]?.label ??
					(audio
						? "Select neighbouring audio clips on the same track"
						: "Join touching normal-speed clips with matching settings")
				}
				onClick={() => void join(pairs[0])}
			>
				{busy ? "Joining..." : "Join"}
			</Button>
		);
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="ghost" size="sm" disabled={busy}>
					{busy ? "Joining..." : "Join"}
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent>
				{pairs.map((pair) => (
					<DropdownMenuItem key={pair.label} onSelect={() => void join(pair)}>
						{pair.label}
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
