/**
 * Browser face engine (client-only).
 *
 * Uses @vladmandic/face-api with the model weights served from /models.
 * All entry points dynamically import the library so it never enters the SSR graph.
 */

export type FaceApi = typeof import("@vladmandic/face-api");

let apiPromise: Promise<FaceApi> | null = null;

export const FACE_MODEL = "face-api/face_recognition_model@1";
/** Descriptor distance at/below which two faces are considered the same person. */
export const MATCH_THRESHOLD = 0.55;

export async function loadFaceApi(): Promise<FaceApi> {
  if (!apiPromise) {
    apiPromise = (async () => {
      const faceapi = await import("@vladmandic/face-api");
      await faceapi.nets.tinyFaceDetector.loadFromUri("/models");
      await faceapi.nets.faceLandmark68Net.loadFromUri("/models");
      await faceapi.nets.faceRecognitionNet.loadFromUri("/models");
      return faceapi;
    })().catch((e) => {
      apiPromise = null;
      throw e;
    });
  }
  return apiPromise;
}

export interface FaceReading {
  /** 128-d face descriptor. */
  descriptor: number[];
  /** Detector confidence 0-1. */
  score: number;
  /** Mean eye-aspect-ratio; low values mean the eyes are closed. */
  ear: number;
  /** Horizontal head turn, roughly -1 (left) .. 1 (right). */
  yaw: number;
  /** Vertical head tilt, roughly -1 (up) .. 1 (down). */
  pitch: number;
  /** Image quality 0-1 combining brightness and sharpness of the face crop. */
  quality: number;
  /** Number of faces the detector found in the frame. */
  faceCount: number;
  box: { x: number; y: number; width: number; height: number };
}

export type ReadResult =
  | { ok: true; reading: FaceReading }
  | { ok: false; reason: "no-face" | "multiple-faces"; faceCount: number };

type Point = { x: number; y: number };

function dist(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function eyeAspectRatio(eye: Point[]) {
  if (eye.length < 6) return 0;
  const vertical = dist(eye[1], eye[5]) + dist(eye[2], eye[4]);
  const horizontal = 2 * dist(eye[0], eye[3]);
  return horizontal === 0 ? 0 : vertical / horizontal;
}

/** Brightness + sharpness of the detected face crop, blended into a single 0-1 score. */
function cropQuality(
  source: HTMLVideoElement,
  box: { x: number; y: number; width: number; height: number },
): number {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return 0;
  ctx.drawImage(
    source,
    Math.max(0, box.x),
    Math.max(0, box.y),
    Math.max(1, box.width),
    Math.max(1, box.height),
    0,
    0,
    size,
    size,
  );
  const { data } = ctx.getImageData(0, 0, size, size);
  const gray = new Float64Array(size * size);
  let sum = 0;
  for (let i = 0; i < size * size; i++) {
    const g = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
    gray[i] = g;
    sum += g;
  }
  const mean = sum / gray.length;
  // Brightness: penalise very dark and blown-out frames.
  const brightness = Math.max(0, 1 - Math.abs(mean - 128) / 128);

  // Sharpness: variance of a 4-neighbour Laplacian.
  let lapSum = 0;
  let lapSq = 0;
  let n = 0;
  for (let y = 1; y < size - 1; y++) {
    for (let x = 1; x < size - 1; x++) {
      const i = y * size + x;
      const lap =
        4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - size] - gray[i + size];
      lapSum += lap;
      lapSq += lap * lap;
      n++;
    }
  }
  const variance = lapSq / n - (lapSum / n) ** 2;
  const sharpness = Math.min(1, variance / 300);

  return Math.max(0, Math.min(1, 0.45 * brightness + 0.55 * sharpness));
}

/** Reads the current video frame: descriptor, liveness signals and quality. */
export async function readFrame(video: HTMLVideoElement): Promise<ReadResult> {
  const faceapi = await loadFaceApi();
  const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.4 });
  const results = await faceapi
    .detectAllFaces(video, options)
    .withFaceLandmarks()
    .withFaceDescriptors();

  if (results.length === 0) return { ok: false, reason: "no-face", faceCount: 0 };
  if (results.length > 1)
    return { ok: false, reason: "multiple-faces", faceCount: results.length };

  const r = results[0];
  const lm = r.landmarks;
  const leftEye = lm.getLeftEye() as Point[];
  const rightEye = lm.getRightEye() as Point[];
  const nose = lm.getNose() as Point[];
  const jaw = lm.getJawOutline() as Point[];

  const ear = (eyeAspectRatio(leftEye) + eyeAspectRatio(rightEye)) / 2;

  const eyeMid = {
    x: (leftEye[0].x + rightEye[3].x) / 2,
    y: (leftEye[0].y + rightEye[3].y) / 2,
  };
  const noseTip = nose[nose.length - 3] ?? nose[0];
  const faceWidth = Math.max(1, dist(jaw[0], jaw[jaw.length - 1]));
  const chin = jaw[Math.floor(jaw.length / 2)];
  const faceHeight = Math.max(1, dist(eyeMid, chin));

  const yaw = ((noseTip.x - eyeMid.x) / faceWidth) * 4;
  const pitch = ((noseTip.y - eyeMid.y) / faceHeight - 0.5) * 2;

  const box = r.detection.box;
  return {
    ok: true,
    reading: {
      descriptor: Array.from(r.descriptor),
      score: r.detection.score,
      ear,
      yaw: Math.max(-1.5, Math.min(1.5, yaw)),
      pitch: Math.max(-1.5, Math.min(1.5, pitch)),
      quality: cropQuality(video, box),
      faceCount: 1,
      box: { x: box.x, y: box.y, width: box.width, height: box.height },
    },
  };
}

export function euclidean(a: number[], b: number[]): number {
  if (a.length !== b.length) return Number.POSITIVE_INFINITY;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
  return Math.sqrt(s);
}

/** Maps a descriptor distance to a 0-1 confidence value. */
export function distanceToConfidence(distance: number): number {
  if (!Number.isFinite(distance)) return 0;
  return Math.max(0, Math.min(1, 1 - distance / 0.9));
}

/** Averages several descriptors into one stable template. */
export function averageDescriptors(list: number[][]): number[] {
  const out = new Array(list[0].length).fill(0);
  for (const d of list) for (let i = 0; i < d.length; i++) out[i] += d[i];
  return out.map((v) => v / list.length);
}

/** True when every descriptor in the set is consistent with the mean (anti-splice check). */
export function descriptorsConsistent(list: number[][], max = 0.45): boolean {
  const mean = averageDescriptors(list);
  return list.every((d) => euclidean(d, mean) <= max);
}
