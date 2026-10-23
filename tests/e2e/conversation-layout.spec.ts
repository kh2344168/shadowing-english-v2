import { expect, test } from "@playwright/test";

// Isolated UI fixtures: no real student session, AI calls, or database writes.
for (const viewport of [
  { width: 320, height: 616 },
  { width: 390, height: 844 },
  { width: 1280, height: 800 },
]) {
  test(`conversation keeps a fixed viewport and scrollable history at ${viewport.width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    // Exercise the browser's actual MediaRecorder and analyser without using a real microphone.
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = async () => {
        const context = new AudioContext();
        await context.resume();
        const oscillator = context.createOscillator();
        const destination = context.createMediaStreamDestination();
        oscillator.connect(destination);
        oscillator.start();
        const track = destination.stream.getAudioTracks()[0];
        const stop = track.stop.bind(track);
        track.stop = () => {
          stop();
          oscillator.stop();
          void context.close();
        };
        return destination.stream;
      };
    });
    let turns: object[] = [];
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/auth/session")
        return route.fulfill({
          json: { authenticated: true, roles: ["Student"], userId: "ui-test" },
        });
      if (path.endsWith("/ai-material"))
        return route.fulfill({
          json: {
            completed: { quiz: true },
            progress: { conversation: 0 },
            conversationScenario: "وقت الفراغ — Free Time",
            openingMessage: "What do you do in your free time?",
            conversationSupportMode: "first-steps",
            conversationTurnTarget: 100,
            conversationHelpAr: "يمكنك الرد بكلمة واحدة.",
            conversationModelAnswer: "I play football.",
            targetPhrases: ["I play with my friends."],
            aiRole: "Alex — رفيق التعلّم",
          },
        });
      if (path.endsWith("/conversation/turns")) {
        if (route.request().method() === "POST") {
          turns = Array.from({ length: 35 }, (_, i) => ({
            id: `t${i}`,
            message: "I usually play football with my friends.",
            feedback: {
              reply: "That sounds fun! Who do you play football with?",
              focusMet: true,
            },
          }));
          return route.fulfill({ json: {} });
        }
        return route.fulfill({
          json: {
            turns,
            completedTurns: turns.length,
            turnTarget: 100,
            remainingToday: 10,
          },
        });
      }
      if (path.endsWith("/conversation/audio")) return route.abort();
      if (path.endsWith("/conversation/transcribe"))
        return route.fulfill({ json: { text: "I play football" } });
      return route.fulfill({ json: {} });
    });
    await page.goto("/student/lessons/ui-test/conversation");
    const shell = page.locator(".conversation-shell");
    const thread = page.locator(".conversation-thread");
    const input = page.locator("#student-message");
    await expect(input).toBeVisible();
    await expect(page.locator(".student-mobile-nav")).toBeHidden();
    const before = await shell.boundingBox();
    expect(before!.height).toBeGreaterThan(viewport.height * 0.65);
    await page
      .getByRole("button", { name: "تسجيل رد صوتي", exact: true })
      .click();
    const meter = page.getByRole("meter", { name: "مستوى صوت الميكروفون" });
    await expect
      .poll(async () => Number(await meter.getAttribute("aria-valuenow")))
      .toBeGreaterThan(5);
    await page.screenshot({ path: testInfo.outputPath("recording.png") });
    await page
      .getByRole("button", { name: "إيقاف التسجيل", exact: true })
      .click();
    await expect(input).toHaveValue("I play football");
    await expect(thread.locator(".conversation-row--student")).toHaveCount(0);
    await input.fill("I play football");
    await page.getByRole("button", { name: "إرسال الرد", exact: true }).click();
    await expect(thread.locator(".conversation-row--student")).toHaveCount(35);
    const after = await shell.boundingBox();
    expect(Math.abs(after!.height - before!.height)).toBeLessThan(2);
    expect(
      await thread.evaluate((el) => el.scrollHeight > el.clientHeight),
    ).toBe(true);
    const composer = await input.boundingBox();
    expect(composer!.y + composer!.height).toBeLessThanOrEqual(viewport.height);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollHeight <= innerHeight + 1,
      ),
    ).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("conversation.png") });
    if (viewport.width < 640) {
      await page.setViewportSize({ width: viewport.width, height: 400 });
      const compact = await input.boundingBox();
      expect(compact!.y + compact!.height).toBeLessThanOrEqual(400);
      expect((await thread.boundingBox())!.height).toBeGreaterThan(50);
    }
  });
}

test('completed conversation opens a scrollable report and returns to the transcript on mobile', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 616 });
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/session') return route.fulfill({ json: { authenticated: true, roles: ['Student'], userId: 'ui-test' } });
    if (path.endsWith('/ai-material')) return route.fulfill({ json: { completed: { quiz: true }, progress: { conversation: 2 }, openingMessage: 'Hi!', conversationScenario: 'Free time', conversationSupportMode: 'guided', conversationTurnTarget: 2 } });
    if (path.endsWith('/conversation/turns')) return route.fulfill({ json: {
      turns: [
        { id: 'a', message: 'I goed home', feedback: { reply: 'Tell me more', focusMet: true, issues: [{ original: 'goed', suggested: 'went', reason: 'Past tense', kind: 'grammar' }] } },
        { id: 'b', message: 'I wnet home', feedback: { reply: 'Great', focusMet: true, issues: [{ original: 'wnet', suggested: 'went', reason: 'Spelling', kind: 'spelling' }] } },
      ], completedTurns: 2, turnTarget: 2, minTurns: 1, remainingToday: 8,
      report: { goalMet: true, replyCount: 2, relevantReplies: 2, metSteps: ['رد على السؤال'], missingSteps: [], issues: [], endedEarly: false, outcome: 'goal-met' },
    } });
    return route.fulfill({ json: {} });
  });
  await page.goto('/student/lessons/ui-test/conversation');
  const report = page.getByRole('dialog', { name: 'تقرير محادثتك' });
  await expect(report).toBeVisible();
  await expect(report.getByText('القواعد')).toBeVisible();
  await expect(report.getByText('الكتابة والإملاء')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('report-mobile.png') });
  await report.getByRole('button', { name: 'العودة للمحادثة' }).click();
  await expect(report).toBeHidden();
  await expect(page.locator('.conversation-bubble--student')).toHaveCount(2);
  await page.getByRole('button', { name: /عرض تقرير المحادثة/ }).click();
  await expect(report).toBeVisible();
});
