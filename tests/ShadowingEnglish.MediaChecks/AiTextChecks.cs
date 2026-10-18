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
            var noSelectedDictation = v1 with { Dictation = v1.Dictation!
                .Select(item => item with { Enabled = false }).ToArray() };
            Assert(LessonMaterialRules.Valid(noSelectedDictation, "Hello world\nHello from here", [1, 2]) &&
                LessonMaterialRules.HasStageCandidates(noSelectedDictation, "listen-type") &&
                !LessonMaterialRules.HasStageData(noSelectedDictation, "listen-type"),
                "cleared_sentence_selection_cannot_remain_a_draft");
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
                [new LessonTranscriptSegment(1, new string('a', 601))])?.Dictation is null,
                "non_dictation_lesson_should_not_require_audio_activity");
            Assert(prepared is not null && !LessonMaterialRules.ReadyToApprove(prepared),
                "unreviewed_generated_draft_can_be_approved");
            return Task.CompletedTask;
        });
        await check("A1 dictation modes keep teacher audio and validate the selected word", () =>
        {
            LessonTranscriptSegment[] segments = [new(1, "I go to school every day.")];
            var suggested = LessonMaterialRules.SuggestedDictation(1, segments[0].Text, "A1", true);
            Assert(suggested.Mode == "missing-word" && suggested.TargetWordIndex == 3 &&
                suggested.AcceptedAnswers?.SequenceEqual(["school"]) == true &&
                LessonMaterialRules.DictationPrompt(suggested, segments[0].Text) ==
                    "I go to _____ every day.", "a1_gap_suggestion_invalid");
            Assert(LessonMaterialRules.SuggestedDictation(2, "Hello", "A1", true).Mode ==
                "full-sentence", "single_word_mode_still_generated");
            var gap = material with { Vocabulary = [], Dictation = [suggested] };
            Assert(LessonMaterialRules.Valid(gap, segments[0].Text, [1]) &&
                LessonMaterialRules.ValidDictationForSegments(gap, segments),
                "a1_gap_rejected");
            Assert(!LessonMaterialRules.ValidDictationForSegments(gap with { Dictation =
                [suggested with { AcceptedAnswers = ["wrong"] }] }, segments),
                "unheard_gap_answer_accepted");
            var changedTarget = gap with { Dictation =
                [suggested with { TargetWordIndex = 4, AcceptedAnswers = ["school"] }] };
            var normalized = LessonMaterialRules.WithSelectedDictationAnswers(changedTarget, segments);
            Assert(normalized.Dictation?[0].AcceptedAnswers?.SequenceEqual(["every"]) == true &&
                LessonMaterialRules.ValidDictationForSegments(normalized, segments),
                "teacher_selected_word_not_saved_as_answer");
            var order = suggested with { Mode = "word-order", TargetWordIndex = null,
                AcceptedAnswers = [segments[0].Text] };
            Assert(LessonMaterialRules.ValidDictationForSegments(gap with { Dictation = [order] }, segments) &&
                !LessonMaterialRules.DictationWordOptions(segments[0].Text)
                    .SequenceEqual(["I", "go", "to", "school", "every", "day"]),
                "word_order_not_prepared");
            var normalizedOrder = LessonMaterialRules.WithSelectedDictationAnswers(
                gap with { Dictation = [order with { AcceptedAnswers = ["wrong order"] }] }, segments);
            Assert(normalizedOrder.Dictation?[0].AcceptedAnswers?.SequenceEqual([segments[0].Text]) == true,
                "word_order_answer_not_derived_from_transcript");
            var word = suggested with { Mode = "single-word", AudioStartSeconds = 1.2,
                AudioEndSeconds = 1.8 };
            Assert(LessonMaterialRules.ValidDictationForSegments(gap with { Dictation = [word] }, segments) &&
                !LessonMaterialRules.ValidDictationForSegments(gap with { Dictation =
                    [word with { AudioEndSeconds = null }] }, segments),
                "single_word_clip_validation_failed");
            Assert(LessonMaterialRules.Parse(JsonSerializer.Serialize(gap with { Dictation =
                [new DictationCard(1, true, [segments[0].Text])] }, LessonMaterialRules.Json),
                segments[0].Text, [1])?.Dictation?[0].Mode == "full-sentence",
                "legacy_full_sentence_mode_changed");
            return Task.CompletedTask;
        });
        await check("Generating one stage preserves reviewed edits in the other stages", () =>
        {
            const string source = "Hello world";
            LessonTranscriptSegment[] segments = [new(1, source)];
            const string vocabularyJson = """
                {"vocabulary":[{"word":"Hello","meaningAr":"مرحبًا","exampleEn":"Hello world","exampleAr":"مرحبًا بالعالم"}]}
                """;
            var vocabulary = LessonMaterialRules.MergeStageGenerated("vocabulary", vocabularyJson,
                LessonMaterialRules.EmptyDraft(), source, segments);
            Assert(vocabulary?.Vocabulary.Length == 1 && vocabulary.Quiz.Length == 0 &&
                vocabulary.GrammarFocus == "", "vocabulary_generation_touched_other_stages");
            var reviewed = vocabulary! with { ReviewedStages = ["vocabulary"], Vocabulary =
                [vocabulary.Vocabulary[0] with { ImageUrl = "https://example.invalid/teacher-choice.jpg" }] };
            var grammar = LessonMaterialRules.MergeStageGenerated("grammar",
                "{\"grammarFocus\":\"Use a greeting in a short sentence.\"}",
                reviewed, source, segments);
            Assert(grammar?.GrammarFocus == "Use a greeting in a short sentence." &&
                grammar.Vocabulary[0].ImageUrl == "https://example.invalid/teacher-choice.jpg" &&
                grammar.ReviewedStages?.SequenceEqual(["vocabulary"]) == true,
                "grammar_regeneration_lost_vocabulary_edits_or_review");
            var conversationFocused = reviewed with
            {
                ConversationTargetWords = ["Hello"],
                ReviewedStages = ["vocabulary", "conversation"]
            };
            var newVocabulary = LessonMaterialRules.MergeStageGenerated("vocabulary",
                "{\"vocabulary\":[{\"word\":\"world\",\"meaningAr\":\"العالم\",\"exampleEn\":\"Hello world\",\"exampleAr\":\"مرحبًا بالعالم\"}]}",
                conversationFocused, source, segments);
            Assert(newVocabulary is not null &&
                newVocabulary.Vocabulary.Any(card => card.Word == "Hello" &&
                    card.ImageUrl == "https://example.invalid/teacher-choice.jpg") &&
                newVocabulary.ReviewedStages?.SequenceEqual(["conversation"]) == true,
                "vocabulary_regeneration_broke_teacher_conversation_focus");
            return Task.CompletedTask;
        });
        await check("SQL Server migration metadata matches the current AI model", () =>
        {
            var options = new DbContextOptionsBuilder<ApplicationDbContext>()
                .UseSqlServer("Server=127.0.0.1;Database=NeverConnected;Integrated Security=true;").Options;
            using var model = new ApplicationDbContext(options);
            Assert(!model.Database.HasPendingModelChanges(), "ai_model_snapshot_is_stale");
            Assert(model.Database.GetMigrations().Last() == "20261016090000_AddLessonAiStageType",
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
        await check("Vocabulary count survives material serialization", () =>
        {
            var configured = material with { VocabularyTargetCount = 7 };
            var restored = JsonSerializer.Deserialize<LessonMaterial>(
                JsonSerializer.Serialize(configured, LessonMaterialRules.Json), LessonMaterialRules.Json);
            Assert(restored?.VocabularyTargetCount == 7 &&
                LessonMaterialRules.Valid(restored, "Hello world"), "vocabulary_count_not_persisted");
            return Task.CompletedTask;
        });
        await check("Vocabulary audio stays student-scoped and requires a configured natural voice", async () =>
        {
            using var outsider = await other.GetAsync(path + "/vocabulary/audio?position=1&part=word");
            Assert(outsider.StatusCode == HttpStatusCode.NotFound, "vocabulary_audio_leaked_to_other_student");
            using var configured = await studentClient.GetAsync(path + "/vocabulary/audio?position=1&part=word");
            Assert(configured.StatusCode == HttpStatusCode.ServiceUnavailable,
                "vocabulary_audio_should_require_voice_provider");
        });
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
                material = reviewed with { Dictation = [new DictationCard(1, true, ["hello"],
                    Mode: "missing-word", TargetWordIndex: 1)],
                    ReviewedStages = ["vocabulary", "listen-type", "quiz", "conversation"] } });
            Assert(saved.StatusCode == HttpStatusCode.OK, "review_decisions_not_saved");
            var savedBody = await saved.Content.ReadFromJsonAsync<JsonElement>();
            Assert(savedBody.GetProperty("material").GetProperty("dictation")[0]
                .GetProperty("acceptedAnswers")[0].GetString() == "world",
                "teacher_selected_word_not_persisted_by_save");
            var nextRevision = savedBody.GetProperty("revision").GetGuid();
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
        await check("Listen-and-type starts on demand and preserves other reviewed stages", async () =>
        {
            using var legacy = await adminClient.PostAsJsonAsync(
                $"/api/admin/lessons/{versionId}/ai", new { requestId = Guid.NewGuid() });
            Assert((int)legacy.StatusCode == 410, "legacy_bulk_generation_still_enabled");
            var requestId = Guid.NewGuid();
            using var queued = await adminClient.PostAsJsonAsync(
                $"/api/admin/lessons/{versionId}/ai/stages/listen-type/generate",
                new { requestId });
            Assert(queued.StatusCode == HttpStatusCode.Accepted,
                "stage_generation_not_queued_without_ai_provider");
            LessonAiContent? completed = null;
            for (var attempt = 0; attempt < 60; attempt++)
            {
                using var scope = app.Services.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
                completed = await db.LessonAiContents.AsNoTracking()
                    .SingleAsync(x => x.Id == requestId);
                if (completed.Status is "Draft" or "Failed") break;
                await Task.Delay(100);
            }
            Assert(completed?.Status == "Draft" && completed.StageType == "listen-type",
                "stage_generation_not_completed");
            var generated = JsonSerializer.Deserialize<LessonMaterial>(completed!.PayloadJson!, LessonMaterialRules.Json);
            Assert(generated?.Dictation is { Length: 1 } &&
                generated.Vocabulary[0].Word == "hello" &&
                generated.ReviewedStages?.Contains("vocabulary") == true &&
                generated.ReviewedStages.Contains("listen-type") == false,
                "stage_generation_changed_other_reviewed_content");
            using var statuses = await adminClient.GetAsync(
                $"/api/admin/lessons/{versionId}/ai/stages/statuses");
            var statusJson = await statuses.Content.ReadFromJsonAsync<JsonElement>();
            Assert(statuses.StatusCode == HttpStatusCode.OK &&
                statusJson.GetProperty("listen-type").GetString() == "NeedsReview",
                "generated_stage_not_marked_for_review");
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
                    new DictationCard(2, true, ["from"], "الكلمة بين Hello وhere",
                        Mode: "missing-word", TargetWordIndex: 1),
                    new DictationCard(3, true, ["A text-only sentence"])],
                ShadowingReviewEnabled = true
            };
            using (var scope = app.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
                var student = (await scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>()
                    .FindByEmailAsync("student@v2-test.invalid"))!;
                db.LessonSegments.Add(new LessonSegment { Id = Guid.NewGuid(), LessonVersionId = versionId,
                    Position = 2, Text = "Hello from here", AudioStorageKey = "lesson-ai-test-2.wav" });
                db.LessonSegments.Add(new LessonSegment { Id = Guid.NewGuid(), LessonVersionId = versionId,
                    Position = 3, Text = "A text-only sentence" });
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
            using var adminSegments = await adminClient.GetAsync($"/api/admin/lessons/{versionId}/ai/segments");
            var segmentPreview = await adminSegments.Content.ReadFromJsonAsync<JsonElement>();
            Assert(adminSegments.IsSuccessStatusCode && segmentPreview.EnumerateArray()
                .Any(x => x.GetProperty("position").GetInt32() == 2 &&
                    x.GetProperty("audioUrl").GetString() ==
                    $"/api/admin/shadowing/lessons/versions/{versionId}/segments/2/audio") &&
                segmentPreview.EnumerateArray().Any(x => x.GetProperty("position").GetInt32() == 3 &&
                    x.GetProperty("audioUrl").ValueKind == JsonValueKind.Null),
                "admin_preview_audio_not_teacher_segment");
            using var load = await studentClient.GetAsync(reviewPath + "/ai-material");
            Assert(load.StatusCode == HttpStatusCode.OK, "review_material_missing");
            var body = await load.Content.ReadFromJsonAsync<JsonElement>();
            Assert(body.GetProperty("vocabulary").GetArrayLength() == 2 &&
                body.GetProperty("dictation").GetArrayLength() == 1 &&
                body.GetProperty("dictation")[0].GetProperty("segmentPosition").GetInt32() == 2 &&
                body.GetProperty("dictation")[0].GetProperty("mode").GetString() == "missing-word" &&
                body.GetProperty("dictation")[0].GetProperty("promptText").GetString() == "Hello _____ here" &&
                body.GetProperty("dictation")[0].GetProperty("audioUrl").GetString() ==
                    $"/api/student/learning/slots/{reviewSlot}/segments/2/audio" &&
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
                new { requestId = Guid.NewGuid(), position = 1, answer = "from" });
            Assert(locked.StatusCode == HttpStatusCode.Conflict, "review_stage_skipped");
            for (var n = 1; n <= 3; n++)
            {
                using var progress = await studentClient.PutAsJsonAsync(reviewPath + "/shadowing-review/progress",
                    new { position = n });
                Assert(progress.IsSuccessStatusCode, "second_shadowing_not_saved");
            }
            using var dictation = await studentClient.PostAsJsonAsync(reviewPath + "/listen-type/answers",
                new { requestId = Guid.NewGuid(), position = 1, answer = "from" });
            var dictationResponse = await dictation.Content.ReadAsStringAsync();
            Assert(dictation.IsSuccessStatusCode &&
                JsonDocument.Parse(dictationResponse).RootElement.GetProperty("correct").GetBoolean(),
                $"selected_sentence_not_scored_status_{(int)dictation.StatusCode}_{dictationResponse}");
            using var quiz = await studentClient.PostAsJsonAsync(reviewPath + "/quiz/answers",
                new { requestId = Guid.NewGuid(), position = 1, answer = "Hello from here" });
            Assert(quiz.IsSuccessStatusCode &&
                (await quiz.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("correct").GetBoolean(),
                "word_order_not_scored");
        });
        await check("Dictation defers wrong answers and persists review until every item is correct", async () =>
        {
            var reviewSlot = Guid.NewGuid(); var reviewContent = Guid.NewGuid();
            var reviewed = material with { Dictation =
                [new DictationCard(1, true, ["Hello world"]),
                    new DictationCard(2, true, ["Hello from here"]) ] };
            using (var scope = app.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
                var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
                var student = (await users.FindByEmailAsync("student@v2-test.invalid"))!;
                var admin = (await users.FindByEmailAsync("admin@v2-test.invalid"))!;
                var now = DateTimeOffset.UtcNow;
                db.LessonAiContents.Add(new LessonAiContent { Id = reviewContent,
                    LessonVersionId = versionId, CreatedByAdminId = admin.Id, Revision = Guid.NewGuid(),
                    Status = "Approved", PayloadJson = JsonSerializer.Serialize(reviewed, LessonMaterialRules.Json),
                    CreatedAtUtc = now, UpdatedAtUtc = now });
                db.PublishedLessonSlots.Add(new PublishedLessonSlot { Id = reviewSlot,
                    PublishedCurriculumVersionId = publishedId, LessonVersionId = versionId,
                    AiContentId = reviewContent, WeekNumber = 1, DayNumber = 3, SortOrder = 1,
                    AvailableAtUtc = now.AddMinutes(-1) });
                db.StudentStageProgress.AddRange(
                    new StudentStageProgress { StudentId = student.Id,
                        PublishedCurriculumVersionId = publishedId, SlotId = reviewSlot,
                        StageKey = "shadowing", CompletedSegments = 2, IsComplete = true, UpdatedAtUtc = now },
                    new StudentStageProgress { StudentId = student.Id,
                        PublishedCurriculumVersionId = publishedId, SlotId = reviewSlot,
                        StageKey = "vocabulary", CompletedSegments = 1, IsComplete = true, UpdatedAtUtc = now });
                await db.SaveChangesAsync();
            }
            var reviewPath = $"/api/student/learning/slots/{reviewSlot}";
            async Task<JsonElement> Answer(int position, string answer)
            {
                using var response = await studentClient.PostAsJsonAsync(reviewPath + "/listen-type/answers",
                    new { requestId = Guid.NewGuid(), position, answer });
                Assert(response.StatusCode == HttpStatusCode.OK,
                    $"dictation_review_answer_failed_{position}_{(int)response.StatusCode}");
                return await response.Content.ReadFromJsonAsync<JsonElement>();
            }
            var first = await Answer(1, "wrong");
            Assert(!first.GetProperty("correct").GetBoolean() &&
                first.GetProperty("expected").GetString() == "Hello world" &&
                first.GetProperty("nextPosition").GetInt32() == 2 &&
                first.GetProperty("reviewRemaining").GetInt32() == 1 &&
                first.GetProperty("attemptCount").GetInt32() == 1,
                "wrong_answer_did_not_queue_after_basic_items");
            using var reload = await studentClient.GetAsync(reviewPath + "/ai-material");
            var reloaded = await reload.Content.ReadFromJsonAsync<JsonElement>();
            Assert(reloaded.GetProperty("dictationState").GetProperty("nextPosition").GetInt32() == 2,
                "dictation_queue_lost_on_reload");
            var second = await Answer(2, "wrong again");
            Assert(!second.GetProperty("correct").GetBoolean() &&
                second.GetProperty("nextPosition").GetInt32() == 1 &&
                second.GetProperty("masteredCount").GetInt32() == 0 &&
                second.GetProperty("reviewRemaining").GetInt32() == 2 &&
                second.GetProperty("isReviewRound").GetBoolean() &&
                second.GetProperty("attemptCount").GetInt32() == 2,
                "review_did_not_start_after_basic_pass");
            using var quizBeforeReview = await studentClient.PostAsJsonAsync(reviewPath + "/quiz/answers",
                new { requestId = Guid.NewGuid(), position = 1, optionIndex = 1 });
            Assert(quizBeforeReview.StatusCode == HttpStatusCode.Conflict,
                "next_stage_opened_before_dictation_review_finished");
            var repeat = await Answer(1, "still wrong");
            Assert(!repeat.GetProperty("correct").GetBoolean() &&
                repeat.GetProperty("nextPosition").GetInt32() == 2 &&
                repeat.GetProperty("attemptCount").GetInt32() == 3,
                "wrong_review_item_was_not_moved_to_end");
            var secondMastered = await Answer(2, "Hello from here");
            Assert(secondMastered.GetProperty("correct").GetBoolean() &&
                secondMastered.GetProperty("nextPosition").GetInt32() == 1 &&
                secondMastered.GetProperty("masteredCount").GetInt32() == 1 &&
                secondMastered.GetProperty("reviewRemaining").GetInt32() == 1,
                "correct_review_item_was_not_removed");
            var finished = await Answer(1, "Hello world");
            Assert(finished.GetProperty("correct").GetBoolean() &&
                finished.GetProperty("nextPosition").ValueKind == JsonValueKind.Null &&
                finished.GetProperty("masteredCount").GetInt32() == 2 &&
                finished.GetProperty("attemptCount").GetInt32() == 5,
                "review_did_not_complete_after_correct_answer");
        });
        await check("Approved material cannot be edited through the admin endpoint", async () =>
        {
            using var edit = await adminClient.PutAsJsonAsync(
                $"/api/admin/lessons/{versionId}/ai/{contentId}", new { expectedRevision = revision, material });
            Assert(edit.StatusCode == HttpStatusCode.Conflict,
                $"approved_material_edited_status_{(int)edit.StatusCode}");
        });
        await check("Reopening an approved stage resumes the existing lesson draft", async () =>
        {
            Guid draftId; int before;
            using (var scope = app.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
                var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
                var editor = new ApplicationUser { Id = Guid.NewGuid(), Email = "editor@v2-test.invalid",
                    UserName = "editor@v2-test.invalid" };
                Assert((await users.CreateAsync(editor, app.Password)).Succeeded,
                    "second_admin_setup_failed");
                await users.AddToRoleAsync(editor, "Admin");
                draftId = await db.LessonAiContents.AsNoTracking()
                    .Where(x => x.LessonVersionId == versionId && x.Status == "Draft")
                    .OrderByDescending(x => x.CreatedAtUtc).ThenByDescending(x => x.Id)
                    .Select(x => x.Id).FirstAsync();
                before = await db.LessonAiContents.CountAsync(x => x.LessonVersionId == versionId);
            }
            using var editorClient = await app.LoginAsync("editor");
            using var reopened = await editorClient.PostAsJsonAsync(
                $"/api/admin/lessons/{versionId}/ai/{contentId}/reopen",
                new { requestId = Guid.NewGuid(), expectedRevision = revision });
            var body = await reopened.Content.ReadFromJsonAsync<JsonElement>();
            Assert(reopened.StatusCode == HttpStatusCode.OK &&
                body.GetProperty("id").GetGuid() == draftId &&
                body.GetProperty("status").GetString() == "Draft",
                "existing_draft_not_reused");
            using var verifyScope = app.Services.CreateScope();
            var verifyDb = verifyScope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
            Assert(await verifyDb.LessonAiContents.CountAsync(x => x.LessonVersionId == versionId) == before &&
                (await verifyDb.LessonAiContents.AsNoTracking().SingleAsync(x => x.Id == contentId)).Status ==
                "Approved", "reopen_changed_approved_or_created_duplicate");
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
