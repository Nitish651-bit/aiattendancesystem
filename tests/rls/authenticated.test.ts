import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  adminClient,
  cleanupTestUsers,
  createTestUser,
  type TestUser,
} from "./helpers";

const admin = adminClient();

let orgAdmin: TestUser; // super_admin of org A
let otherAdmin: TestUser; // super_admin of org B
let student: TestUser; // student in org A
let student2: TestUser; // second student in org A

let orgA: string;
let orgB: string;
let studentRowId: string;
let student2RowId: string;
let subjectA: string;
let departmentB: string;

async function addMembership(userId: string, orgId: string, role: string) {
  const { error } = await admin
    .from("memberships")
    .insert({ user_id: userId, organization_id: orgId, role });
  if (error) throw new Error(error.message);
}

async function addStudentRow(userId: string, orgId: string) {
  const { data, error } = await admin
    .from("students")
    .insert({
      user_id: userId,
      organization_id: orgId,
      roll_number: `R-${randomUUID().slice(0, 8)}`,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data!.id as string;
}

beforeAll(async () => {
  [orgAdmin, otherAdmin, student, student2] = await Promise.all([
    createTestUser("admin-a"),
    createTestUser("admin-b"),
    createTestUser("student-1"),
    createTestUser("student-2"),
  ]);
  orgA = orgAdmin.orgId;
  orgB = otherAdmin.orgId;

  await addMembership(student.id, orgA, "student");
  await addMembership(student2.id, orgA, "student");
  studentRowId = await addStudentRow(student.id, orgA);
  student2RowId = await addStudentRow(student2.id, orgA);

  const subject = await admin
    .from("subjects")
    .insert({ organization_id: orgA, name: "Physics", code: `PH-${Date.now()}` })
    .select("id")
    .single();
  subjectA = subject.data!.id;

  const dept = await admin
    .from("departments")
    .insert({ organization_id: orgB, name: "Private Dept", code: `PD-${Date.now()}` })
    .select("id")
    .single();
  departmentB = dept.data!.id;
});

afterAll(cleanupTestUsers);

describe("tenant isolation (authenticated role)", () => {
  it("admin reads only their own organization", async () => {
    const { data } = await orgAdmin.client.from("organizations").select("id");
    expect(data?.map((r) => r.id)).toEqual([orgA]);
  });

  it("admin cannot read another org's department", async () => {
    const { data } = await orgAdmin.client
      .from("departments")
      .select("*")
      .eq("id", departmentB);
    expect(data).toEqual([]);
  });

  it("admin can create a department in their own org", async () => {
    const { error } = await orgAdmin.client
      .from("departments")
      .insert({ organization_id: orgA, name: "CSE", code: `CS-${Date.now()}` });
    expect(error).toBeNull();
  });

  it("admin cannot create a department in another org", async () => {
    const { error } = await orgAdmin.client
      .from("departments")
      .insert({ organization_id: orgB, name: "Hijack", code: `HJ-${Date.now()}` });
    expect(error).not.toBeNull();
  });

  it("admin cannot grant themselves membership in another org", async () => {
    const { error } = await orgAdmin.client
      .from("memberships")
      .insert({ user_id: orgAdmin.id, organization_id: orgB, role: "super_admin" });
    expect(error).not.toBeNull();
  });

  it("admin cannot update another organization", async () => {
    const { data } = await orgAdmin.client
      .from("organizations")
      .update({ name: "Taken over" })
      .eq("id", orgB)
      .select();
    expect(data ?? []).toEqual([]);
  });

  it("user cannot read another user's profile", async () => {
    const { data } = await orgAdmin.client
      .from("profiles")
      .select("*")
      .eq("id", otherAdmin.id);
    expect(data).toEqual([]);
  });
});

describe("student scoping", () => {
  it("student reads org subjects but cannot write them", async () => {
    const read = await student.client.from("subjects").select("id").eq("id", subjectA);
    expect(read.data).toHaveLength(1);

    const write = await student.client
      .from("subjects")
      .insert({ organization_id: orgA, name: "Fake", code: `FK-${Date.now()}` });
    expect(write.error).not.toBeNull();
  });

  it("student reads only their own student record", async () => {
    const { data } = await student.client.from("students").select("id");
    expect(data?.map((r) => r.id)).toEqual([studentRowId]);
  });

  it("student can insert their own attendance", async () => {
    const { error } = await student.client.from("attendance_records").insert({
      organization_id: orgA,
      student_id: studentRowId,
      subject_id: subjectA,
      session_date: new Date().toISOString().slice(0, 10),
    });
    expect(error).toBeNull();
  });

  it("student cannot insert attendance for another student", async () => {
    const { error } = await student.client.from("attendance_records").insert({
      organization_id: orgA,
      student_id: student2RowId,
      session_date: new Date().toISOString().slice(0, 10),
    });
    expect(error).not.toBeNull();
  });

  it("student cannot read another student's attendance", async () => {
    await admin.from("attendance_records").insert({
      organization_id: orgA,
      student_id: student2RowId,
      session_date: new Date().toISOString().slice(0, 10),
    });
    const { data } = await student.client
      .from("attendance_records")
      .select("student_id");
    expect(data?.every((r) => r.student_id === studentRowId)).toBe(true);
  });

  it("student can file their own leave but not someone else's", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const own = await student.client.from("leave_requests").insert({
      organization_id: orgA,
      student_id: studentRowId,
      from_date: today,
      to_date: today,
      reason: "sick",
    });
    expect(own.error).toBeNull();

    const other = await student.client.from("leave_requests").insert({
      organization_id: orgA,
      student_id: student2RowId,
      from_date: today,
      to_date: today,
      reason: "spoof",
    });
    expect(other.error).not.toBeNull();
  });

  it("student cannot delete leave requests", async () => {
    const { data } = await student.client
      .from("leave_requests")
      .delete()
      .eq("student_id", studentRowId)
      .select();
    expect(data ?? []).toEqual([]);
  });

  it("student can store their own face embedding but not another user's", async () => {
    const own = await student.client.from("face_embeddings").insert({
      organization_id: orgA,
      user_id: student.id,
      embedding: [0.1, 0.2],
    });
    expect(own.error).toBeNull();

    const other = await student.client.from("face_embeddings").insert({
      organization_id: orgA,
      user_id: student2.id,
      embedding: [0.3],
    });
    expect(other.error).not.toBeNull();
  });

  it("student cannot read another user's face embedding", async () => {
    const { data } = await student.client.from("face_embeddings").select("user_id");
    expect(data?.every((r) => r.user_id === student.id)).toBe(true);
  });
});

describe("audit log writes", () => {
  it("user can write an audit entry attributed to themselves", async () => {
    const { error } = await student.client.from("audit_logs").insert({
      organization_id: orgA,
      actor_id: student.id,
      action: "face.match",
    });
    expect(error).toBeNull();
  });

  it("user cannot spoof another actor", async () => {
    const { error } = await student.client.from("audit_logs").insert({
      organization_id: orgA,
      actor_id: orgAdmin.id,
      action: "face.match",
    });
    expect(error).not.toBeNull();
  });

  it("non-admin cannot read audit logs", async () => {
    const { data } = await student.client.from("audit_logs").select("id");
    expect(data ?? []).toEqual([]);
  });

  it("org admin reads their org's audit logs only", async () => {
    await admin.from("audit_logs").insert({
      organization_id: orgB,
      actor_id: otherAdmin.id,
      action: "other.org.event",
    });
    const { data } = await orgAdmin.client
      .from("audit_logs")
      .select("organization_id");
    expect(data?.length).toBeGreaterThan(0);
    expect(data?.every((r) => r.organization_id === orgA)).toBe(true);
  });

  it("audit logs are immutable for authenticated users", async () => {
    const update = await orgAdmin.client
      .from("audit_logs")
      .update({ action: "tampered" })
      .eq("organization_id", orgA)
      .select();
    expect(update.data ?? []).toEqual([]);

    const del = await orgAdmin.client
      .from("audit_logs")
      .delete()
      .eq("organization_id", orgA)
      .select();
    expect(del.data ?? []).toEqual([]);
  });
});
