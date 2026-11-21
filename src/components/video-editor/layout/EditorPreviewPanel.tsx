import { JoinClips } from "./JoinClips";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { getLocalFilePathFromResource } from "@/lib/exporter/mediaResource";
import { NarrationControls, type NarrationAction } from "../audio/NarrationControls";
import type { useAudioRegionCommands } from "../hooks/useAudioRegionCommands";
import {
	CaretDown,
	Check,
	Crop,
	MagicWand,
	MagnifyingGlassPlus,
	Pause,
	Play,
	Plus,
	Scissors,
	SkipBack,
	SkipForward,
	SpeakerHigh,
	SpeakerLow,
	SpeakerX,
} from "@phosphor-icons/react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
	DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import type { useI18n } from "@/contexts/I18nContext";
import { ASPECT_RATIOS, type AspectRatio, getAspectRatioLabel } from "@/utils/aspectRatioUtils";
import type { useVideoEditorAudio } from "../audio/useVideoEditorAudio";
import type { CaptionEditTarget } from "../captionEditing";
import type { useAnnotationRegionCommands } from "../hooks/useAnnotationRegionCommands";
import type { useEditorPlaybackControls } from "../hooks/useEditorPlaybackControls";
import type { useTimelineProjection } from "../hooks/useTimelineProjection";
import type { useZoomRegionCommands } from "../hooks/useZoomRegionCommands";
import type { useAppearanceState } from "../state/useAppearanceState";
import type { useTimelineState } from "../state/useTimelineState";
import type { TimelineEditorHandle } from "../timeline/TimelineEditor";
import type { VideoPlaybackRef } from "../VideoPlayback";
import { EditorVideoPreview } from "./EditorVideoPreview";

type Props = {
	audioCommands: ReturnType<typeof useAudioRegionCommands>;
	t: ReturnType<typeof useI18n>["t"];
	videoPath: string | null;
	previewVersion: number;
	aspectRatio: AspectRatio;
	setAspectRatio: Dispatch<SetStateAction<AspectRatio>>;
	previewAspectRatioValue: number;
	videoPlaybackRef: RefObject<VideoPlaybackRef>;
	timelineRef: RefObject<TimelineEditorHandle>;
	currentTime: number;
	isPlaying: boolean;
	previewVolume: number;
	setPreviewVolume: Dispatch<SetStateAction<number>>;
	suspendRendering: boolean;
	appearance: ReturnType<typeof useAppearanceState>;
	timeline: ReturnType<typeof useTimelineState>;
	audio: ReturnType<typeof useVideoEditorAudio>;
	projection: ReturnType<typeof useTimelineProjection>;
	playback: ReturnType<typeof useEditorPlaybackControls>;
	zoomCommands: ReturnType<typeof useZoomRegionCommands>;
	annotationCommands: ReturnType<typeof useAnnotationRegionCommands>;
	effectiveCursorTelemetry: ReturnType<typeof useTimelineState>["cursorTelemetry"];
	effectiveShowCursor: boolean;
	isCropped: boolean;
	handleOpenCropEditor: () => void;
	handleSaveAutoCaptionEdit: (target: CaptionEditTarget, text: string) => void;
	handleSelectAnnotation: (id: string | null) => void;
	setDuration: Dispatch<SetStateAction<number>>;
	setIsPreviewReady: Dispatch<SetStateAction<boolean>>;
	setCurrentTime: Dispatch<SetStateAction<number>>;
	setIsPlaying: Dispatch<SetStateAction<boolean>>;
	setError: Dispatch<SetStateAction<string | null>>;
};

