using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using ShadowingEnglish.Api.Modules.AI;
using ShadowingEnglish.Api.Modules.Media;
using ShadowingEnglish.Core.Learning;
using ShadowingEnglish.Infrastructure.Database;
using ShadowingEnglish.Infrastructure.Identity;

namespace ShadowingEnglish.MediaChecks;

// Offline acceptance checks: disposable SQLite and TestServer, no provider key or Azure service.
internal static class AiTextChecks
{
    private static void Assert(bool condition, string error)
    { if (!condition) throw new InvalidOperationException(error); }

    public static async Task<int> RunAsync(Func<string, Func<Task>, Task> check, Func<int> failures)
    {
        var apiRoot = Path.GetFullPath(Path.Combine(Directory.GetCurrentDirectory(), "backend/ShadowingEnglish.Api"));
        using var logs = new SafeLogs();
        using var app = new MediaApp(apiRoot, new DisabledShadowingMediaStore(), logs);
        await app.SetupAsync();
        var versionId = Guid.NewGuid(); var publishedId = Guid.NewGuid(); var slotId = Guid.NewGuid();
        var contentId = Guid.NewGuid(); var revision = Guid.NewGuid();
        var material = new LessonMaterial(
            [new VocabularyCard("hello", "مرحبًا", "Hello world!", "مرحبًا بالعالم")],
            [new QuizCard("Choose hello", ["bye", "hello", "thanks", "good"], 1, "إجابة الترحيب")],
            "Greeting someone politely", "Say hello to a friend");
        await check("AI material validates source words and quiz choices", () =>
        {
            Assert(LessonMaterialRules.Valid(material, "Hello world"), "valid_lesson_rejected");
            Assert(!LessonMaterialRules.Valid(material, "Something else"), "invented_word_accepted");
            Assert(!LessonMaterialRules.Valid(material with
                { Quiz = [material.Quiz[0] with { Options = ["same", "same", "a", "b"] }] }, "Hello world"),
                "duplicate_quiz_choices_accepted");
            var v1 = material with
            {
                Vocabulary = [material.Vocabulary[0], new VocabularyCard("Hello world", "تحية",
                    "Hello world", "مرحبًا بالعالم", Kind: "chunk")],
                Quiz = [new QuizCard("Arrange the sentence", ["Hello", "from", "here"], 0,
                    "جملة الدرس", Type: "word-order", CorrectAnswer: "Hello from here")],
                Dictation = [new DictationCard(1, false, ["Hello world"]),
                    new DictationCard(2, true, ["Hello from here"], "ابدأ بالتحية")],
                ShadowingReviewEnabled = true
            };
            Assert(LessonMaterialRules.Valid(v1, "Hello world\nHello from here", [1, 2]),
                "v1_activities_rejected");
            Assert(!LessonMaterialRules.Valid(v1 with { Vocabulary =
                [material.Vocabulary[0], v1.Vocabulary[1] with { Word = "invented phrase" }] },
                "Hello world\nHello from here", [1, 2]), "invented_chunk_accepted");
            Assert(!LessonMaterialRules.Valid(v1 with { Dictation =
                [new DictationCard(3, true, ["Hello world"])] }, "Hello world\nHello from here", [1, 2]),
                "unknown_segment_accepted");
            Assert(LessonMaterialRules.ReadyToApprove(v1 with { ReviewedStages =
                ["vocabulary", "listen-type", "grammar", "vocabulary-quiz", "grammar-quiz",
                    "word-order", "conversation"] }), "default_workflow_review_rejected");
            Assert(LessonMaterialRules.ReadyToApprove(v1 with { ReviewedStages =
                ["vocabulary", "listen-type", "quiz", "conversation"] }),
                "legacy_review_rejected");
            Assert(!LessonMaterialRules.ReadyToApprove(v1 with { ReviewedStages =
                ["vocabulary", "listen-type", "conversation"] }), "partial_review_accepted");
            var focused = material with { ConversationTurnTarget = 4,
                ConversationFocusTense = "present-simple", ConversationTargetWords = ["hello"],
                ConversationLearningOutcome = "Greet a colleague in present simple" };
            Assert(LessonMaterialRules.Valid(focused, "Hello world") &&
                LessonMaterialRules.ConversationTurns(focused) == 4 &&
                LessonMaterialRules.ConversationTurns(material) == 10,
                "conversation_focus_or_legacy_turn_count_invalid");
            Assert(!LessonMaterialRules.Valid(focused with { ConversationTurnTarget = 21 }, "Hello world") &&
                !LessonMaterialRules.Valid(focused with { ConversationFocusTense = "unknown" }, "Hello world") &&
                !LessonMaterialRules.Valid(focused with { ConversationTargetWords = ["invented"] }, "Hello world"),
                "invalid_conversation_configuration_accepted");
            Assert(LessonMaterialRules.ParseFeedback(
                "{\"reply\":\"How are you?\",\"correction\":\"\",\"betterAnswer\":\"\",\"grammarTip\":\"\"}") is not null,
                "unnecessary_correction_cannot_be_left_empty");
            Assert(!LessonMaterialRules.CountsConversationTurn(focused,
                    new ChatFeedback("Try present simple.", "", "", "", false)) &&
                LessonMaterialRules.CountsConversationTurn(focused,
                    new ChatFeedback("Good!", "", "", "", true)) &&
                LessonMaterialRules.CountsConversationTurn(material,
                    new ChatFeedback("Good!", "", "", "", null)),
                "off_tense_reply_counted_or_legacy_reply_blocked");
            return Task.CompletedTask;
        });
        await check("Generated chunks and safe dictation preserve the old model response", () =>
        {
            const string output = """
                {"vocabulary":[{"word":"Good morning!","meaningAr":"صباح الخير","exampleEn":"Good morning, friend.","exampleAr":"صباح الخير يا صديقي."}],"quiz":[{"question":"Choose the greeting","options":["Good morning","Good night","Bye","Thanks"],"correctIndex":0,"explanationAr":"التحية الصحيحة"}],"grammarFocus":"Morning greeting","conversationScenario":"Greet a friend"}
                """;
            Assert(LessonMaterialRules.Parse(output, "Good morning!") is null,
                "strict_review_must_reject_unmarked_punctuated_chunk");
            var generated = LessonMaterialRules.ParseGenerated(output, "Good morning!");
            Assert(generated?.Vocabulary[0].Word == "Good morning" &&
                generated.Vocabulary[0].Kind == "chunk", "generated_chunk_not_normalized");
            Assert(LessonMaterialRules.ParseGenerated(output, "Different transcript") is null,
                "invented_generated_chunk_accepted");
            var prepared = LessonMaterialRules.PrepareDraft(generated!,
                [new LessonTranscriptSegment(1, "Good morning!"),
                    new LessonTranscriptSegment(2, new string('a', 601))]);
            Assert(prepared?.Dictation is { Length: 1 } && prepared.Dictation[0].Position == 1,
                "long_sentence_made_all_generated_activities_fail");
            Assert(LessonMaterialRules.PrepareDraft(generated!,
                [new LessonTranscriptSegment(1, new string('a', 601))]) is null,
                "impossible_dictation_must_fail_before_marking_draft");
            Assert(prepared is not null && !LessonMaterialRules.ReadyToApprove(prepared),
                "unreviewed_generated_draft_can_be_approved");
            return Task.CompletedTask;
        });
        await check("SQL Server migration metadata matches the current AI model", () =>
        {
            var options = new DbContextOptionsBuilder<ApplicationDbContext>()
                .UseSqlServer("Server=127.0.0.1;Database=NeverConnected;Integrated Security=true;").Options;
            using var model = new ApplicationDbContext(options);
            Assert(!model.Database.HasPendingModelChanges(), "ai_model_snapshot_is_stale");
            Assert(model.Database.GetMigrations().Last() == "20261012090000_SnapshotPublishedLessonWorkflow",
                "ai_migration_not_registered");
            var script = model.GetService<IMigrator>().GenerateScript();
            Assert(script.Contains("CREATE TABLE [LessonAiContents]") &&
                script.Contains("CREATE TABLE [StudentPracticeAttempts]") &&
                script.Contains("[AiContentId]", StringComparison.Ordinal) &&
                script.Contains("CREATE TABLE [LessonWorkflows]") &&
                script.Contains("[WorkflowStagesJson]"), "ai_migration_sql_missing");
            return Task.CompletedTask;
        });
        await check("Router falls back after 429 and validates JSON before returning", async () =>
        {
            var settings = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["AiText:Providers:Groq:ApiKey"] = "synthetic-groq-key",
                ["AiText:Providers:Cloudflare:ApiKey"] = "synthetic-cloudflare-key",
                ["AiText:Providers:Cloudflare:AccountId"] = new string('a', 32)
            }).Build();
            var destinations = new List<string>();
            using var handler = new StubAiHandler(request =>
            {
                destinations.Add(request.RequestUri!.Host);
                Assert(request.Headers.Authorization?.Scheme == "Bearer" &&
                    request.Headers.Authorization.Parameter!.StartsWith("synthetic-"), "missing_private_auth");
                if (destinations.Count == 1) return new HttpResponseMessage(HttpStatusCode.TooManyRequests);
                var output = JsonSerializer.Serialize(new { choices = new[] { new { message = new
                {
                    content = "{\"reply\":\"Hello!\",\"correction\":\"Hello.\",\"betterAnswer\":\"Hello friend.\",\"grammarTip\":\"Use a greeting.\"}"
                } } } });
                return new HttpResponseMessage(HttpStatusCode.OK)
                    { Content = new StringContent(output, Encoding.UTF8, "application/json") };
            });
            using var client = new HttpClient(handler);
            var router = new TextAiRouter(new StubAiClientFactory(client), settings, NullLogger<TextAiRouter>.Instance);
            string? failure = null;
            var response = await router.CompleteAsync([new AiMessage("user", "Hello")],
                100, LessonMaterialRules.ParseFeedback, CancellationToken.None, code => failure = code);
            Assert(response?.Provider == "Cloudflare" && response.Value.Reply == "Hello!" &&
                destinations.SequenceEqual(["api.groq.com", "api.cloudflare.com"]) &&
                failure == "provider_rate_limited", "fallback_not_bounded_or_invalid");
        });
        await check("Rejected provider key produces a safe failure code", async () =>
        {
            var settings = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
            { ["AiText:Providers:Groq:ApiKey"] = "synthetic-groq-key" }).Build();
            using var handler = new StubAiHandler(_ => new HttpResponseMessage(HttpStatusCode.Unauthorized));
            using var client = new HttpClient(handler);
            var router = new TextAiRouter(new StubAiClientFactory(client), settings,
                NullLogger<TextAiRouter>.Instance);
            string? failure = null;
            var result = await router.CompleteAsync([new AiMessage("user", "Hello")],
                100, LessonMaterialRules.ParseFeedback, CancellationToken.None, code => failure = code);
            Assert(result is null && failure == "provider_auth_rejected", "provider_rejection_not_identified");
        });
        using (var scope = app.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
            var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
            var admin = (await users.FindByEmailAsync("admin@v2-test.invalid"))!;
            var student = (await users.FindByEmailAsync("student@v2-test.invalid"))!;
            var now = DateTimeOffset.UtcNow.AddMinutes(-1);
            var templateId = Guid.NewGuid(); var definitionId = Guid.NewGuid();
            db.CurriculumTemplates.Add(new CurriculumTemplate { Id = templateId, Name = "AI test", DraftRevision = Guid.NewGuid() });
            db.LessonDefinitions.Add(new LessonDefinition { Id = definitionId, Title = "Hello" });
            db.LessonVersions.Add(new LessonVersion { Id = versionId, LessonDefinitionId = definitionId,
                Title = "Hello", Description = "", VersionNumber = 1, CreatedAtUtc = now });
            db.LessonSegments.Add(new LessonSegment { Id = Guid.NewGuid(), LessonVersionId = versionId,
                Position = 1, Text = "Hello world", AudioStorageKey = "lesson-ai-test.wav" });
            db.LessonAiContents.Add(new LessonAiContent { Id = contentId, LessonVersionId = versionId,
                CreatedByAdminId = admin.Id, Revision = revision, Status = "Approved",
                PayloadJson = JsonSerializer.Serialize(material, LessonMaterialRules.Json),
                CreatedAtUtc = now, UpdatedAtUtc = now, ApprovedAtUtc = now });
            db.PublishedCurriculumVersions.Add(new PublishedCurriculumVersion { Id = publishedId,
                CurriculumTemplateId = templateId, GroupId = app.GroupId,
                Title = "AI test", VersionNumber = 1, PublishedAtUtc = now, AvailableAtUtc = now });
            db.PublishedLessonSlots.Add(new PublishedLessonSlot { Id = slotId,
                PublishedCurriculumVersionId = publishedId, LessonVersionId = versionId,
                AiContentId = contentId, WeekNumber = 1, DayNumber = 1, SortOrder = 1, AvailableAtUtc = now });
            db.GroupCurriculumAssignments.Add(new GroupCurriculumAssignment
                { GroupId = app.GroupId, PublishedCurriculumVersionId = publishedId });
            db.StudentStageProgress.Add(new StudentStageProgress { StudentId = student.Id,
                PublishedCurriculumVersionId = publishedId, SlotId = slotId, StageKey = "shadowing",
                CompletedSegments = 1, IsComplete = true, UpdatedAtUtc = now });
            await db.SaveChangesAsync();
        }
        using var studentClient = await app.LoginAsync("student");
        using var other = await app.LoginAsync("other");
        using var adminClient = await app.LoginAsync("admin");
        var path = $"/api/student/learning/slots/{slotId}";
        await check("Admin approval requires four saved review decisions", async () =>
        {
            var draftId = Guid.NewGuid(); var draftRevision = Guid.NewGuid();
            var reviewed = material with { Dictation = [new DictationCard(1, true, ["Hello world"])],
                ReviewedStages = [] };
            using (var scope = app.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
                var admin = (await scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>()
                    .FindByEmailAsync("admin@v2-test.invalid"))!;
                db.LessonAiContents.Add(new LessonAiContent { Id = draftId, LessonVersionId = versionId,
                    CreatedByAdminId = admin.Id, Revision = draftRevision, Status = "Draft",
                    PayloadJson = JsonSerializer.Serialize(reviewed, LessonMaterialRules.Json),
                    CreatedAtUtc = DateTimeOffset.UtcNow, UpdatedAtUtc = DateTimeOffset.UtcNow });
                await db.SaveChangesAsync();
            }
            var url = $"/api/admin/lessons/{versionId}/ai/{draftId}";
            using var latest = await adminClient.GetAsync($"/api/admin/lessons/{versionId}/ai/draft");
            Assert(latest.StatusCode == HttpStatusCode.OK &&
                (await latest.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid() == draftId,
                "latest_existing_draft_not_found");
            using var premature = await adminClient.PostAsJsonAsync(url + "/approve",
                new { expectedRevision = draftRevision });
            Assert(premature.StatusCode == HttpStatusCode.Conflict &&
                (await premature.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString() ==
                "review_incomplete", "unreviewed_content_approved");
            using var saved = await adminClient.PutAsJsonAsync(url, new { expectedRevision = draftRevision,
                material = reviewed with { ReviewedStages = ["vocabulary", "listen-type", "quiz", "conversation"] } });
            Assert(saved.StatusCode == HttpStatusCode.OK, "review_decisions_not_saved");
            var nextRevision = (await saved.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("revision").GetGuid();
            using var approved = await adminClient.PostAsJsonAsync(url + "/approve",
                new { expectedRevision = nextRevision });
            Assert(approved.StatusCode == HttpStatusCode.OK, "reviewed_content_not_approved");
            using var retry = await adminClient.PostAsJsonAsync(url + "/approve",
                new { expectedRevision = nextRevision });
            Assert(retry.StatusCode == HttpStatusCode.OK, "approval_retry_not_idempotent");
            using var noDraft = await adminClient.GetAsync($"/api/admin/lessons/{versionId}/ai/draft");
            var noDraftBody = (await noDraft.Content.ReadAsStringAsync()).Trim();
            Assert(noDraft.StatusCode == HttpStatusCode.NoContent ||
                (noDraft.StatusCode == HttpStatusCode.OK &&
                    (noDraftBody == "null" || noDraftBody.Length == 0)),
                $"approved_content_still_returned_as_draft status={noDraft.StatusCode} body={noDraftBody}");
            using var approvedScope = app.Services.CreateScope();
            var approvedDb = approvedScope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
            var approvedRow = await approvedDb.LessonAiContents.AsNoTracking().SingleAsync(x => x.Id == draftId);
            Assert(approvedRow.Status == "Approved" && approvedRow.ApprovedAtUtc is not null,
                "approval_status_or_timestamp_not_persisted");
        });
        await check("Admin workflow is protected, read-only on open, and concurrency safe", async () =>
        {
            var route = $"/api/admin/lessons/{versionId}/workflow";
            using var anonymous = app.Client();
            using var anonymousResponse = await anonymous.GetAsync(route);
            Assert(anonymousResponse.StatusCode == HttpStatusCode.Unauthorized,
                "anonymous_workflow_access_allowed");
            using var studentResponse = await studentClient.GetAsync(route);
            Assert(studentResponse.StatusCode == HttpStatusCode.Forbidden,
                "student_workflow_access_allowed");

            using var opened = await adminClient.GetAsync(route);
            Assert(opened.StatusCode == HttpStatusCode.OK, "workflow_defaults_missing");
            var openedJson = await opened.Content.ReadFromJsonAsync<JsonElement>();
            Assert(openedJson.GetProperty("revision").GetGuid() == Guid.Empty &&
                openedJson.GetProperty("stages").GetArrayLength() == 8,
                "workflow_defaults_invalid");
            using (var scope = app.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
                Assert(await db.LessonWorkflows.CountAsync(x => x.LessonVersionId == versionId) == 0,
                    "workflow_open_created_hidden_write");
            }

            var stages = openedJson.GetProperty("stages").Clone();
            var csrf = adminClient.DefaultRequestHeaders.GetValues("X-XSRF-TOKEN").Single();
            adminClient.DefaultRequestHeaders.Remove("X-XSRF-TOKEN");
            using var missingCsrf = await adminClient.PutAsJsonAsync(route,
                new { expectedRevision = Guid.Empty, stages });
            adminClient.DefaultRequestHeaders.Add("X-XSRF-TOKEN", csrf);
            Assert(missingCsrf.StatusCode == HttpStatusCode.BadRequest,
                "workflow_write_without_csrf_allowed");

            using var saved = await adminClient.PutAsJsonAsync(route,
                new { expectedRevision = Guid.Empty, stages });
            Assert(saved.StatusCode == HttpStatusCode.OK, "workflow_not_saved");
            var savedJson = await saved.Content.ReadFromJsonAsync<JsonElement>();
            Assert(savedJson.GetProperty("revision").GetGuid() != Guid.Empty,
                "workflow_revision_not_rotated");
            using var stale = await adminClient.PutAsJsonAsync(route,
                new { expectedRevision = Guid.Empty, stages });
            Assert(stale.StatusCode == HttpStatusCode.Conflict &&
                (await stale.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString() ==
                "workflow_changed", "stale_workflow_write_allowed");
        });
        await check("Enabled stages with missing data block approval and name the stage", async () =>
        {
            var incompleteId = Guid.NewGuid(); var incompleteRevision = Guid.NewGuid();
            using (var scope = app.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
                var admin = (await scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>()
                    .FindByEmailAsync("admin@v2-test.invalid"))!;
                db.LessonAiContents.Add(new LessonAiContent { Id = incompleteId, LessonVersionId = versionId,
                    CreatedByAdminId = admin.Id, Revision = incompleteRevision, Status = "Draft",
                    PayloadJson = JsonSerializer.Serialize(material with { ReviewedStages =
                        ["vocabulary", "listen-type", "grammar", "vocabulary-quiz", "grammar-quiz",
                            "word-order", "conversation"] }, LessonMaterialRules.Json),
                    CreatedAtUtc = DateTimeOffset.UtcNow, UpdatedAtUtc = DateTimeOffset.UtcNow });
                await db.SaveChangesAsync();
            }
            using var response = await adminClient.PostAsJsonAsync(
                $"/api/admin/lessons/{versionId}/ai/{incompleteId}/approve",
                new { expectedRevision = incompleteRevision });
            var body = await response.Content.ReadFromJsonAsync<JsonElement>();
            Assert(response.StatusCode == HttpStatusCode.Conflict &&
                body.GetProperty("error").GetString() == "review_incomplete" &&
                body.GetProperty("missingStages").EnumerateArray()
                    .Any(x => x.GetString() == "listen-type"),
                "missing_enabled_stage_not_reported");
            using var verifyScope = app.Services.CreateScope();
            var verifyDb = verifyScope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
            Assert((await verifyDb.LessonAiContents.AsNoTracking()
                .SingleAsync(x => x.Id == incompleteId)).Status == "Draft",
                "incomplete_draft_was_approved");
        });
        await check("Only the assigned student sees reviewed material, without quiz answers", async () =>
        {
            using var wrongStudent = await other.GetAsync(path + "/ai-material");
            Assert(wrongStudent.StatusCode == HttpStatusCode.NotFound, "cross_group_material_leak");
            using var forbidden = await adminClient.GetAsync(path + "/ai-material");
            Assert(forbidden.StatusCode == HttpStatusCode.Forbidden, "admin_student_scope_leak");
            using var response = await studentClient.GetAsync(path + "/ai-material");
            Assert(response.StatusCode == HttpStatusCode.OK, "published_ai_material_missing");
            var json = await response.Content.ReadFromJsonAsync<JsonElement>();
            Assert(json.GetProperty("vocabulary")[0].GetProperty("word").GetString() == "hello" &&
                !json.GetProperty("quiz")[0].TryGetProperty("correctIndex", out _) &&
                json.GetProperty("progress").GetProperty("vocabulary").GetInt32() == 0,
                "material_answer_or_progress_invalid");
        });
        await check("Stages enforce sequence, persisted feedback, and idempotent retries", async () =>
        {
            using var locked = await studentClient.PostAsJsonAsync(path + "/listen-type/answers",
                new { requestId = Guid.NewGuid(), position = 1, answer = "Hello world" });
            Assert(locked.StatusCode == HttpStatusCode.Conflict, "dictation_unlocked_early");
            using var word = await studentClient.PutAsJsonAsync(path + "/vocabulary/progress", new { position = 1 });
            Assert(word.StatusCode == HttpStatusCode.OK, "vocabulary_not_saved");
            var requestId = Guid.NewGuid();
            using var wrong = await studentClient.PostAsJsonAsync(path + "/listen-type/answers",
                new { requestId, position = 1, answer = "Hello Mars" });
            Assert(wrong.StatusCode == HttpStatusCode.OK &&
                !(await wrong.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("correct").GetBoolean(),
                "wrong_dictation_accepted");
            var correctId = Guid.NewGuid();
            using var correct = await studentClient.PostAsJsonAsync(path + "/listen-type/answers",
                new { requestId = correctId, position = 1, answer = "Hello world" });
            Assert(correct.StatusCode == HttpStatusCode.OK &&
                (await correct.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("correct").GetBoolean(),
                "correct_dictation_not_saved");
            using var retry = await studentClient.PostAsJsonAsync(path + "/listen-type/answers",
                new { requestId = correctId, position = 1, answer = "Hello world" });
            Assert(retry.StatusCode == HttpStatusCode.OK, "dictation_retry_failed");
            using var quiz = await studentClient.PostAsJsonAsync(path + "/quiz/answers",
                new { requestId = Guid.NewGuid(), position = 1, optionIndex = 1 });
            Assert(quiz.StatusCode == HttpStatusCode.OK &&
                (await quiz.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("correct").GetBoolean(),
                "quiz_score_not_saved");
            using var chat = await studentClient.PostAsJsonAsync(path + "/conversation/turns",
                new { requestId = Guid.NewGuid(), message = "Hello!" });
            Assert(chat.StatusCode == HttpStatusCode.ServiceUnavailable, "chat_without_keys_did_not_fail_safely");
        });
        await check("V1 stages pin selected dictation and word-order answers to the published slot", async () =>
        {
            var reviewSlot = Guid.NewGuid(); var reviewContent = Guid.NewGuid();
            var reviewed = material with
            {
                Vocabulary = [material.Vocabulary[0], new VocabularyCard("Hello world", "تحية",
                    "Hello world", "مرحبًا بالعالم", Kind: "chunk")],
                Quiz = [new QuizCard("Arrange", ["Hello", "from", "here"], 0, "ترتيب الجملة",
                    Type: "word-order", CorrectAnswer: "Hello from here")],
                Dictation = [new DictationCard(1, false, ["Hello world"]),
                    new DictationCard(2, true, ["Hello from here"], "ابدأ بالتحية")],
                ShadowingReviewEnabled = true
            };
            using (var scope = app.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
                var student = (await scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>()
                    .FindByEmailAsync("student@v2-test.invalid"))!;
                db.LessonSegments.Add(new LessonSegment { Id = Guid.NewGuid(), LessonVersionId = versionId,
                    Position = 2, Text = "Hello from here", AudioStorageKey = "lesson-ai-test-2.wav" });
                db.LessonAiContents.Add(new LessonAiContent { Id = reviewContent, LessonVersionId = versionId,
                    CreatedByAdminId = (await scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>()
                        .FindByEmailAsync("admin@v2-test.invalid"))!.Id, Revision = Guid.NewGuid(),
                    Status = "Approved", PayloadJson = JsonSerializer.Serialize(reviewed, LessonMaterialRules.Json),
                    CreatedAtUtc = DateTimeOffset.UtcNow, UpdatedAtUtc = DateTimeOffset.UtcNow });
                db.PublishedLessonSlots.Add(new PublishedLessonSlot { Id = reviewSlot,
                    PublishedCurriculumVersionId = publishedId, LessonVersionId = versionId,
                    AiContentId = reviewContent, WeekNumber = 1, DayNumber = 2, SortOrder = 1,
                    AvailableAtUtc = DateTimeOffset.UtcNow.AddMinutes(-1) });
                db.StudentStageProgress.Add(new StudentStageProgress { StudentId = student.Id,
                    PublishedCurriculumVersionId = publishedId, SlotId = reviewSlot, StageKey = "shadowing",
                    CompletedSegments = 2, IsComplete = true, UpdatedAtUtc = DateTimeOffset.UtcNow });
                await db.SaveChangesAsync();
            }
            var reviewPath = $"/api/student/learning/slots/{reviewSlot}";
            using var load = await studentClient.GetAsync(reviewPath + "/ai-material");
            Assert(load.StatusCode == HttpStatusCode.OK, "review_material_missing");
            var body = await load.Content.ReadFromJsonAsync<JsonElement>();
            Assert(body.GetProperty("vocabulary").GetArrayLength() == 2 &&
                body.GetProperty("dictation").GetArrayLength() == 1 &&
                body.GetProperty("dictation")[0].GetProperty("segmentPosition").GetInt32() == 2 &&
                body.GetProperty("quiz")[0].GetProperty("type").GetString() == "word-order" &&
                !body.GetProperty("quiz")[0].TryGetProperty("correctAnswer", out _),
                "unselected_sentence_or_quiz_answer_leaked");
            for (var n = 1; n <= 2; n++)
            {
                using var vocab = await studentClient.PutAsJsonAsync(reviewPath + "/vocabulary/progress",
                    new { position = n });
                Assert(vocab.IsSuccessStatusCode, "chunk_progress_failed");
            }
            using var locked = await studentClient.PostAsJsonAsync(reviewPath + "/listen-type/answers",
                new { requestId = Guid.NewGuid(), position = 1, answer = "Hello from here" });
            Assert(locked.StatusCode == HttpStatusCode.Conflict, "review_stage_skipped");
            for (var n = 1; n <= 2; n++)
            {
                using var progress = await studentClient.PutAsJsonAsync(reviewPath + "/shadowing-review/progress",
                    new { position = n });
                Assert(progress.IsSuccessStatusCode, "second_shadowing_not_saved");
            }
            using var dictation = await studentClient.PostAsJsonAsync(reviewPath + "/listen-type/answers",
                new { requestId = Guid.NewGuid(), position = 1, answer = "Hello from here" });
            Assert(dictation.IsSuccessStatusCode &&
                (await dictation.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("correct").GetBoolean(),
                "selected_sentence_not_scored");
            using var quiz = await studentClient.PostAsJsonAsync(reviewPath + "/quiz/answers",
                new { requestId = Guid.NewGuid(), position = 1, answer = "Hello from here" });
            Assert(quiz.IsSuccessStatusCode &&
                (await quiz.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("correct").GetBoolean(),
                "word_order_not_scored");
        });
        await check("Approved material cannot be edited through the admin endpoint", async () =>
        {
            using var edit = await adminClient.PutAsJsonAsync(
                $"/api/admin/lessons/{versionId}/ai/{contentId}", new { expectedRevision = revision, material });
            Assert(edit.StatusCode == HttpStatusCode.Conflict, "approved_material_edited");
        });
        return failures() == 0 ? 0 : 1;
    }

    private sealed class StubAiClientFactory(HttpClient client) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => client;
    }
    private sealed class StubAiHandler(Func<HttpRequestMessage, HttpResponseMessage> response) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellation) =>
            Task.FromResult(response(request));
    }
}
