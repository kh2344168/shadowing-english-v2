import { expect, test } from "@playwright/test";

const groupId = "22222222-2222-4222-8222-222222222222";
const revision = "33333333-3333-4333-8333-333333333333";
const assignmentRevision = "55555555-5555-4555-8555-555555555555";
const zero = "00000000-0000-0000-0000-000000000000";
const lesson = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  versionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  title: "التعريف بالنفس",
  description: "درس محفوظ وجاهز للإضافة إلى المنهج.",
  segmentCount: 2,
};

// Browser layout/interaction coverage uses an HTTP contract fixture.
// Real database persistence, publication guards, audio and Identity are covered by CurriculumChecks.cs.
test("V1 curriculum layout: Create → Save → Assign → Publish → Refresh", async ({
  page,
}, info) => {
  let draft: Record<string, unknown> | null = null;
  let slots: Record<string, unknown>[] = [];
  let publishedSlots: Record<string, unknown>[] = [];
  let assignedId: string | null = null;
  let versionId: string | null = null;
  const writes: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.name));
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const json = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (path === "/api/auth/session")
      return json({ authenticated: true, roles: ["Admin"], userId: groupId });
    if (path === "/api/auth/csrf") return json(null);
    if (method !== "GET") writes.push(path);
    if (path === "/api/admin/shadowing/lessons")
      return json({ items: [lesson], hasMore: false });
    if (path === "/api/admin/shadowing/groups")
      return json({
        items: [
          {
            id: groupId,
            name: "مجموعة المستوى الأول",
            currentVersionId: versionId,
          },
        ],
        hasMore: false,
      });
    if (path === "/api/admin/shadowing/curriculums" && method === "GET")
      return json({
        items: draft
          ? [
              {
                ...draft,
                lessonCount: slots.length,
                weekCount: slots.length ? 1 : 0,
              },
            ]
          : [],
        hasMore: false,
      });
    if (path === "/api/admin/shadowing/curriculums" && method === "POST") {
      const body = request.postDataJSON();
      draft = {
        id: body.requestId,
        name: body.name,
        description: body.description,
        draftRevision: revision,
        updatedAtUtc: "2026-10-02T10:00:00Z",
        lessons: [],
      };
      return json(draft, 201);
    }
    if (draft && path === `/api/admin/shadowing/curriculums/${draft["id"]}`) {
      if (method === "PUT") {
        const body = request.postDataJSON();
        slots = body.lessons.map((position: Record<string, unknown>) => ({
          ...position,
          lessonId: lesson.id,
          title: lesson.title,
          description: lesson.description,
          segmentCount: lesson.segmentCount,
        }));
        draft = {
          ...draft,
          name: body.name,
          description: body.description,
          lessons: slots,
        };
      }
      return json(draft);
    }
    const state = () => ({
      groupId,
      groupName: "مجموعة المستوى الأول",
      assignedCurriculumTemplateId: assignedId,
      assignedCurriculumName: assignedId ? draft?.["name"] : null,
      draftRevision: assignedId ? revision : null,
      assignmentRevision: assignedId ? assignmentRevision : zero,
      versionId,
      publishedCurriculumTemplateId: versionId ? assignedId : null,
      publishedTitle: versionId ? draft?.["name"] : null,
      publishedDraftRevision: versionId ? revision : null,
      versionNumber: versionId ? 1 : null,
      hasUnpublishedChanges: !!assignedId && !versionId,
      lessons: publishedSlots,
    });
    if (path === `/api/admin/shadowing/groups/${groupId}/curriculum`)
      return json(state());
    if (
      path === `/api/admin/shadowing/groups/${groupId}/curriculum-assignment`
    ) {
      assignedId = request.postDataJSON().curriculumTemplateId;
      return json(state());
    }
    if (path === "/api/admin/shadowing/curriculums/publish") {
      const body = request.postDataJSON();
      expect(body.curriculumTemplateId).toBe(assignedId);
      expect(body.lessonVersionId).toBeUndefined();
      versionId = body.requestId;
      publishedSlots = structuredClone(slots);
      return json(
        {
          versionId,
          groupId,
          curriculumTemplateId: assignedId,
          sourceDraftRevision: revision,
          versionNumber: 1,
        },
        201,
      );
    }
    throw new Error(`Unexpected curriculum fixture route: ${method} ${path}`);
  });
  await page.goto(
    `/admin/curriculums?lessonVersionId=${lesson.versionId}&groupId=${groupId}`,
  );
  await expect(
    page.getByRole("heading", { name: "إدارة المناهج" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "لا توجد مناهج مطابقة" }),
  ).toBeVisible();
  expect(writes).toEqual([]);
  await page.screenshot({
    path: info.outputPath("v1-library.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "إنشاء منهج", exact: true }).click();
  const create = page.getByRole("dialog");
  await create
    .getByLabel("اسم المنهج", { exact: true })
    .fill("منهج محادثات البداية");
  await create.getByLabel("وصف مختصر").fill("خطة أسبوعية من الدروس المحفوظة.");
  await create.getByRole("button", { name: "إنشاء المنهج" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(writes).toEqual(["/api/admin/shadowing/curriculums"]);
  await page
    .getByRole("button", { name: "إضافة درس محفوظ", exact: true })
    .click();
  const picker = page.getByRole("dialog");
  await expect(picker.getByText(lesson.title, { exact: true })).toBeVisible();
  await picker.getByLabel("الأسبوع", { exact: true }).fill("2");
  await picker.getByLabel("اليوم", { exact: true }).fill("3");
  await picker.getByLabel("الترتيب", { exact: true }).fill("7");
  await page.screenshot({
    path: info.outputPath("v1-lesson-picker.png"),
    fullPage: true,
  });
  await picker.getByRole("button", { name: "إدراج الدرس" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(writes).toHaveLength(1);
  await expect(
    page.getByRole("button", { name: "نشر المنهج للمجموعة" }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "حفظ التغييرات", exact: true })
    .click();
  await expect(
    page.getByText("تم حفظ المنهج وترتيب دروسه.", { exact: false }),
  ).toBeVisible();
  expect(writes).toHaveLength(2);
  expect(versionId).toBeNull();
  expect(assignedId).toBeNull();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "منهج محادثات البداية" }),
  ).toBeVisible();
  await expect(page.getByText("الأسبوع 2", { exact: true })).toBeVisible();
  expect(writes).toHaveLength(2);
  await page.getByRole("button", { name: "إسناد المنهج", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "نشر المنهج للمجموعة" }),
  ).toBeEnabled();
  expect(writes).toHaveLength(3);
  expect(versionId).toBeNull();
  await page.getByRole("button", { name: "نشر المنهج للمجموعة" }).click();
  await expect(
    page.getByText("تم نشر المنهج كاملًا للمجموعة.", { exact: false }),
  ).toBeVisible();
  expect(writes).toHaveLength(4);
  expect(publishedSlots).toHaveLength(1);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "نشر المنهج للمجموعة" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("heading", { name: "دروس النسخة المنشورة حاليًا" }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("v1-weeks-and-publication.png"),
    fullPage: true,
  });
  expect(writes).toHaveLength(4);
  expect(errors).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("V1 error state is readable and issues no automatic writes", async ({
  page,
}, info) => {
  const writes: string[] = [];
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() !== "GET") writes.push(path);
    const session = path === "/api/auth/session";
    await route.fulfill({
      status: session ? 200 : 503,
      contentType: "application/json",
      body: JSON.stringify(
        session
          ? { authenticated: true, roles: ["Admin"], userId: groupId }
          : { error: "operation_failed" },
      ),
    });
  });
  await page.goto("/admin/curriculums");
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("status")).toHaveCount(0);
  await page.screenshot({
    path: info.outputPath("v1-error.png"),
    fullPage: true,
  });
  expect(writes).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
