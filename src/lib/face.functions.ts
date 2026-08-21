import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const descriptor = z.array(z.number().finite()).length(128);

const livenessSchema = z.object({
  blink: z.boolean(),
  turnLeft: z.boolean(),
  turnRight: z.boolean(),
  frames: z.number().int().min(1).max(50),
  consistent: z.boolean(),
});

const enrollSchema = z.object({
  organizationId: z.string().uuid(),
  descriptor,
  samples: z.array(descriptor).min(3).max(12),
  quality: z.number().min(0).max(1),
  liveness: livenessSchema,
  /** Admins may enroll on behalf of another member of the organization. */
  targetUserId: z.string().uuid().optional(),
});

const markSchema = z.object({
  organizationId: z.string().uuid(),
  descriptor,
  quality: z.number().min(0).max(1),
  detectionScore: z.number().min(0).max(1),
  liveness: livenessSchema,
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  deviceFingerprint: z.string().max(200).nullable().optional(),
});

export type LivenessResult = z.infer<typeof livenessSchema>;

function euclidean(a: number[], b: number[]) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
  return Math.sqrt(s);
}

function confidenceFor(distance: number) {
  return Math.max(0, Math.min(1, 1 - distance / 0.9));
}

const DEFAULTS = {
  late_after_minutes: 10,
  geofence_required: true,
  block_duplicates: true,
  min_face_confidence: 0.65,
  require_liveness: true,
};

function readSettings(raw: unknown) {
  const s = (raw ?? {}) as Record<string, unknown>;
  return {
    late_after_minutes:
      typeof s['late_after_minutes'] === "number" ? (s['late_after_minutes'] as number) : DEFAULTS.late_after_minutes,
    geofence_required:
      typeof s['geofence_required'] === "boolean" ? (s['geofence_required'] as boolean) : DEFAULTS.geofence_required,
    block_duplicates:
      typeof s['block_duplicates'] === "boolean" ? (s['block_duplicates'] as boolean) : DEFAULTS.block_duplicates,
    min_face_confidence:
      typeof s['min_face_confidence'] === "number" ? (s['min_face_confidence'] as number) : DEFAULTS.min_face_confidence,
    require_liveness:
      typeof s['require_liveness'] === "boolean" ? (s['require_liveness'] as boolean) : DEFAULTS.require_liveness,
  };
}

/** Date + minutes-since-midnight + weekday in the organization's timezone. */
function orgNow(timezone: string) {
  const now = new Date();
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone || "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
      hour12: false,
    }).formatToParts(now);
  } catch {
    parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
      hour12: false,
    }).formatToParts(now);
  }
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  const minutes = Number(get("hour")) * 60 + Number(get("minute"));
  const weekday = get("weekday").toLowerCase().slice(0, 3);
  return { date, minutes, weekday };
}

function toMinutes(time: string) {
  const [h, m] = time.split(":");
  return Number(h) * 60 + Number(m);
}

