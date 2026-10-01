import { expect, test } from "@playwright/test";

test("V2 student can open the published lesson, advance and restore progress", async ({
  page,
}) => {
  const email = process.env["DAY2_STUDENT_EMAIL"];
  const password = process.env["DAY2_STUDENT_PASSWORD"];
  if (!email || !password) {
    throw new Error(
      "Set DAY2_STUDENT_EMAIL and DAY2_STUDENT_PASSWORD for the local V2 test fixture.",
    );
  }

  await page.goto("/login");
  await page.getByLabel("البريد الإلكتروني").fill(email);
  await page.getByLabel("كلمة المرور", { exact: true }).fill(password);
  await page.getByRole("button", { name: /دخول إلى مساري/ }).click();
  await expect(page).toHaveURL(/\/student\/dashboard$/);
  await expect(
    page.getByRole("heading", { name: "المسار التعليمي" }),
  ).toBeVisible();

  await page.getByRole("link", { name: "عرض المنهج" }).click();
  await expect(
    page.getByRole("heading", { name: "المنهج الدراسي" }),
  ).toBeVisible();
  await page.locator(".lesson-row").first().click();
  await expect(
    page.getByRole("heading", { name: "تدريب Shadowing" }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: /ابدأ التدريب|أكمل التدريب|أعد التدريب/ })
    .click();
  await expect(page.locator(".practice-phrase")).toBeVisible();

  const indicator = page.locator("progress");
  const completedBefore = Number(await indicator.getAttribute("value"));
  const total = Number(await indicator.getAttribute("max"));
  await page.locator(".next-action").click();
  const expected = Math.min(total, completedBefore + 1);
  await expect(indicator).toHaveAttribute("value", String(expected));
  await page.reload();
  await expect(page.locator("progress")).toHaveAttribute(
    "value",
    String(expected),
  );
  await expect(page.locator(".practice-phrase")).toBeVisible();
});