function formatTime(seconds: number) {
	if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
	const mins = Math.floor(seconds / 60);
	const secs = Math.floor(seconds % 60);
	return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function EditorPreviewPanel(props: Props) {
	const {
		audioCommands,
		t,
		videoPath,
		previewVersion,
		aspectRatio,
		setAspectRatio,
		previewAspectRatioValue,
		videoPlaybackRef,
		timelineRef,
		currentTime,
		isPlaying,
		previewVolume,
		setPreviewVolume,
		suspendRendering,
		appearance,
		timeline,
		audio,
		projection,
		playback,
		zoomCommands,
		annotationCommands,
		effectiveCursorTelemetry,
		effectiveShowCursor,
		isCropped,
		handleOpenCropEditor,
		handleSaveAutoCaptionEdit,
		handleSelectAnnotation,
		setDuration,
		setIsPreviewReady,
		setCurrentTime,
		setIsPlaying,
		setError,
	} = props;

	const narration = useRef<NarrationAction>(null);
	const [phase, setPhase] = useState("idle");
	const [detaching, setDetaching] = useState(false);
	const clip = timeline.clipRegions.find(c => c.id === timeline.selectedClipId)
		?? timeline.clipRegions.find(c => c.id === audio.activeClipIdAtCurrentTime);
	const latest = useRef({ videoPath, clips: timeline.clipRegions, regions: timeline.audioRegions });
	latest.current = { videoPath, clips: timeline.clipRegions, regions: timeline.audioRegions };
	const selectedAudio = timeline.audioRegions.find(r => r.id === timeline.selectedAudioId);
	const at = Math.round(projection.timelinePlayheadTime * 1000);
	const insideAudio = !!selectedAudio && at > selectedAudio.startMs && at < selectedAudio.endMs;
	const toggle = () => narration.current?.toggle();
	const canRecord = !!videoPath && (phase === "idle" || phase === "recording");
	const recordLabel = phase === "recording" ? "Stop voice-over" : "Record voice-over";
	async function detach() {
		if (!videoPath || !clip || clip.muted || detaching) return;
		const snapshot = latest.current;
		setDetaching(true);
		try {
			const path = getLocalFilePathFromResource(videoPath) ?? videoPath;
			const tracks = await window.electronAPI.detachRecordingAudio(path, clip.startMs, clip.endMs, clip.speed);
			if (latest.current.videoPath !== snapshot.videoPath || latest.current.clips !== snapshot.clips) {
				toast.info("The video clip changed. Select it again to detach its audio.");
				return;
			}
			let lane = 1 + latest.current.regions.reduce((max, r) => Math.max(max, r.trackIndex ?? 0), -1);
			const settings = audio.getSourceAudioTrackSettingsForClip(clip.id);
			for (const track of tracks) {
				audioCommands.handleAudioAdded({ start: track.startMs, end: track.endMs }, track.path, lane++, settings[track.kind], track.kind === "mic");
			}
			timeline.setClipRegions(items => items.map(c => c.id === clip.id ? { ...c, muted: true, showSourceAudio: false } : c));
		} catch (error) {
			toast.error(String(error));
		} finally { setDetaching(false); }
	}
	return (
		<div className="flex min-h-0 flex-1 flex-col gap-3">
			<div className="flex min-h-0 flex-1 flex-col">
				<div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
					<div className="flex flex-shrink-0 flex-wrap items-center justify-center gap-2 py-1.5">
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button
									variant="ghost"
									size="sm"
									className="h-7 gap-1 px-2 text-xs text-muted-foreground transition-all hover:bg-foreground/10 hover:text-foreground"
								>
									<span className="font-medium">
										{getAspectRatioLabel(aspectRatio)}
									</span>
									<CaretDown className="h-3 w-3" />
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent
								align="center"
								className="border-foreground/10 bg-editor-surface-alt"
							>
								{ASPECT_RATIOS.map((ratio) => (
									<DropdownMenuItem
										key={ratio}
										onClick={() => setAspectRatio(ratio)}
										className="flex cursor-pointer items-center justify-between gap-3 text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
									>
										<span>{getAspectRatioLabel(ratio)}</span>
										{aspectRatio === ratio ? (
											<Check className="h-3 w-3 text-[#2563EB]" />
										) : null}
									</DropdownMenuItem>
								))}
							</DropdownMenuContent>
						</DropdownMenu>
						<div className="h-4 w-px bg-foreground/20" />
						<Button
							variant="ghost"
							size="sm"
							onClick={handleOpenCropEditor}
							className="h-7 gap-1.5 px-2 text-xs text-muted-foreground transition-all hover:bg-foreground/10 hover:text-foreground"
						>
							<Crop className="h-3.5 w-3.5" />
							<span className="font-medium">{t("settings.crop.title")}</span>
							{isCropped ? (
								<span className="h-1.5 w-1.5 rounded-full bg-[#2563EB]" />
							) : null}
						</Button>
						{videoPath && (
							<NarrationControls
								key={videoPath}
								actionRef={narration} onPhaseChange={setPhase}
								position={projection.timelinePlayheadTime}
								duration={projection.timelineDuration}
								regions={timeline.audioRegions}
								selectedId={timeline.selectedAudioId}
								seek={playback.handleTimelineSeek}
								play={playback.startPlayback}
								add={audioCommands.handleAudioAdded}
								replace={(id, path, endMs) =>
									timeline.setAudioRegions((items) =>
										items.map((item) =>
											item.id === id
												? { ...item, audioPath: path, endMs, sourceOffsetMs: 0, sourceDurationMs: endMs - item.startMs }
												: item,
										),
									)
								}
							/>
						)}
					</div>
					<div
						className="flex min-h-0 w-full flex-1 items-stretch"
						style={{ flex: "1 1 auto", margin: "6px 0 0" }}
					>
						<div className="flex min-w-0 flex-1 items-center justify-center px-1">
							<div
								className="relative"
								style={{
									width: "auto",
									height: "100%",
									aspectRatio: previewAspectRatioValue,
									maxWidth: "100%",
									margin: "0 auto",
									boxSizing: "border-box",
								}}
							>
								<EditorVideoPreview
									videoPath={videoPath}
									previewVersion={previewVersion}
									aspectRatio={aspectRatio}
									playbackRef={videoPlaybackRef}
									currentTime={currentTime}
									isPlaying={isPlaying}
									previewVolume={previewVolume}
									suspendRendering={suspendRendering}
									appearance={appearance}
									timeline={timeline}
									audio={audio}
									effectiveZoomRegions={projection.effectiveZoomRegions}
									effectiveSpeedRegions={projection.effectiveSpeedRegions}
									effectiveCursorTelemetry={effectiveCursorTelemetry}
									effectiveShowCursor={effectiveShowCursor}
									setDuration={setDuration}
									setIsPreviewReady={setIsPreviewReady}
									setCurrentTime={setCurrentTime}
									setIsPlaying={setIsPlaying}
									setError={setError}
									handlers={{
										onSelectZoom: zoomCommands.handleSelectZoom,
										onZoomFocusChange: zoomCommands.handleZoomFocusChange,
										onEditAutoCaption: handleSaveAutoCaptionEdit,
										onSelectAnnotation: handleSelectAnnotation,
										onAnnotationPositionChange:
											annotationCommands.handleAnnotationPositionChange,
										onAnnotationSizeChange:
											annotationCommands.handleAnnotationSizeChange,
									}}
								/>
							</div>
						</div>
					</div>
				</div>
			</div>

			<div className="relative flex flex-shrink-0 items-center px-1 py-1">
				<div className="z-10 flex min-w-0 flex-1 items-center gap-1.5">
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button
								variant="ghost"
								size="sm"
								className="h-7 gap-1 rounded-full border border-foreground/[0.08] bg-foreground/[0.04] px-2.5 text-[11px] text-foreground/65 shadow-[inset_0_1px_0_hsl(var(--foreground)/0.06)] transition-all hover:bg-foreground/[0.08] hover:text-foreground"
							>
								<Plus className="h-3.5 w-3.5" />
								<span className="font-medium">{t("editor.toolbar.addLayer")}</span>
								<CaretDown className="h-3 w-3" />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent
							align="start"
							className="border-foreground/10 bg-editor-surface-alt"
						>
							<DropdownMenuItem
								onClick={() => {
									const nextTrack =
										timeline.annotationRegions.length > 0
											? Math.max(
													...timeline.annotationRegions.map(
														(region) => region.trackIndex ?? 0,
													),
												) + 1
											: 0;
									timelineRef.current?.addAnnotation(nextTrack);
								}}
								className="cursor-pointer text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
							>
								{t("timeline.annotation.label")}
							</DropdownMenuItem>
							<DropdownMenuSub>
								<DropdownMenuSubTrigger>{t("timeline.audio.label")}</DropdownMenuSubTrigger>
								<DropdownMenuSubContent>
									<DropdownMenuItem disabled={!canRecord} onSelect={toggle}>{recordLabel}</DropdownMenuItem>
									{selectedAudio && <>
										<DropdownMenuItem disabled={!insideAudio} onSelect={() =>
											audioCommands.handleAudioSpanChange(selectedAudio.id, { start: at, end: selectedAudio.endMs })}>Trim audio start to playhead</DropdownMenuItem>
										<DropdownMenuItem disabled={!insideAudio} onSelect={() =>
											audioCommands.handleAudioSpanChange(selectedAudio.id, { start: selectedAudio.startMs, end: at })}>Trim audio end to playhead</DropdownMenuItem>
									</>}
									<DropdownMenuItem disabled={!clip || clip.muted || detaching} onSelect={detach}>
										{detaching ? "Detaching audio..." : "Detach recording audio"}
									</DropdownMenuItem>
							<DropdownMenuItem
								onClick={() => {
									const nextTrack =
										timeline.audioRegions.length > 0
											? Math.max(
													...timeline.audioRegions.map(
														(region) => region.trackIndex ?? 0,
													),
												) + 1
											: 0;
									timelineRef.current?.addAudio(nextTrack);
								}}
								className="cursor-pointer text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
							>
								Import audio file...
							</DropdownMenuItem>
							</DropdownMenuSubContent></DropdownMenuSub>
						</DropdownMenuContent>
					</DropdownMenu>
					<Button variant="ghost" size="sm" disabled={!canRecord} onClick={toggle}
						className="h-7 gap-1 rounded-full px-2 text-xs" aria-pressed={phase === "recording"}>
						<span aria-hidden="true" className={phase === "recording" ? "size-2 bg-red-500" : "size-2 rounded-full bg-red-500"} />
						{recordLabel}
					</Button>
					<div className="mx-1 h-4 w-px bg-foreground/10" />
					<Button
						onClick={() => timelineRef.current?.addZoom()}
						variant="ghost"
						size="icon"
						className="h-7 w-7 rounded-full text-muted-foreground transition-all hover:bg-[#2563EB]/10 hover:text-[#2563EB]"
						title={t("timeline.zoom.addZoom")}
					>
						<MagnifyingGlassPlus className="h-4 w-4" />
					</Button>
					<Button
						onClick={() => timelineRef.current?.suggestZooms()}
						variant="ghost"
						size="icon"
						className="h-7 w-7 rounded-full text-muted-foreground transition-all hover:bg-[#2563EB]/10 hover:text-[#2563EB]"
						title={t("timeline.zoom.suggestZooms")}
					>
						<MagicWand className="h-4 w-4" />
					</Button>
					<Button
						onClick={() => timelineRef.current?.splitClip()}
						variant="ghost"
						size="icon"
						className="h-7 w-7 rounded-full text-muted-foreground transition-all hover:bg-foreground/10 hover:text-foreground"
						title={timeline.selectedAudioId ? "Split selected audio at playhead (C)" : t("editor.toolbar.splitClip")}
					>
						<Scissors className="h-4 w-4" />
					</Button>
					{videoPath && <JoinClips key={videoPath} timeline={timeline} settingsForClip={audio.getSourceAudioTrackSettingsForClip} />}
				</div>

				<div className="z-10 flex shrink-0 items-center justify-center">
					<div className="pointer-events-auto flex items-center gap-1.5">
						<span className="mr-1 text-[10px] font-medium tabular-nums text-muted-foreground">
							{formatTime(projection.timelinePlayheadTime)}
						</span>
						<Button
							variant="ghost"
							size="icon"
							className="h-7 w-7 rounded-full text-muted-foreground transition-all hover:bg-foreground/10 hover:text-foreground"
							title={t("editor.playback.skipBack")}
							onClick={playback.handlePreviewSkipBack}
						>
							<SkipBack className="h-3.5 w-3.5" weight="fill" />
						</Button>
						<Button
							variant="ghost"
							size="icon"
							className={`h-7 w-7 rounded-full border border-foreground/10 shadow-[0_8px_18px_rgba(0,0,0,0.18)] transition-all ${isPlaying ? "bg-foreground/10 text-foreground hover:bg-foreground/20" : "bg-neutral-800 text-white hover:bg-neutral-700 dark:bg-white dark:text-black dark:hover:bg-white/90"}`}
							onClick={playback.togglePlayPause}
							title={isPlaying ? "Pause" : "Play"}
						>
							{isPlaying ? (
								<Pause className="h-3.5 w-3.5" weight="fill" />
							) : (
								<Play className="h-3.5 w-3.5" weight="fill" />
							)}
						</Button>
						<Button
							variant="ghost"
							size="icon"
							className="h-7 w-7 rounded-full text-muted-foreground transition-all hover:bg-foreground/10 hover:text-foreground"
							title={t("editor.playback.skipForward")}
							onClick={playback.handlePreviewSkipForward}
						>
							<SkipForward className="h-3.5 w-3.5" weight="fill" />
						</Button>
						<span className="ml-1 text-[10px] font-medium tabular-nums text-muted-foreground/70">
							{formatTime(projection.timelineDuration)}
						</span>
					</div>
				</div>

				<div className="z-10 ml-auto flex flex-1 items-center justify-end gap-2">
					<div className="flex items-center gap-1.5">
						<button
							type="button"
							className="text-muted-foreground transition-colors hover:text-foreground"
							title={t("editor.playback.muteUnmute")}
							onClick={() => setPreviewVolume(previewVolume <= 0.001 ? 1 : 0)}
						>
							{previewVolume <= 0.001 ? (
								<SpeakerX className="h-3.5 w-3.5" />
							) : previewVolume < 0.5 ? (
								<SpeakerLow className="h-3.5 w-3.5" />
							) : (
								<SpeakerHigh className="h-3.5 w-3.5" />
							)}
						</button>
						<div className="relative flex h-7 w-24 select-none items-center overflow-hidden rounded-full border border-foreground/[0.06] bg-editor-bg/80 shadow-[inset_0_1px_0_hsl(var(--foreground)/0.06)]">
							<div
								className="absolute inset-y-[3px] left-[3px] right-auto rounded-[10px] bg-foreground/[0.08]"
								style={{
									width:
										previewVolume > 0
											? `max(calc(${previewVolume * 100}% - 6px), 1.2rem)`
											: 0,
								}}
							/>
							<div
								className="pointer-events-none absolute bottom-[18%] top-[18%] z-10 w-0.5 rounded-full bg-foreground/95 shadow-[0_0_10px_rgba(37,99,235,0.28)]"
								style={{ left: `calc(${previewVolume * 100}% - 8px)` }}
							/>
							<span className="pointer-events-none relative z-10 pl-2 text-[10px] font-medium text-muted-foreground">
								{Math.round(previewVolume * 100)}%
							</span>
							<input
								type="range"
								aria-label={t("editor.playback.volume", "Preview volume")}
								min="0"
								max="1"
								step="0.01"
								value={previewVolume}
								onChange={(event) => setPreviewVolume(Number(event.target.value))}
								className="absolute inset-0 h-full w-full cursor-ew-resize opacity-0"
							/>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
