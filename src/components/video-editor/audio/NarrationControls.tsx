import { SlidersHorizontal } from "@phosphor-icons/react";
import {
	DropdownMenu,
	DropdownMenuTrigger,
	DropdownMenuContent,
	DropdownMenuCheckboxItem,
	DropdownMenuLabel,
	DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { fixWebmDuration } from "@fix-webm-duration/fix";
import { isNarration } from "./narrationRegion";
import { toast } from "sonner";
import type { AudioRegion } from "../types";

export type NarrationAction = { toggle: () => void };
type Props = {
	actionRef: Ref<NarrationAction>;
	onPhaseChange: (phase: string) => void;
	position: number;
	duration: number;
	regions: AudioRegion[];
	selectedId: string | null;
	seek: (seconds: number) => void;
	play: () => void;
	add: (span: { start: number; end: number }, path: string, track: number) => void;
	replace: (id: string, path: string, end: number) => void;
};
type Placement = { start: number; limit: number; track: number; replaceId?: string };
type Take = { placement: Placement; blob: Blob; length: number; url: string };

const cleanupOptions = [
	["noiseSuppression", "Reduce background noise"],
	["echoCancellation", "Reduce speaker echo"],
	["autoGainControl", "Even out voice volume"],
] as const;
const preference = "recordly.narration.micCleanup";
function readCleanup() {
	const saved = window.electronAPI.getAppSetting(preference);
	const values = (saved && typeof saved === "object" ? saved : {}) as Record<string, unknown>;
	return Object.fromEntries(
		cleanupOptions.map(([key]) => [
			key,
			typeof values[key] === "boolean" ? values[key] : key !== "autoGainControl",
		]),
	) as Record<(typeof cleanupOptions)[number][0], boolean>;
}

export function NarrationControls({
	actionRef, onPhaseChange, position,
	duration,
	regions,
	selectedId,
	seek,
	play,
	add,
	replace,
}: Props) {
	const [phase, setPhase] = useState<
		"idle" | "arming" | "recording" | "processing" | "review" | "saving"
	>("idle");
	const [take, setTake] = useState<Take | null>(null);
	const [cleanup, setCleanup] = useState(readCleanup);
	const [inputs, setInputs] = useState<MediaDeviceInfo[]>([]);
	const [device, setDevice] = useState(() => {
		const saved = window.electronAPI.getAppSetting("recordly.narration.micDevice");
		return typeof saved === "string" ? saved : "default";
	});
	const [activeMic, setActiveMic] = useState("");
	async function refreshInputs() {
		try {
			const devices = await navigator.mediaDevices.enumerateDevices();
			setInputs(devices.filter(d => d.kind === "audioinput" && d.deviceId && d.deviceId !== "default"));
		} catch { setInputs([]); }
	}
	const recorder = useRef<MediaRecorder | null>(null);
	const generation = useRef(0);
	const timer = useRef<number>();
	const selected = regions.find((r) => r.id === selectedId && isNarration(r));
	useEffect(
		() => () => {
			generation.current++;
			window.clearTimeout(timer.current);
			const active = recorder.current;
			if (active && active.state !== "inactive") active.stop();
			active?.stream.getTracks().forEach((t) => t.stop());
		},
		[],
	);
	useEffect(
		() => () => {
			if (take) URL.revokeObjectURL(take.url);
		},
		[take],
	);

	async function record(at: Placement) {
		const token = ++generation.current;
		const current = () => generation.current === token;
		setPhase("arming");
		seek(at.start / 1000);
		let stream: MediaStream | undefined;
		try {
			stream = await navigator.mediaDevices.getUserMedia({
				audio: { ...cleanup, ...(device === "default" ? {} : { deviceId: { exact: device } }) },
			});
			if (!current()) {
				stream.getTracks().forEach((t) => t.stop());
				return;
			}
			setActiveMic(stream.getAudioTracks()[0]?.label || "System default microphone");
			const active = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
			recorder.current = active;
			const chunks: Blob[] = [];
			active.ondataavailable = (e) => {
				if (e.data.size) chunks.push(e.data);
			};
			active.onerror = () => {
				window.clearTimeout(timer.current);
				active.stream.getTracks().forEach((t) => t.stop());
				if (current()) {
					generation.current++;
					seek(at.start / 1000);
					setPhase(take ? "review" : "idle");
					toast.error("Microphone recording failed");
				}
			};
			active.onstop = async () => {
				window.clearTimeout(timer.current);
				active.stream.getTracks().forEach((t) => t.stop());
				if (!current()) return;
				setPhase("processing");
				seek(at.start / 1000);
				const context = new AudioContext();
				try {
					const blob = new Blob(chunks, { type: active.mimeType });
					const decoded = await context.decodeAudioData(await blob.arrayBuffer());
					const length = Math.min(at.limit, Math.round(decoded.duration * 1000));
					if (!length) throw new Error("The microphone returned an empty take");
					const fixed = await fixWebmDuration(blob, decoded.duration * 1000);
					if (current()) {
						setTake({
							placement: at,
							length,
							blob: fixed,
							url: URL.createObjectURL(fixed),
						});
						setPhase("review");
					}
				} catch (error) {
					if (current()) {
						toast.error(String(error));
						setPhase(take ? "review" : "idle");
					}
				} finally {
					await context.close();
				}
			};
			active.start(250);
			setPhase("recording");
			play();
			timer.current = window.setTimeout(() => {
				if (active.state === "recording") active.stop();
			}, at.limit);
		} catch (error) {
			stream?.getTracks().forEach((t) => t.stop());
			if (current()) {
				toast.error(String(error));
				setPhase(take ? "review" : "idle");
			}
		}
	}
	function begin(replacing?: AudioRegion) {
		const track =
			regions.find(isNarration)?.trackIndex ??
			1 + regions.reduce((max, r) => Math.max(max, r.trackIndex ?? 0), -1);
		const start = replacing?.startMs ?? Math.round(position * 1000);
		const sameLane = regions.filter(
			(r) => (r.trackIndex ?? 0) === track && r.id !== replacing?.id,
		);
		if (sameLane.some((r) => r.startMs <= start && r.endMs > start)) {
			toast.error("Select the narration clip to retake it, or move to an empty spot.");
			return;
		}
		const end = Math.min(
			replacing?.endMs ?? duration * 1000,
			...sameLane.filter((r) => r.startMs > start).map((r) => r.startMs),
		);
		const limit = Math.floor(end - start);
		if (limit < 100) {
			toast.error("Move the playhead to a spot with room for narration.");
			return;
		}
		void record({ start, limit, track, replaceId: replacing?.id });
	}
	useEffect(() => { onPhaseChange(phase); }, [phase, onPhaseChange]);
	useImperativeHandle(actionRef, () => ({
		toggle() {
			if (phase === "idle") begin();
			else if (phase === "recording" && recorder.current?.state === "recording") recorder.current.stop();
		},
	}));
	async function keep() {
		if (!take) return;
		setPhase("saving");
		const token = generation.current;
		try {
			const path = await window.electronAPI.saveNarration(await take.blob.arrayBuffer());
			if (token !== generation.current) return;
			const { start, track, replaceId } = take.placement;
			const end = start + take.length;
			if (replaceId) replace(replaceId, path, end);
			else add({ start, end }, path, track);
			setTake(null);
			setPhase("idle");
		} catch (error) {
			toast.error(String(error));
			setPhase("review");
		}
	}
	const button = "rounded px-2 py-1 text-xs font-medium hover:bg-white/10 focus-visible:outline";
	return (
		<div className="flex flex-wrap items-center gap-1 border-l border-foreground/15 pl-2">
			{phase === "idle" && (
				<>
					{selected && (
						<button className={button} onClick={() => begin(selected)}>
							Retake selected narration
						</button>
					)}
				</>
			)}
			{phase === "review" && take && (
				<>
					<audio
						aria-label="Preview narration"
						className="h-7 w-52"
						controls
						src={take.url}
					/>
					<button className={button} onClick={keep}>
						Keep take
					</button>
					<button className={button} onClick={() => record(take.placement)}>
						Redo
					</button>
					<button
						className={button}
						onClick={() => {
							setTake(null);
							setPhase("idle");
						}}
					>
						Discard
					</button>
				</>
			)}
			{(phase === "idle" || phase === "review") && (
				<DropdownMenu onOpenChange={open => { if (open) void refreshInputs(); }}>
					<DropdownMenuTrigger asChild>
						<button
							className={button + " inline-flex items-center gap-1"}
							title="Microphone cleanup for the next take"
						>
							<SlidersHorizontal size={14} aria-hidden="true" />
							Mic cleanup
						</button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end">
						<DropdownMenuLabel>Microphone input</DropdownMenuLabel>
						<DropdownMenuRadioGroup value={device} onValueChange={value => {
							setDevice(value);
							window.electronAPI.setAppSetting("recordly.narration.micDevice", value);
						}}>
							<DropdownMenuRadioItem value="default">System default</DropdownMenuRadioItem>
							{inputs.map((d, index) => <DropdownMenuRadioItem key={d.deviceId} value={d.deviceId}>
								{d.label || "Microphone " + (index + 1)}
							</DropdownMenuRadioItem>)}
						</DropdownMenuRadioGroup>
						<DropdownMenuItem onSelect={() => {
							const next = { noiseSuppression: false, echoCancellation: false, autoGainControl: false };
							setCleanup(next);
							window.electronAPI.setAppSetting(preference, next);
						}}>Use unprocessed microphone</DropdownMenuItem>
						<DropdownMenuLabel>Microphone cleanup · next take</DropdownMenuLabel>
						{cleanupOptions.map(([key, label]) => (
							<DropdownMenuCheckboxItem
								key={key}
								checked={cleanup[key]}
								disabled={!navigator.mediaDevices.getSupportedConstraints()[key]}
								onCheckedChange={(checked) => {
									const next = { ...cleanup, [key]: checked === true };
									setCleanup(next);
									window.electronAPI.setAppSetting(preference, next);
								}}
							>
								{label}
							</DropdownMenuCheckboxItem>
						))}
					</DropdownMenuContent>
				</DropdownMenu>
			)}

			{phase === "recording" && <span className="text-xs text-muted-foreground" role="status">{activeMic}</span>}
			{["arming", "processing", "saving"].includes(phase) && (
				<span role="status" className="text-xs">
					{phase === "arming"
						? "Opening microphone…"
						: phase === "saving"
							? "Saving take…"
							: "Preparing preview…"}
				</span>
			)}
		</div>
	);
}
