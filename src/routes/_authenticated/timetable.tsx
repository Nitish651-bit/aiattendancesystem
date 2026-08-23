import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Plus, Pencil, Trash2, Loader2, MapPin } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { AuthedLayout } from "@/components/authed-layout";
import { PageHeader, QueryState } from "@/components/data-states";
import { supabase } from "@/integrations/supabase/client";
import { logAudit } from "@/lib/audit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_authenticated/timetable")({
  head: () => ({
    meta: [
      { title: "Timetable — Sentinel AI" },
      { name: "description", content: "Weekly class schedule with rooms, teachers and geofenced locations." },
      { property: "og:title", content: "Timetable — Sentinel AI" },
      { property: "og:description", content: "Weekly class schedule with rooms, teachers and geofenced locations." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => (
    <AuthedLayout>
      {({ orgId, userId, role }) => <TimetableBody orgId={orgId} userId={userId} role={role} />}
    </AuthedLayout>
  ),
});

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
type Day = (typeof DAYS)[number];
const DAY_LABEL: Record<Day, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

interface Slot {
  id: string;
  day_of_week: Day;
  start_time: string;
  end_time: string;
  room: string | null;
  latitude: number | null;
  longitude: number | null;
  radius_meters: number | null;
  subject_id: string;
  teacher_id: string | null;
  subject: { name: string; code: string } | null;
  teacher: { employee_code: string } | null;
}

const schema = z
  .object({
    subjectId: z.string().uuid("Select a subject"),
    teacherId: z.string().uuid().nullable(),
    day: z.enum(DAYS),
    startTime: z.string().regex(/^\d{2}:\d{2}$/, "Start time is required"),
    endTime: z.string().regex(/^\d{2}:\d{2}$/, "End time is required"),
    room: z.string().trim().max(60).optional().or(z.literal("")),
    latitude: z.number().min(-90).max(90).nullable(),
    longitude: z.number().min(-180).max(180).nullable(),
    radius: z.number().int().min(10).max(5000).nullable(),
  })
  .refine((v) => v.endTime > v.startTime, { message: "End time must be after start time" });

function TimetableBody({ orgId, userId, role }: { orgId: string; userId: string; role: string }) {
  const qc = useQueryClient();
  const canManage = role === "admin" || role === "super_admin";
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Slot | null>(null);
  const [deleting, setDeleting] = useState<Slot | null>(null);
  const [coords, setCoords] = useState<{ lat: string; lng: string } | null>(null);

  const subjects = useQuery({
    queryKey: ["subjects", orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("subjects")
        .select("id, name, code")
        .eq("organization_id", orgId)
        .is("deleted_at", null)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const teachers = useQuery({
    queryKey: ["teachers-lite", orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teachers")
        .select("id, employee_code")
        .eq("organization_id", orgId)
        .is("deleted_at", null)
        .order("employee_code");
      if (error) throw error;
      return data ?? [];
    },
  });

  const query = useQuery({
    queryKey: ["timetables", orgId],
    queryFn: async (): Promise<Slot[]> => {
      const { data, error } = await supabase
        .from("timetables")
        .select(
          "id, day_of_week, start_time, end_time, room, latitude, longitude, radius_meters, subject_id, teacher_id, subject:subjects(name, code), teacher:teachers(employee_code)",
        )
        .eq("organization_id", orgId)
        .is("deleted_at", null)
        .order("start_time");
      if (error) throw error;
      return (data ?? []) as unknown as Slot[];
    },
  });

  const save = useMutation({
    mutationFn: async (values: z.infer<typeof schema>) => {
      const payload = {
        subject_id: values.subjectId,
        teacher_id: values.teacherId,
        day_of_week: values.day,
        start_time: values.startTime,
        end_time: values.endTime,
        room: values.room || null,
        latitude: values.latitude,
        longitude: values.longitude,
        radius_meters: values.radius,
      };
      if (editing) {
        const { error } = await supabase
          .from("timetables")
          .update(payload)
          .eq("id", editing.id)
          .eq("organization_id", orgId);
        if (error) throw error;
        await logAudit({ orgId, actorId: userId, action: "timetable.update", entity: "timetables", entityId: editing.id, metadata: payload });
      } else {
        const { data, error } = await supabase
          .from("timetables")
          .insert({ ...payload, organization_id: orgId })
          .select("id")
          .single();
        if (error) throw error;
        await logAudit({ orgId, actorId: userId, action: "timetable.create", entity: "timetables", entityId: data.id, metadata: payload });
      }
    },
    onSuccess: () => {
      toast.success(editing ? "Class updated" : "Class scheduled");
      setOpen(false);
      setEditing(null);
      setCoords(null);
      qc.invalidateQueries({ queryKey: ["timetables", orgId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (slot: Slot) => {
      const { error } = await supabase
        .from("timetables")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", slot.id)
        .eq("organization_id", orgId);
      if (error) throw error;
      await logAudit({ orgId, actorId: userId, action: "timetable.delete", entity: "timetables", entityId: slot.id });
    },
    onSuccess: () => {
      toast.success("Class removed");
      setDeleting(null);
      qc.invalidateQueries({ queryKey: ["timetables", orgId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function useHere() {
    if (!navigator.geolocation) {
      toast.error("Geolocation is not available in this browser.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude.toFixed(6), lng: pos.coords.longitude.toFixed(6) });
        toast.success("Current location filled in");
      },
      () => toast.error("Could not read your location."),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const teacher = String(fd.get("teacherId") ?? "");
    const lat = String(fd.get("latitude") ?? "").trim();
    const lng = String(fd.get("longitude") ?? "").trim();
    const radius = String(fd.get("radius") ?? "").trim();
    const parsed = schema.safeParse({
      subjectId: String(fd.get("subjectId") ?? ""),
      teacherId: teacher && teacher !== "none" ? teacher : null,
      day: String(fd.get("day") ?? ""),
      startTime: String(fd.get("startTime") ?? ""),
      endTime: String(fd.get("endTime") ?? ""),
      room: fd.get("room") ?? "",
      latitude: lat ? Number(lat) : null,
      longitude: lng ? Number(lng) : null,
      radius: radius ? Number(radius) : null,
    });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    save.mutate(parsed.data);
  }

  function openForm(slot: Slot | null) {
    setEditing(slot);
    setCoords(
      slot?.latitude != null && slot?.longitude != null
        ? { lat: String(slot.latitude), lng: String(slot.longitude) }
        : null,
    );
    setOpen(true);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Timetable"
        subtitle="Attendance can only be marked inside a scheduled class window."
        action={
          canManage ? (
            <Button onClick={() => openForm(null)} disabled={(subjects.data ?? []).length === 0}>
              <Plus className="mr-2 h-4 w-4" aria-hidden /> Schedule class
            </Button>
          ) : undefined
        }
      />

      {(subjects.data ?? []).length === 0 && !subjects.isLoading && (
        <p className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
          Create at least one subject before scheduling classes.
        </p>
      )}

      <QueryState
        query={query}
        loadingLabel="Loading timetable…"
        emptyLabel="No classes scheduled."
        emptyHint="Add weekly class slots so students can check in during those windows."
      >
        {(rows) => (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {DAYS.filter((d) => rows.some((r) => r.day_of_week === d)).map((day) => (
              <section key={day} className="rounded-xl border border-border bg-card p-4">
                <h2 className="font-semibold">{DAY_LABEL[day]}</h2>
                <ul className="mt-3 space-y-3">
                  {rows
                    .filter((r) => r.day_of_week === day)
                    .map((slot) => (
                      <li key={slot.id} className="rounded-lg border border-border/70 p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate font-medium">
                              {slot.subject?.name ?? "Subject"}{" "}
                              <span className="text-muted-foreground">({slot.subject?.code})</span>
                            </p>
                            <p className="text-sm text-muted-foreground">
                              {slot.start_time.slice(0, 5)} – {slot.end_time.slice(0, 5)}
                              {slot.room ? ` · ${slot.room}` : ""}
                              {slot.teacher ? ` · ${slot.teacher.employee_code}` : ""}
                            </p>
                            {slot.latitude != null && slot.longitude != null && (
                              <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                                <MapPin className="h-3 w-3" aria-hidden />
                                Geofenced · {slot.radius_meters ?? 150}m
                              </p>
                            )}
                          </div>
                          {canManage && (
                            <div className="flex shrink-0">
                              <Button size="icon" variant="ghost" aria-label="Edit class" onClick={() => openForm(slot)}>
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button size="icon" variant="ghost" aria-label="Delete class" onClick={() => setDeleting(slot)}>
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          )}
                        </div>
                      </li>
                    ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </QueryState>

      <Dialog
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) {
            setEditing(null);
            setCoords(null);
          }
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit class" : "Schedule class"}</DialogTitle>
            <DialogDescription>
              Optional coordinates enable geofenced check-in for this slot.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="subjectId">Subject</Label>
              <select
                id="subjectId"
                name="subjectId"
                required
                defaultValue={editing?.subject_id ?? ""}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="" disabled>Select a subject</option>
                {(subjects.data ?? []).map((s) => (
                  <option key={s.id} value={s.id}>{s.name} ({s.code})</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="teacherId">Teacher</Label>
              <select
                id="teacherId"
                name="teacherId"
                defaultValue={editing?.teacher_id ?? "none"}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="none">Unassigned</option>
                {(teachers.data ?? []).map((t) => (
                  <option key={t.id} value={t.id}>{t.employee_code}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label htmlFor="day">Day</Label>
                <select
                  id="day"
                  name="day"
                  defaultValue={editing?.day_of_week ?? "mon"}
                  className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm"
                >
                  {DAYS.map((d) => (
                    <option key={d} value={d}>{DAY_LABEL[d].slice(0, 3)}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="startTime">Start</Label>
                <Input id="startTime" name="startTime" type="time" required defaultValue={editing?.start_time.slice(0, 5) ?? "09:00"} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="endTime">End</Label>
                <Input id="endTime" name="endTime" type="time" required defaultValue={editing?.end_time.slice(0, 5) ?? "10:00"} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="room">Room</Label>
              <Input id="room" name="room" maxLength={60} defaultValue={editing?.room ?? ""} placeholder="Lab 204" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label htmlFor="latitude">Latitude</Label>
                <Input
                  id="latitude"
                  name="latitude"
                  key={`lat-${coords?.lat ?? "none"}`}
                  defaultValue={coords?.lat ?? ""}
                  placeholder="optional"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="longitude">Longitude</Label>
                <Input
                  id="longitude"
                  name="longitude"
                  key={`lng-${coords?.lng ?? "none"}`}
                  defaultValue={coords?.lng ?? ""}
                  placeholder="optional"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="radius">Radius (m)</Label>
                <Input id="radius" name="radius" type="number" min={10} max={5000} defaultValue={editing?.radius_meters ?? ""} placeholder="150" />
              </div>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={useHere}>
              <MapPin className="mr-2 h-4 w-4" aria-hidden /> Use my current location
            </Button>
            <DialogFooter>
              <Button type="submit" disabled={save.isPending}>
                {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {editing ? "Save changes" : "Schedule class"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(v) => !v && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this class?</AlertDialogTitle>
            <AlertDialogDescription>
              The slot is archived. Attendance already recorded for it is preserved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (deleting) remove.mutate(deleting);
              }}
            >
              {remove.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