function haversineMeters(a: [number, number], b: [number, number]) {
  const R = 6371000;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLon = ((b[1] - a[1]) * Math.PI) / 180;
  const la1 = (a[0] * Math.PI) / 180;
  const la2 = (b[0] * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

async function assertMember(
  supabase: { from: (t: string) => any },
  orgId: string,
  userId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("memberships")
    .select("role")
    .eq("organization_id", orgId)
    .eq("user_id", userId)
    .eq("is_active", true);
  if (error) throw new Error(error.message);
  const roles = (data ?? []).map((m: { role: string }) => m.role);
  if (roles.length === 0) throw new Error("You are not a member of this organization.");
  return roles;
}

/**
 * Stores a real face template. Verifies liveness signals, sample consistency and that the
 * face is not already enrolled by a different member of the organization.
 */
export const enrollFace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => enrollSchema.parse(input))
  .handler(async ({ data, context }) => {
    const roles = await assertMember(context.supabase, data.organizationId, context.userId);
    const isAdmin = roles.includes("admin") || roles.includes("super_admin");
    const targetUserId = data.targetUserId ?? context.userId;
    if (targetUserId !== context.userId && !isAdmin) {
      throw new Error("Only administrators can enroll another member's face.");
    }

    if (!data.liveness.blink || !data.liveness.turnLeft || !data.liveness.turnRight) {
      throw new Error("Liveness checks were not completed. Blink and turn your head both ways.");
    }
    if (!data.liveness.consistent) {
      throw new Error("Captured frames were inconsistent. Please retry in steady lighting.");
    }
    if (data.quality < 0.35) {
      throw new Error("Image quality is too low. Move to brighter light and hold still.");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    if (targetUserId !== context.userId) {
      await assertMember(supabaseAdmin as never, data.organizationId, targetUserId);
    }

    const { data: existing, error: exErr } = await supabaseAdmin
      .from("face_embeddings")
      .select("id, user_id, embedding, is_primary")
      .eq("organization_id", data.organizationId);
    if (exErr) throw new Error(exErr.message);

    for (const row of existing ?? []) {
      if (row.user_id === targetUserId) continue;
      const other = row.embedding as unknown as number[];
      if (Array.isArray(other) && other.length === 128 && euclidean(other, data.descriptor) < 0.45) {
        throw new Error("This face is already enrolled by another member of the organization.");
      }
    }

    const alreadyEnrolled = (existing ?? []).some((r) => r.user_id === targetUserId);
    if (alreadyEnrolled) {
      const { error } = await supabaseAdmin
        .from("face_embeddings")
        .delete()
        .eq("organization_id", data.organizationId)
        .eq("user_id", targetUserId);
      if (error) throw new Error(error.message);
    }

    const { data: inserted, error: insErr } = await supabaseAdmin
      .from("face_embeddings")
      .insert({
        organization_id: data.organizationId,
        user_id: targetUserId,
        embedding: data.descriptor as never,
        quality_score: data.quality,
        model: "face-api/face_recognition_model@1",
        is_primary: true,
      })
      .select("id, created_at")
      .single();
    if (insErr) throw new Error(insErr.message);

    await supabaseAdmin.from("audit_logs").insert({
      organization_id: data.organizationId,
      actor_id: context.userId,
      action: alreadyEnrolled ? "face.reenroll" : "face.enroll",
      entity: "face_embeddings",
      entity_id: inserted.id,
      ip_address: getRequestHeader("x-forwarded-for") ?? null,
      metadata: {
        target_user_id: targetUserId,
        quality: data.quality,
        samples: data.samples.length,
        liveness: data.liveness,
      } as never,
    });

    return { id: inserted.id, replaced: alreadyEnrolled, quality: data.quality };
  });

export interface MarkAttendanceResult {
  status: "present" | "late";
  recordId: string;
  confidence: number;
  subject: string | null;
  room: string | null;
  sessionDate: string;
}

/**
 * Full attendance pipeline, verified server-side: liveness -> face match against the
 * enrolled template -> timetable window -> geofence -> duplicate rules -> record + audit.
 */
export const markAttendanceByFace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => markSchema.parse(input))
  .handler(async ({ data, context }): Promise<MarkAttendanceResult> => {
    await assertMember(context.supabase, data.organizationId, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const ip = getRequestHeader("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    const userAgent = getRequestHeader("user-agent") ?? null;

    const { data: org, error: orgErr } = await supabaseAdmin
      .from("organizations")
      .select("timezone, settings")
      .eq("id", data.organizationId)
      .single();
    if (orgErr) throw new Error(orgErr.message);
    const settings = readSettings(org.settings);

    const fail = async (reason: string, meta: Record<string, unknown>) => {
      await supabaseAdmin.from("audit_logs").insert({
        organization_id: data.organizationId,
        actor_id: context.userId,
        action: "attendance.rejected",
        entity: "attendance_records",
        ip_address: ip,
        metadata: { reason, ...meta } as never,
      });
      throw new Error(reason);
    };

    if (settings.require_liveness && !(data.liveness.blink && (data.liveness.turnLeft || data.liveness.turnRight))) {
      await fail("Liveness check failed — blink and move your head, then try again.", {
        liveness: data.liveness,
      });
    }
    if (!data.liveness.consistent) {
      await fail("Possible spoof detected: the captured frames were not consistent.", {
        liveness: data.liveness,
      });
    }

    const { data: student, error: stErr } = await supabaseAdmin
      .from("students")
      .select("id, roll_number")
      .eq("organization_id", data.organizationId)
      .eq("user_id", context.userId)
      .is("deleted_at", null)
      .maybeSingle();
    if (stErr) throw new Error(stErr.message);
    if (!student) throw new Error("No active student record found for your account.");

    const { data: templates, error: tErr } = await supabaseAdmin
      .from("face_embeddings")
      .select("embedding")
      .eq("organization_id", data.organizationId)
      .eq("user_id", context.userId);
    if (tErr) throw new Error(tErr.message);
    if (!templates || templates.length === 0) {
      throw new Error("Your face is not enrolled yet. Enroll your face first.");
    }

    let best = Number.POSITIVE_INFINITY;
    for (const t of templates) {
      const vec = t.embedding as unknown as number[];
      if (Array.isArray(vec) && vec.length === 128) best = Math.min(best, euclidean(vec, data.descriptor));
    }
    const confidence = confidenceFor(best);
    if (confidence < settings.min_face_confidence) {
      await fail(
        `Face match confidence ${(confidence * 100).toFixed(0)}% is below the required ${(settings.min_face_confidence * 100).toFixed(0)}%.`,
        { confidence, distance: best },
      );
    }

    const { date, minutes, weekday } = orgNow(org.timezone);

    const { data: holiday } = await supabaseAdmin
      .from("holidays")
      .select("name")
      .eq("organization_id", data.organizationId)
      .eq("holiday_date", date)
      .maybeSingle();
    if (holiday) throw new Error(`Today is a holiday (${holiday.name}). No attendance needed.`);

    const { data: slots, error: slErr } = await supabaseAdmin
      .from("timetables")
      .select("id, subject_id, start_time, end_time, room, latitude, longitude, radius_meters, subject:subjects(name)")
      .eq("organization_id", data.organizationId)
      .eq("day_of_week", weekday)
      .is("deleted_at", null);
    if (slErr) throw new Error(slErr.message);

    const active = (slots ?? []).find((s) => {
      const start = toMinutes(s.start_time as string);
      const end = toMinutes(s.end_time as string);
      return minutes >= start - 15 && minutes <= end;
    });
    if (!active) {
      await fail("No class is scheduled right now. Attendance can only be marked during a timetabled session.", {
        weekday,
        minutes,
      });
    }
    const slot = active!;

    if (settings.geofence_required && slot.latitude != null && slot.longitude != null) {
      if (data.latitude == null || data.longitude == null) {
        await fail("Location is required for this class. Allow location access and try again.", {});
      }
      const meters = haversineMeters(
        [data.latitude as number, data.longitude as number],
        [Number(slot.latitude), Number(slot.longitude)],
      );
      const radius = slot.radius_meters ?? 150;
      if (meters > radius) {
        await fail(`You are ${Math.round(meters)}m from the classroom (limit ${radius}m).`, { meters, radius });
      }
    }

    if (settings.block_duplicates) {
      const { data: dup } = await supabaseAdmin
        .from("attendance_records")
        .select("id")
        .eq("organization_id", data.organizationId)
        .eq("student_id", student.id)
        .eq("session_date", date)
        .eq("timetable_id", slot.id)
        .maybeSingle();
      if (dup) throw new Error("Attendance for this session is already recorded.");
    }

    const start = toMinutes(slot.start_time as string);
    const status = minutes > start + settings.late_after_minutes ? "late" : "present";

    const { data: record, error: recErr } = await supabaseAdmin
      .from("attendance_records")
      .insert({
        organization_id: data.organizationId,
        student_id: student.id,
        subject_id: slot.subject_id,
        timetable_id: slot.id,
        session_date: date,
        status,
        face_confidence: confidence,
        liveness_score: data.liveness.blink && data.liveness.turnLeft && data.liveness.turnRight ? 1 : 0.6,
        ip_address: ip,
        user_agent: userAgent,
        device_fingerprint: data.deviceFingerprint ?? null,
        latitude: data.latitude ?? null,
        longitude: data.longitude ?? null,
        marked_by: context.userId,
        notes: null,
      })
      .select("id")
      .single();
    if (recErr) throw new Error(recErr.message);

    await supabaseAdmin.from("audit_logs").insert({
      organization_id: data.organizationId,
      actor_id: context.userId,
      action: "attendance.create",
      entity: "attendance_records",
      entity_id: record.id,
      ip_address: ip,
      metadata: {
        status,
        confidence,
        distance: best,
        quality: data.quality,
        detection_score: data.detectionScore,
        liveness: data.liveness,
        timetable_id: slot.id,
      } as never,
    });

    return {
      status,
      recordId: record.id,
      confidence,
      subject: (slot as unknown as { subject: { name: string } | null }).subject?.name ?? null,
      room: (slot.room as string | null) ?? null,
      sessionDate: date,
    };
  });
