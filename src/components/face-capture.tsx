import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Check, Loader2, RefreshCw, ScanFace } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  averageDescriptors,
  descriptorsConsistent,
  loadFaceApi,
  readFrame,
  type FaceReading,
} from "@/lib/face/engine";

export interface CapturePayload {
  descriptor: number[];
  samples: number[][];
  quality: number;
  detectionScore: number;
  liveness: {
    blink: boolean;
    turnLeft: boolean;
    turnRight: boolean;
    frames: number;
    consistent: boolean;
  };
}

type Step = "idle" | "loading" | "center" | "blink" | "left" | "right" | "done";

const STEP_LABEL: Record<Step, string> = {
  idle: "Camera is off",
  loading: "Loading the face recognition models…",
  center: "Look straight at the camera and hold still",
  blink: "Now blink slowly",
  left: "Turn your head to the left",
  right: "Turn your head to the right",
  done: "Capture complete",
};

const SAMPLES_NEEDED = 6;
const EAR_OPEN = 0.26;
const EAR_CLOSED = 0.19;
const YAW_TURN = 0.28;

export function FaceCapture({
  onComplete,
  busy,
  actionLabel,
  resetKey,
}: {
  onComplete: (payload: CapturePayload) => void;
  busy?: boolean;
  actionLabel: string;
  resetKey?: number;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const runningRef = useRef(false);

  const samplesRef = useRef<number[][]>([]);
  const eyesClosedRef = useRef(false);
  const stepRef = useRef<Step>("idle");

  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string>("");
  const [reading, setReading] = useState<FaceReading | null>(null);
  const [progress, setProgress] = useState(0);
  const [flags, setFlags] = useState({ blink: false, turnLeft: false, turnRight: false });

  const setStepBoth = useCallback((s: Step) => {
    stepRef.current = s;
    setStep(s);
  }, []);

  const stop = useCallback(() => {
    runningRef.current = false;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => () => stop(), [stop]);

  useEffect(() => {
    if (resetKey === undefined) return;
    stop();
    samplesRef.current = [];
    eyesClosedRef.current = false;
    setFlags({ blink: false, turnLeft: false, turnRight: false });
    setProgress(0);
    setReading(null);
    setError(null);
    setHint("");
    setStepBoth("idle");
  }, [resetKey, stop, setStepBoth]);

  const loop = useCallback(async () => {
    const video = videoRef.current;
    if (!runningRef.current || !video || video.readyState < 2) {
      rafRef.current = requestAnimationFrame(() => void loop());
      return;
    }

    try {
      const result = await readFrame(video);
      if (!runningRef.current) return;

      if (!result.ok) {
        setReading(null);
        setHint(result.reason === "no-face" ? "No face detected — center your face in the frame." : "More than one face is visible. Only one person may be in frame.");
        rafRef.current = requestAnimationFrame(() => void loop());
        return;
      }

      const r = result.reading;
      setReading(r);

      if (r.quality < 0.3) {
        setHint("Low image quality — move into brighter light and hold still.");
      } else {
        setHint("");
      }

      const current = stepRef.current;

      if (current === "center") {
        if (r.quality >= 0.3 && Math.abs(r.yaw) < 0.2) {
          samplesRef.current.push(r.descriptor);
          setProgress(Math.min(100, (samplesRef.current.length / SAMPLES_NEEDED) * 100));
          if (samplesRef.current.length >= SAMPLES_NEEDED) setStepBoth("blink");
        }
      } else if (current === "blink") {
        if (r.ear < EAR_CLOSED) eyesClosedRef.current = true;
        else if (eyesClosedRef.current && r.ear > EAR_OPEN) {
          setFlags((f) => ({ ...f, blink: true }));
          setStepBoth("left");
        }
      } else if (current === "left") {
        if (r.yaw < -YAW_TURN) {
          setFlags((f) => ({ ...f, turnLeft: true }));
          setStepBoth("right");
        }
      } else if (current === "right") {
        if (r.yaw > YAW_TURN) {
          setFlags((f) => ({ ...f, turnRight: true }));
          if (r.quality >= 0.3) samplesRef.current.push(r.descriptor);
          setStepBoth("done");
          runningRef.current = false;
          const samples = samplesRef.current.slice(0, 12);
          const payload: CapturePayload = {
            descriptor: averageDescriptors(samples),
            samples,
            quality: r.quality,
            detectionScore: r.score,
            liveness: {
              blink: true,
              turnLeft: true,
              turnRight: true,
              frames: samples.length,
              consistent: descriptorsConsistent(samples),
            },
          };
          stop();
          onComplete(payload);
          return;
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Face detection failed.");
      runningRef.current = false;
      stop();
      setStepBoth("idle");
      return;
    }

    rafRef.current = requestAnimationFrame(() => void loop());
  }, [onComplete, setStepBoth, stop]);

  const start = useCallback(async () => {
    setError(null);
    samplesRef.current = [];
    eyesClosedRef.current = false;
    setFlags({ blink: false, turnLeft: false, turnRight: false });
    setProgress(0);
    setStepBoth("loading");
    try {
      await loadFaceApi();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      runningRef.current = true;
      setStepBoth("center");
      void loop();
    } catch (e) {
      stop();
      setStepBoth("idle");
      setError(
        e instanceof Error
          ? e.name === "NotAllowedError"
            ? "Camera permission was denied. Allow camera access and try again."
            : e.message
          : "Could not start the camera.",
      );
    }
  }, [loop, setStepBoth, stop]);

  const active = step !== "idle" && step !== "done";

  return (
    <div className="space-y-4">
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl border border-border bg-muted">
        <video
          ref={videoRef}
          playsInline
          muted
          className="h-full w-full scale-x-[-1] object-cover"
        />
        {step === "idle" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground">
            <ScanFace className="h-10 w-10" aria-hidden />
            <p className="text-sm">Camera preview appears here</p>
          </div>
        )}
        {step === "loading" && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 bg-background/70 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading models…
          </div>
        )}
        {active && step !== "loading" && (
          <div className="pointer-events-none absolute inset-6 rounded-[40%] border-2 border-primary/60" />
        )}
      </div>

      <div aria-live="polite" className="space-y-2">
        <p className="text-sm font-medium">{STEP_LABEL[step]}</p>
        {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
        {active && <Progress value={progress} className="h-2" />}
        <div className="flex flex-wrap gap-2 text-xs">
          <Badgeish ok={flags.blink} label="Blink" />
          <Badgeish ok={flags.turnLeft} label="Turn left" />
          <Badgeish ok={flags.turnRight} label="Turn right" />
          {reading && (
            <span className="rounded-full border border-border px-2 py-1 text-muted-foreground">
              Quality {(reading.quality * 100).toFixed(0)}%
            </span>
          )}
        </div>
      </div>

      <div className="flex gap-2">
        <Button onClick={() => void start()} disabled={active || busy}>
          {busy ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
          ) : step === "done" ? (
            <RefreshCw className="mr-2 h-4 w-4" aria-hidden />
          ) : (
            <Camera className="mr-2 h-4 w-4" aria-hidden />
          )}
          {step === "done" ? "Capture again" : actionLabel}
        </Button>
        {active && (
          <Button
            variant="outline"
            onClick={() => {
              stop();
              setStepBoth("idle");
            }}
          >
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}

function Badgeish({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={
        ok
          ? "flex items-center gap-1 rounded-full bg-primary/10 px-2 py-1 text-primary"
          : "flex items-center gap-1 rounded-full border border-border px-2 py-1 text-muted-foreground"
      }
    >
      {ok && <Check className="h-3 w-3" aria-hidden />}
      {label}
    </span>
  );
}
