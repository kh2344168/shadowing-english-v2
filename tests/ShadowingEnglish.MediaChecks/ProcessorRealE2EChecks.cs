using System.Net;
using System.Net.Http.Json;
using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Diagnostics;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging.Abstractions;
using ShadowingEnglish.Core.Groups;
using ShadowingEnglish.Core.Learning;
using ShadowingEnglish.Api.Modules.AI;
using ShadowingEnglish.Api.Modules.Curriculums;
using ShadowingEnglish.Infrastructure.Database;
using ShadowingEnglish.Infrastructure.Identity;

namespace ShadowingEnglish.MediaChecks;

// Explicit local check. It uses an isolated SQL Server database and the unmodified result of
// the installed WhisperX processor. Neither the database nor its saved WAV files are removed.
internal static class ProcessorRealE2EChecks
{
    private static void Assert(bool condition, string reason)
    { if (!condition) throw new InvalidOperationException(reason); }

    public static async Task<int> RunAsync(string manifestPath, Func<string, Func<Task>, Task> check,
        Func<int> failures, int studentCount = 0, int concurrentStudents = 0, int maxConcurrency = 0,
        int republishAttempts = 1, int groupCount = 0, int groupStudents = 0, int groupAttempts = 0,
        int groupLessons = 1, bool probeReads = false)
    {
        var apiRoot = Path.GetFullPath(Path.Combine(Directory.GetCurrentDirectory(), "backend/ShadowingEnglish.Api"));
        var manifestFile = Path.GetFullPath(manifestPath);
        using var document = JsonDocument.Parse(await File.ReadAllBytesAsync(manifestFile));
        var manifest = document.RootElement;
        Assert(manifest.GetProperty("reviewRequired").GetBoolean(), "processor_review_not_required");
        var clips = manifest.GetProperty("segments");
        Assert(clips.GetArrayLength() == 1, "expected_one_real_processor_clip");
        var clip = clips[0];
        var text = clip.GetProperty("text").GetString()!;
        var fileName = clip.GetProperty("audioFile").GetString()!;
        Assert(Regex.IsMatch(fileName, "^segment-[0-9]{2}\\.wav$"), "unexpected_audio_file");
        var wave = await File.ReadAllBytesAsync(Path.Combine(Path.GetDirectoryName(manifestFile)!, fileName));
        Assert(Convert.ToHexStringLower(SHA256.HashData(wave)) == clip.GetProperty("sha256").GetString(),
            "processor_audio_hash_mismatch");

        var original = new ConfigurationBuilder().AddJsonFile(Path.Combine(apiRoot,
            "appsettings.Development.json")).Build().GetConnectionString("DefaultConnection")!;
        var connection = Regex.Replace(original,
            "(?i)(Database|Initial Catalog)=ShadowingEnglishV2(?=;|$)",
            "$1=ShadowingEnglishV2_ProcessorE2E_20261023");
        Assert(connection != original && connection.Contains("ShadowingEnglishV2_ProcessorE2E_20261023"),
            "refusing_nonisolated_database");
        var mediaRoot = Path.GetFullPath(Path.Combine(Directory.GetCurrentDirectory(),
            ".local/processor-e2e-20261023/media"));
        using var app = new SqlProcessorApp(apiRoot, connection, mediaRoot);
        await app.SetupAsync();
        using var admin = await app.LoginAsync("admin");
        using var student = await app.LoginAsync("student");

        var requestId = Guid.NewGuid();
        Guid versionId = Guid.Empty;
        Guid publishedId = Guid.Empty;
        Guid publishedSlotId = Guid.Empty;
        Guid curriculumId = Guid.Empty;
        Guid draftRevision = Guid.Empty;
        Guid assignmentRevision = Guid.Empty;
        await check("Installed processor WAV saves to real SQL and local media", async () =>
        {
            using var form = new MultipartFormDataContent
            {
                { new StringContent(requestId.ToString()), "requestId" },
                { new StringContent("Processor integration check"), "title" },
                { new StringContent("Real local WhisperX output"), "description" },
                { new StringContent("A1"), "level" },
                { new StringContent("Verify local processing"), "goal" },
                { new StringContent(JsonSerializer.Serialize(new[] { text })), "segments" }
            };
            form.Add(new ByteArrayContent(wave), "audio0", fileName);
            using var response = await admin.PostAsync("/api/admin/shadowing/lessons", form);
            Assert(response.StatusCode == HttpStatusCode.Created,
                "real_processor_save_status_" + (int)response.StatusCode);
            versionId = (await response.Content.ReadFromJsonAsync<JsonElement>())
                .GetProperty("versionId").GetGuid();
            using var scope = app.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
            Assert(await db.LessonSegments.AnyAsync(x => x.LessonVersionId == versionId && x.Text == text),
                "real_processor_segment_not_in_sql");
        });

        await check("Published real processor audio is available to its student", async () =>
        {
            Assert(versionId != Guid.Empty, "lesson_save_did_not_complete");
            curriculumId = Guid.NewGuid();
            using var created = await admin.PostAsJsonAsync("/api/admin/shadowing/curriculums",
                new { requestId = curriculumId, name = "Processor check", description = "" });
            Assert(created.StatusCode == HttpStatusCode.Created, "curriculum_create_failed");
            var revision = (await created.Content.ReadFromJsonAsync<JsonElement>())
                .GetProperty("draftRevision").GetGuid();
            using var saved = await admin.PutAsJsonAsync($"/api/admin/shadowing/curriculums/{curriculumId}", new
            {
                requestId = Guid.NewGuid(), expectedDraftRevision = revision,
                name = "Processor check", description = "",
                lessons = new[] { new { lessonVersionId = versionId, weekNumber = 1, dayNumber = 1, sortOrder = 1 } }
            });
            Assert(saved.StatusCode == HttpStatusCode.OK, "curriculum_update_failed");
            revision = (await saved.Content.ReadFromJsonAsync<JsonElement>())
                .GetProperty("draftRevision").GetGuid();
            draftRevision = revision;
            using var assigned = await admin.PutAsJsonAsync(
                $"/api/admin/shadowing/groups/{app.GroupId}/curriculum-assignment", new
                { requestId = Guid.NewGuid(), curriculumTemplateId = curriculumId,
                    expectedAssignmentRevision = Guid.Empty });
            Assert(assigned.StatusCode == HttpStatusCode.OK, "curriculum_assignment_failed");
            assignmentRevision = (await assigned.Content.ReadFromJsonAsync<JsonElement>())
                .GetProperty("assignmentRevision").GetGuid();
            using var published = await admin.PostAsJsonAsync("/api/admin/shadowing/curriculums/publish", new
            {
                requestId = Guid.NewGuid(), groupId = app.GroupId,
                curriculumTemplateId = curriculumId, expectedDraftRevision = revision,
                expectedAssignmentRevision = assignmentRevision, expectedVersionId = (Guid?)null
            });
            Assert(published.StatusCode == HttpStatusCode.Created, "curriculum_publish_failed");
            publishedId = (await published.Content.ReadFromJsonAsync<JsonElement>())
                .GetProperty("versionId").GetGuid();
            using var list = await student.GetAsync("/api/student/learning/curriculum");
            Assert(list.StatusCode == HttpStatusCode.OK, "student_curriculum_failed");
            var items = (await list.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("items");
            Assert(items.GetArrayLength() == 1, "published_processor_lesson_not_visible");
            var slotId = items[0].GetProperty("slotId").GetGuid();
            publishedSlotId = slotId;
            using var audio = await student.GetAsync(
                $"/api/student/learning/slots/{slotId}/segments/1/audio");
            Assert(audio.StatusCode == HttpStatusCode.OK &&
                (await audio.Content.ReadAsByteArrayAsync()).SequenceEqual(wave),
                "published_processor_audio_mismatch");
        });
        if (studentCount > 0)
            await RepublishLoadAsync(app, admin, studentCount, curriculumId, versionId,
                publishedId, publishedSlotId, draftRevision, assignmentRevision,
                republishAttempts, check);
        if (concurrentStudents > 0)
            await StudentLoadAsync(app, concurrentStudents, maxConcurrency, publishedSlotId, wave, check);
        if (groupCount > 0)
            await GroupRepublishLoadAsync(app, curriculumId, versionId, publishedId,
                publishedSlotId, groupCount, groupStudents, groupAttempts, groupLessons,
                probeReads, check);
        return failures() == 0 ? 0 : 1;
    }

    private static async Task GroupRepublishLoadAsync(SqlProcessorApp app, Guid curriculumId,
        Guid lessonVersionId, Guid firstVersionId, Guid firstSlotId, int groupCount,
        int studentsPerGroup, int attemptsPerStudent, int lessonCount, bool probeReads,
        Func<string, Func<Task>, Task> check)
    {
        var groups = new List<(Guid GroupId, Guid VersionId, Guid[] SlotIds)>();
        var readers = new List<(Guid GroupId, string Email)>();
        var readerPassword = "Read!9" + Guid.NewGuid().ToString("N");
        await check($"Seed {groupCount} isolated groups, {lessonCount} lessons and " +
            $"{groupCount * studentsPerGroup} students", async () =>
        {
            using var scope = app.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
            var original = await db.PublishedCurriculumVersions.AsNoTracking()
                .SingleAsync(x => x.Id == firstVersionId);
            var originalSlot = await db.PublishedLessonSlots.AsNoTracking()
                .SingleAsync(x => x.Id == firstSlotId);
            var originalSegment = await db.LessonSegments.AsNoTracking()
                .SingleAsync(x => x.LessonVersionId == lessonVersionId);
            var adminId = await db.StudyGroups.AsNoTracking().Where(x => x.Id == app.GroupId)
                .Select(x => x.CreatedByAdminId).SingleAsync();
            var studentRoleId = probeReads ? await db.Roles.AsNoTracking()
                .Where(x => x.NormalizedName == "STUDENT").Select(x => x.Id).SingleAsync() : Guid.Empty;
            var now = DateTimeOffset.UtcNow;
            var lessonIds = new List<Guid> { lessonVersionId };
            var firstSlotIds = new Guid[lessonCount];
            firstSlotIds[0] = firstSlotId;
            for (var index = 1; index < lessonCount; index++)
            {
                var definitionId = Guid.NewGuid();
                var extraLessonId = Guid.NewGuid();
                var slotId = Guid.NewGuid();
                lessonIds.Add(extraLessonId);
                firstSlotIds[index] = slotId;
                db.LessonDefinitions.Add(new LessonDefinition
                    { Id = definitionId, Title = $"Publisher extra lesson {index}" });
                db.LessonVersions.Add(new LessonVersion
                {
                    Id = extraLessonId, LessonDefinitionId = definitionId, VersionNumber = 1,
                    Title = $"Publisher extra lesson {index}", Description = "Load fixture",
                    LessonType = "clip", Level = "A1", Goal = "Measure republish", CreatedAtUtc = now
                });
                db.LessonSegments.Add(new LessonSegment
                {
                    Id = Guid.NewGuid(), LessonVersionId = extraLessonId, Position = 1,
                    Text = originalSegment.Text, AudioStorageKey = originalSegment.AudioStorageKey
                });
                db.CurriculumDraftLessonSlots.Add(new CurriculumDraftLessonSlot
                {
                    Id = Guid.NewGuid(), CurriculumTemplateId = curriculumId,
                    LessonVersionId = extraLessonId, WeekNumber = 1, DayNumber = 1,
                    SortOrder = index + 1
                });
                db.PublishedLessonSlots.Add(new PublishedLessonSlot
                {
                    Id = slotId, PublishedCurriculumVersionId = firstVersionId,
                    LessonVersionId = extraLessonId, AiContentId = null,
                    WorkflowStagesJson = originalSlot.WorkflowStagesJson,
                    WeekNumber = 1, DayNumber = 1, SortOrder = index + 1, AvailableAtUtc = now
                });
            }
            groups.Add((app.GroupId, firstVersionId, firstSlotIds));
            for (var number = 1; number < groupCount; number++)
            {
                var groupId = Guid.NewGuid();
                var versionId = Guid.NewGuid();
                var slotIds = lessonIds.Select(_ => Guid.NewGuid()).ToArray();
                groups.Add((groupId, versionId, slotIds));
                db.StudyGroups.Add(new StudyGroup
                {
                    Id = groupId, Name = $"Publisher load {number}", CreateRequestId = Guid.NewGuid(),
                    CreatedAtUtc = now, CreatedByAdminId = adminId,
                    AssignedCurriculumTemplateId = curriculumId,
                    CurriculumAssignmentRevision = Guid.NewGuid()
                });
                db.PublishedCurriculumVersions.Add(new PublishedCurriculumVersion
                {
                    Id = versionId, GroupId = groupId, CurriculumTemplateId = curriculumId,
                    SourceDraftRevision = original.SourceDraftRevision, VersionNumber = 1,
                    Title = original.Title, PublishedAtUtc = now, AvailableAtUtc = now
                });
                for (var index = 0; index < lessonCount; index++)
                {
                    db.PublishedLessonSlots.Add(new PublishedLessonSlot
                    {
                        Id = slotIds[index], PublishedCurriculumVersionId = versionId,
                        LessonVersionId = lessonIds[index],
                        AiContentId = index == 0 ? originalSlot.AiContentId : null,
                        WorkflowStagesJson = originalSlot.WorkflowStagesJson,
                        WeekNumber = 1, DayNumber = 1, SortOrder = index + 1, AvailableAtUtc = now
                    });
                }
                db.GroupCurriculumAssignments.Add(new GroupCurriculumAssignment
                    { GroupId = groupId, PublishedCurriculumVersionId = versionId });
            }
            await db.SaveChangesAsync();
            db.ChangeTracker.Clear();
            foreach (var (groupId, versionId, slotIds) in groups)
            {
                var accounts = Enumerable.Range(0, studentsPerGroup).Select(_ =>
                {
                    var email = "group-load-" + Guid.NewGuid().ToString("N") + "@processor-e2e.invalid";
                    return new ApplicationUser { Id = Guid.NewGuid(), Email = email, UserName = email,
                        NormalizedEmail = email.ToUpperInvariant(), NormalizedUserName = email.ToUpperInvariant() };
                }).ToArray();
                if (probeReads)
                {
                    var reader = accounts[0];
                    reader.EmailConfirmed = true;
                    reader.SecurityStamp = Guid.NewGuid().ToString("N");
                    reader.PasswordHash = new PasswordHasher<ApplicationUser>()
                        .HashPassword(reader, readerPassword);
                    db.Set<IdentityUserRole<Guid>>().Add(new IdentityUserRole<Guid>
                        { UserId = reader.Id, RoleId = studentRoleId });
                    readers.Add((groupId, reader.Email!));
                }
                db.Users.AddRange(accounts);
                db.StudentGroupMemberships.AddRange(accounts.Select(user => new StudentGroupMembership
                {
                    Id = Guid.NewGuid(), StudentId = user.Id, GroupId = groupId,
                    StartedAtUtc = now, AssignedByAdminId = adminId
                }));
                db.StudentStageProgress.AddRange(accounts.SelectMany(user =>
                    slotIds.Select(slotId => new StudentStageProgress
                {
                    StudentId = user.Id, PublishedCurriculumVersionId = versionId,
                    SlotId = slotId, StageKey = "shadowing", CompletedSegments = 1,
                    IsComplete = true, UpdatedAtUtc = now
                })));
                db.StudentPracticeAttempts.AddRange(accounts.SelectMany(user =>
                    slotIds.SelectMany(slotId =>
                        Enumerable.Range(1, attemptsPerStudent).Select(position => new StudentPracticeAttempt
                    {
                        Id = Guid.NewGuid(), StudentId = user.Id,
                        PublishedCurriculumVersionId = versionId, SlotId = slotId,
                        StageKey = "shadowing", Position = position, Answer = slotId.ToString("D"),
                        FeedbackJson = "{}", CreatedAtUtc = now
                    }))));
                await db.SaveChangesAsync();
                db.ChangeTracker.Clear();
            }
            var oldIds = groups.Select(x => x.VersionId).ToArray();
            Assert(await db.StudentStageProgress.CountAsync(x =>
                oldIds.Contains(x.PublishedCurriculumVersionId)) == groupCount * studentsPerGroup * lessonCount &&
                await db.StudentPracticeAttempts.CountAsync(x =>
                    oldIds.Contains(x.PublishedCurriculumVersionId)) ==
                    groupCount * studentsPerGroup * lessonCount * attemptsPerStudent,
                "group_load_seed_incomplete");
        });
        if (groups.Count != groupCount) return;

        var readClients = new List<(Guid GroupId, HttpClient Client)>();
        try
        {
        if (probeReads)
            await check($"Login {groupCount} independent student readers", async () =>
            {
                foreach (var (groupId, email) in readers)
                    readClients.Add((groupId, await app.LoginAsAsync(email, readerPassword,
                        refreshCsrfAfterLogin: false)));
            });

        await check($"Auto republish {groupCount} groups with {groupCount * studentsPerGroup} students", async () =>
        {
            using var scope = app.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
            var adminId = await db.StudyGroups.AsNoTracking().Where(x => x.Id == app.GroupId)
                .Select(x => x.CreatedByAdminId).SingleAsync();
            var now = DateTimeOffset.UtcNow;
            db.LessonAiContents.Add(new LessonAiContent
            {
                Id = Guid.NewGuid(), LessonVersionId = lessonVersionId,
                CreatedByAdminId = adminId, Revision = Guid.NewGuid(), Status = "Approved",
                PayloadJson = JsonSerializer.Serialize(new LessonMaterial([], [], "", "")
                    { ReviewedStages = [] }, LessonMaterialRules.Json),
                CreatedAtUtc = now, UpdatedAtUtc = now, ApprovedAtUtc = now
            });
            await db.SaveChangesAsync();
            db.ChangeTracker.Clear();
            var clock = Stopwatch.StartNew();
            var beforeMb = Process.GetCurrentProcess().WorkingSet64 / 1_048_576;
            var observed = new ConcurrentBag<(Guid GroupId, Guid VersionId, Guid[] SlotIds, long Ms)>();
            using var readStop = new CancellationTokenSource();
            var readerTasks = readClients.Select(async reader =>
            {
                while (!readStop.IsCancellationRequested)
                {
                    var readClock = Stopwatch.StartNew();
                    try
                    {
                        using var response = await reader.Client.GetAsync(
                            "/api/student/learning/curriculum?pageSize=20", readStop.Token);
                        Assert(response.StatusCode == HttpStatusCode.OK,
                            "republish_read_status_" + (int)response.StatusCode);
                        var payload = await response.Content.ReadFromJsonAsync<JsonElement>(readStop.Token);
                        var items = payload.GetProperty("items").EnumerateArray()
                            .Select(x => x.GetProperty("slotId").GetGuid()).ToArray();
                        Assert(items.Length == lessonCount && items.Distinct().Count() == lessonCount,
                            "republish_read_incomplete_curriculum");
                        observed.Add((reader.GroupId,
                            payload.GetProperty("publishedVersionId").GetGuid(),
                            items, readClock.ElapsedMilliseconds));
                        await Task.Delay(25, readStop.Token);
                    }
                    catch (OperationCanceledException) when (readStop.IsCancellationRequested) { break; }
                }
            }).ToArray();
            int published;
            try
            {
                published = await ApprovedLessonPublisher.SyncAsync(db, lessonVersionId,
                    NullLogger.Instance, CancellationToken.None);
            }
            finally
            {
                readStop.Cancel();
                await Task.WhenAll(readerTasks);
            }
            clock.Stop();
            var groupIds = groups.Select(x => x.GroupId).ToArray();
            var latestAssignments = await db.GroupCurriculumAssignments.AsNoTracking()
                .Where(x => groupIds.Contains(x.GroupId))
                .Select(x => new { x.GroupId, x.PublishedCurriculumVersionId }).ToArrayAsync();
            var latest = latestAssignments.Select(x => x.PublishedCurriculumVersionId).ToArray();
            var newSlots = await db.PublishedLessonSlots.AsNoTracking()
                .Where(x => latest.Contains(x.PublishedCurriculumVersionId))
                .Select(x => new { x.Id, x.PublishedCurriculumVersionId, x.SortOrder })
                .ToArrayAsync();
            var attemptBuckets = await db.StudentPracticeAttempts.AsNoTracking()
                .Where(x => latest.Contains(x.PublishedCurriculumVersionId))
                .GroupBy(x => new { x.SlotId, x.Answer })
                .Select(x => new { x.Key.SlotId, x.Key.Answer, Count = x.Count() })
                .ToArrayAsync();
            var progressBuckets = await db.StudentStageProgress.AsNoTracking()
                .Where(x => latest.Contains(x.PublishedCurriculumVersionId))
                .GroupBy(x => x.SlotId)
                .Select(x => new { SlotId = x.Key, Count = x.Count() })
                .ToArrayAsync();
            var oldSlotByNewSlot = latestAssignments.SelectMany(assignment =>
            {
                var original = groups.Single(x => x.GroupId == assignment.GroupId);
                return newSlots.Where(x => x.PublishedCurriculumVersionId ==
                        assignment.PublishedCurriculumVersionId)
                    .Select(x => new { x.Id, OriginalSlotId = original.SlotIds[x.SortOrder - 1] });
            }).ToDictionary(x => x.Id, x => x.OriginalSlotId.ToString("D"));
            if (probeReads)
            {
                var oldByGroup = groups.ToDictionary(x => x.GroupId);
                var newByGroup = latestAssignments.ToDictionary(x => x.GroupId,
                    x => x.PublishedCurriculumVersionId);
                var newSlotIds = newSlots.GroupBy(x => x.PublishedCurriculumVersionId)
                    .ToDictionary(x => x.Key, x => x.Select(slot => slot.Id).ToHashSet());
                Assert(observed.Count > 0 && observed.All(read =>
                {
                    var expected = read.VersionId == oldByGroup[read.GroupId].VersionId
                        ? oldByGroup[read.GroupId].SlotIds.ToHashSet()
                        : read.VersionId == newByGroup[read.GroupId]
                            ? newSlotIds[read.VersionId] : null;
                    return expected is not null && expected.SetEquals(read.SlotIds);
                }), "republish_read_mixed_or_missing_snapshot");
                await Task.WhenAll(readClients.Select(async reader =>
                {
                    using var response = await reader.Client.GetAsync(
                        "/api/student/learning/curriculum?pageSize=20");
                    Assert(response.StatusCode == HttpStatusCode.OK,
                        "republish_final_read_status_" + (int)response.StatusCode);
                    var payload = await response.Content.ReadFromJsonAsync<JsonElement>();
                    var versionId = newByGroup[reader.GroupId];
                    Assert(payload.GetProperty("publishedVersionId").GetGuid() == versionId &&
                        newSlotIds[versionId].SetEquals(payload.GetProperty("items")
                            .EnumerateArray().Select(x => x.GetProperty("slotId").GetGuid())),
                        "republish_final_read_not_current_snapshot");
                }));
                var times = observed.Select(x => x.Ms).OrderBy(x => x).ToArray();
                Console.WriteLine($"RepublishReads Groups={groupCount} Completed={times.Length} " +
                    $"P95Ms={times[Math.Min(times.Length - 1,
                        (int)Math.Ceiling(times.Length * .95) - 1)]} " +
                    $"P99Ms={times[Math.Min(times.Length - 1,
                        (int)Math.Ceiling(times.Length * .99) - 1)]} MaxMs={times[^1]}");
            }
            Assert(published == groupCount && latest.Distinct().Count() == groupCount &&
                !latest.Intersect(groups.Select(x => x.VersionId)).Any() &&
                newSlots.Length == groupCount * lessonCount &&
                await db.StudentStageProgress.CountAsync(x =>
                    latest.Contains(x.PublishedCurriculumVersionId)) == groupCount * studentsPerGroup * lessonCount &&
                await db.StudentPracticeAttempts.CountAsync(x =>
                    latest.Contains(x.PublishedCurriculumVersionId)) ==
                    groupCount * studentsPerGroup * lessonCount * attemptsPerStudent &&
                oldSlotByNewSlot.Count == newSlots.Length &&
                attemptBuckets.Length == newSlots.Length &&
                attemptBuckets.All(x => oldSlotByNewSlot.TryGetValue(x.SlotId, out var oldId) &&
                    x.Answer == oldId && x.Count == studentsPerGroup * attemptsPerStudent) &&
                progressBuckets.Length == newSlots.Length &&
                progressBuckets.All(x => oldSlotByNewSlot.ContainsKey(x.SlotId) &&
                    x.Count == studentsPerGroup),
                "group_republish_lost_data_or_skipped_group");
            Console.WriteLine($"GroupRepublish Groups={groupCount} Lessons={lessonCount} " +
                $"Students={groupCount * studentsPerGroup} " +
                $"Attempts={groupCount * studentsPerGroup * lessonCount * attemptsPerStudent} " +
                $"DurationMs={clock.ElapsedMilliseconds} WorkingSetBeforeMb={beforeMb} " +
                $"PeakWorkingSetMb={Process.GetCurrentProcess().PeakWorkingSet64 / 1_048_576} " +
                $"TrackedEntities={db.ChangeTracker.Entries().Count()}");
        });
        }
        finally
        {
            foreach (var (_, client) in readClients) client.Dispose();
        }
    }

    private static async Task StudentLoadAsync(SqlProcessorApp app, int count, int concurrency,
        Guid slotId, byte[] wave, Func<string, Func<Task>, Task> check)
    {
        var accounts = Array.Empty<ApplicationUser>();
        var password = "Load!9" + Guid.NewGuid().ToString("N");
        await check($"Seed {count} distinct isolated student identities", async () =>
        {
            using var scope = app.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
            var group = await db.StudyGroups.AsNoTracking().SingleAsync(x => x.Id == app.GroupId);
            var studentRoleId = await db.Roles.Where(x => x.NormalizedName == "STUDENT")
                .Select(x => x.Id).SingleAsync();
            var now = DateTimeOffset.UtcNow;
            accounts = Enumerable.Range(0, count).Select(_ =>
            {
                var email = "load-" + Guid.NewGuid().ToString("N") + "@processor-e2e.invalid";
                return new ApplicationUser { Id = Guid.NewGuid(), Email = email, UserName = email,
                    NormalizedEmail = email.ToUpperInvariant(), NormalizedUserName = email.ToUpperInvariant(),
                    EmailConfirmed = true, SecurityStamp = Guid.NewGuid().ToString("N") };
            }).ToArray();
            // A shared *test-only* hash avoids spending the setup time on thousands of hashes.
            // Each login still verifies a real ASP.NET Identity password hash.
            var hash = new PasswordHasher<ApplicationUser>().HashPassword(accounts[0], password);
            foreach (var user in accounts) user.PasswordHash = hash;
            db.Users.AddRange(accounts);
            db.Set<IdentityUserRole<Guid>>().AddRange(accounts.Select(user => new IdentityUserRole<Guid>
                { UserId = user.Id, RoleId = studentRoleId }));
            db.StudentGroupMemberships.AddRange(accounts.Select(user => new StudentGroupMembership
            {
                Id = Guid.NewGuid(), StudentId = user.Id, GroupId = app.GroupId,
                StartedAtUtc = now, AssignedByAdminId = group.CreatedByAdminId
            }));
            await db.SaveChangesAsync();
            var accountIds = accounts.Select(user => user.Id).ToArray();
            Assert(await db.StudentGroupMemberships.CountAsync(x => x.GroupId == app.GroupId &&
                accountIds.Contains(x.StudentId)) == count,
                "concurrent_student_seed_incomplete");
        });
        if (accounts.Length != count) return;

        var clients = new HttpClient?[count];
        try
        {
            await check($"Login flow for {count} distinct students at concurrency {concurrency}", async () =>
            {
                await MeasureAsync("Login", count, concurrency, async index =>
                {
                    clients[index] = await app.LoginAsAsync(accounts[index].Email!, password,
                        refreshCsrfAfterLogin: false);
                });
            });
            if (clients.Any(x => x is null)) return;
            await check($"Curriculum reads for {count} students at concurrency {concurrency}", async () =>
            {
                await MeasureAsync("Curriculum", count, concurrency, async index =>
                {
                    using var response = await clients[index]!.GetAsync("/api/student/learning/curriculum");
                    Assert(response.StatusCode == HttpStatusCode.OK,
                        "curriculum_status_" + (int)response.StatusCode);
                    var payload = await response.Content.ReadFromJsonAsync<JsonElement>();
                    Assert(payload.GetProperty("items").GetArrayLength() == 1,
                        "curriculum_lesson_missing");
                });
            });
            await check($"Lesson overview reads for {count} students at concurrency {concurrency}", async () =>
            {
                await MeasureAsync("Overview", count, concurrency, async index =>
                {
                    using var response = await clients[index]!.GetAsync(
                        $"/api/student/learning/slots/{slotId}");
                    Assert(response.StatusCode == HttpStatusCode.OK,
                        "overview_status_" + (int)response.StatusCode);
                    var payload = await response.Content.ReadFromJsonAsync<JsonElement>();
                    Assert(payload.GetProperty("slotId").GetGuid() == slotId &&
                        payload.GetProperty("totalStages").GetInt32() >= 1,
                        "overview_wrong_lesson");
                });
            });
            await check($"Lesson audio reads for {count} students at concurrency {concurrency}", async () =>
            {
                await MeasureAsync("Audio", count, concurrency, async index =>
                {
                    using var response = await clients[index]!.GetAsync(
                        $"/api/student/learning/slots/{slotId}/segments/1/audio");
                    Assert(response.StatusCode == HttpStatusCode.OK &&
                        (await response.Content.ReadAsByteArrayAsync()).AsSpan().SequenceEqual(wave),
                        "student_audio_not_scoped_or_mismatched");
                });
            });
        }
        finally
        {
            foreach (var client in clients) client?.Dispose();
        }
    }

    private static async Task MeasureAsync(string name, int count, int concurrency, Func<int, Task> operation)
    {
        using var permits = new SemaphoreSlim(concurrency);
        var durations = new long[count];
        var errors = new string?[count];
        var total = Stopwatch.StartNew();
        await Task.WhenAll(Enumerable.Range(0, count).Select(async index =>
        {
            await permits.WaitAsync();
            var clock = Stopwatch.StartNew();
            try { await operation(index); }
            catch (Exception ex) { errors[index] = ex is InvalidOperationException ? ex.Message : ex.GetType().Name; }
            finally
            {
                durations[index] = clock.ElapsedMilliseconds;
                permits.Release();
            }
        }));
        total.Stop();
        Array.Sort(durations);
        var failures = errors.Count(x => x is not null);
        Console.WriteLine($"StudentLoad Stage={name} Students={count} Concurrency={concurrency} " +
            $"WallMs={total.ElapsedMilliseconds} P50Ms={durations[count / 2]} " +
            $"P95Ms={durations[Math.Min(count - 1, (int)Math.Ceiling(count * .95) - 1)]} " +
            $"P99Ms={durations[Math.Min(count - 1, (int)Math.Ceiling(count * .99) - 1)]} Failures={failures}");
        Assert(failures == 0, "load_failures_" + name + "_" + errors.FirstOrDefault(x => x is not null));
    }

    private static async Task RepublishLoadAsync(SqlProcessorApp app, HttpClient admin, int studentCount,
        Guid curriculumId, Guid lessonVersionId, Guid firstPublicationId, Guid firstSlotId,
        Guid draftRevision, Guid assignmentRevision, int attemptsPerStudent,
        Func<string, Func<Task>, Task> check)
    {
        await check($"Seed {studentCount} isolated students with published progress", async () =>
        {
            using var scope = app.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
            var adminId = await db.StudyGroups.Where(x => x.Id == app.GroupId)
                .Select(x => x.CreatedByAdminId).SingleAsync();
            var now = DateTimeOffset.UtcNow;
            var accounts = Enumerable.Range(0, studentCount).Select(_ =>
            {
                var email = "load-" + Guid.NewGuid().ToString("N") + "@processor-e2e.invalid";
                return new ApplicationUser { Id = Guid.NewGuid(), Email = email, UserName = email,
                    NormalizedEmail = email.ToUpperInvariant(), NormalizedUserName = email.ToUpperInvariant() };
            }).ToArray();
            db.Users.AddRange(accounts);
            db.StudentGroupMemberships.AddRange(accounts.Select(user => new StudentGroupMembership
            {
                Id = Guid.NewGuid(), StudentId = user.Id, GroupId = app.GroupId,
                StartedAtUtc = now, AssignedByAdminId = adminId
            }));
            db.StudentStageProgress.AddRange(accounts.Select(user => new StudentStageProgress
            {
                StudentId = user.Id, PublishedCurriculumVersionId = firstPublicationId,
                SlotId = firstSlotId, StageKey = "shadowing", CompletedSegments = 1,
                IsComplete = true, UpdatedAtUtc = now
            }));
            await db.SaveChangesAsync();
            Assert(await db.StudentStageProgress.CountAsync(x =>
                x.PublishedCurriculumVersionId == firstPublicationId) == studentCount,
                "load_progress_seed_incomplete");
        });

        Guid manualVersionId = Guid.Empty;
        await check($"Manual republish carries {studentCount} progress rows", async () =>
        {
            using (var scope = app.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
                var adminId = await db.StudyGroups.Where(x => x.Id == app.GroupId)
                    .Select(x => x.CreatedByAdminId).SingleAsync();
                var now = DateTimeOffset.UtcNow;
                db.LessonAiContents.Add(new LessonAiContent
                {
                    Id = Guid.NewGuid(), LessonVersionId = lessonVersionId,
                    CreatedByAdminId = adminId, Revision = Guid.NewGuid(), Status = "Approved",
                    PayloadJson = JsonSerializer.Serialize(new LessonMaterial([], [], "", "")
                        { ReviewedStages = [] }, LessonMaterialRules.Json),
                    CreatedAtUtc = now, UpdatedAtUtc = now, ApprovedAtUtc = now
                });
                await db.SaveChangesAsync();
            }
            var clock = Stopwatch.StartNew();
            using var response = await admin.PostAsJsonAsync("/api/admin/shadowing/curriculums/publish", new
            {
                requestId = Guid.NewGuid(), groupId = app.GroupId,
                curriculumTemplateId = curriculumId, expectedDraftRevision = draftRevision,
                expectedAssignmentRevision = assignmentRevision, expectedVersionId = firstPublicationId
            });
            clock.Stop();
            Assert(response.StatusCode == HttpStatusCode.Created,
                "manual_load_publish_status_" + (int)response.StatusCode);
            manualVersionId = (await response.Content.ReadFromJsonAsync<JsonElement>())
                .GetProperty("versionId").GetGuid();
            using var verify = app.Services.CreateScope();
            var verifyDb = verify.ServiceProvider.GetRequiredService<ApplicationDbContext>();
            Assert(await verifyDb.StudentStageProgress.CountAsync(x =>
                x.PublishedCurriculumVersionId == manualVersionId) == studentCount,
                "manual_publish_lost_progress");
            Console.WriteLine($"ManualRepublish Students={studentCount} DurationMs={clock.ElapsedMilliseconds}");
        });

        await check($"Auto republish carries {studentCount} progress and " +
            $"{studentCount * attemptsPerStudent} attempt rows", async () =>
        {
            Assert(manualVersionId != Guid.Empty, "manual_publish_missing");
            using var scope = app.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
            var adminId = await db.StudyGroups.Where(x => x.Id == app.GroupId)
                .Select(x => x.CreatedByAdminId).SingleAsync();
            var manualSlotId = await db.PublishedLessonSlots.Where(x =>
                x.PublishedCurriculumVersionId == manualVersionId)
                .Select(x => x.Id).SingleAsync();
            var users = await db.StudentStageProgress.Where(x =>
                x.PublishedCurriculumVersionId == manualVersionId)
                .Select(x => x.StudentId).ToArrayAsync();
            db.StudentPracticeAttempts.AddRange(users.SelectMany(userId =>
                Enumerable.Range(1, attemptsPerStudent).Select(position => new StudentPracticeAttempt
            {
                Id = Guid.NewGuid(), StudentId = userId,
                PublishedCurriculumVersionId = manualVersionId, SlotId = manualSlotId,
                StageKey = "shadowing", Position = position, Answer = "done",
                FeedbackJson = "{}", CreatedAtUtc = DateTimeOffset.UtcNow
            })));
            db.StudentPracticeAttempts.Add(new StudentPracticeAttempt
            {
                Id = Guid.NewGuid(), StudentId = users[0],
                PublishedCurriculumVersionId = manualVersionId, SlotId = manualSlotId,
                StageKey = "vocabulary", Position = 1, Answer = "stale-stage",
                FeedbackJson = "{}", CreatedAtUtc = DateTimeOffset.UtcNow
            });
            var now = DateTimeOffset.UtcNow.AddSeconds(1);
            db.LessonAiContents.Add(new LessonAiContent
            {
                Id = Guid.NewGuid(), LessonVersionId = lessonVersionId,
                CreatedByAdminId = adminId, Revision = Guid.NewGuid(), Status = "Approved",
                PayloadJson = JsonSerializer.Serialize(new LessonMaterial([], [], "", "")
                    { ReviewedStages = [] }, LessonMaterialRules.Json),
                CreatedAtUtc = now, UpdatedAtUtc = now, ApprovedAtUtc = now
            });
            await db.SaveChangesAsync();
            db.ChangeTracker.Clear();
            var workingSetBefore = Process.GetCurrentProcess().WorkingSet64;
            var clock = Stopwatch.StartNew();
            var published = await ApprovedLessonPublisher.SyncAsync(db, lessonVersionId,
                NullLogger.Instance, CancellationToken.None);
            clock.Stop();
            Assert(published == 1, "auto_publish_did_not_advance");
            var latestId = await db.GroupCurriculumAssignments.Where(x => x.GroupId == app.GroupId)
                .Select(x => x.PublishedCurriculumVersionId).SingleAsync();
            Assert(await db.StudentStageProgress.CountAsync(x =>
                x.PublishedCurriculumVersionId == latestId) == studentCount &&
                await db.StudentPracticeAttempts.CountAsync(x =>
                    x.PublishedCurriculumVersionId == latestId) == studentCount * attemptsPerStudent,
                "auto_publish_lost_progress_or_attempts");
            var copied = await db.StudentPracticeAttempts.AsNoTracking()
                .Where(x => x.PublishedCurriculumVersionId == latestId &&
                    x.StudentId == users[0]).OrderBy(x => x.Position)
                .Select(x => new { x.StageKey, x.Position, x.Answer, x.FeedbackJson })
                .ToArrayAsync();
            Assert(copied.Length == attemptsPerStudent && copied.All(x =>
                x.StageKey == "shadowing" && x.Answer == "done" && x.FeedbackJson == "{}") &&
                copied.Select(x => x.Position).SequenceEqual(Enumerable.Range(1, attemptsPerStudent)) &&
                await db.StudentPracticeAttempts.AnyAsync(x =>
                    x.PublishedCurriculumVersionId == manualVersionId && x.StudentId == users[0] &&
                    x.StageKey == "vocabulary"), "auto_publish_copied_stale_stage_or_changed_history");
            var peak = Process.GetCurrentProcess().PeakWorkingSet64;
            Console.WriteLine($"AutoRepublish Students={studentCount} " +
                $"AttemptsPerStudent={attemptsPerStudent} DurationMs={clock.ElapsedMilliseconds} " +
                $"WorkingSetBeforeMb={workingSetBefore / 1_048_576} PeakWorkingSetMb={peak / 1_048_576}");
        });
    }

    private sealed class SqlProcessorApp(string contentRoot, string connection, string mediaRoot)
        : WebApplicationFactory<global::Program>
    {
        public Guid GroupId { get; } = Guid.NewGuid();
        private readonly string password = "Test!9" + Guid.NewGuid().ToString("N");
        private readonly string suffix = Guid.NewGuid().ToString("N") + "@processor-e2e.invalid";

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment("Development").UseContentRoot(contentRoot);
            builder.UseSetting("ConnectionStrings:DefaultConnection", connection);
            builder.UseSetting("Media:Provider", "DevelopmentLocal");
            builder.UseSetting("Media:LocalRoot", mediaRoot);
            builder.ConfigureServices(services =>
            {
                services.AddDataProtection().UseEphemeralDataProtectionProvider();
                services.RemoveAll<IHostedService>();
            });
        }

        public async Task SetupAsync()
        {
            using var scope = Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
            await db.Database.MigrateAsync();
            var roles = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole<Guid>>>();
            foreach (var role in new[] { "Admin", "Student" })
                if (!await roles.RoleExistsAsync(role))
                    Assert((await roles.CreateAsync(new IdentityRole<Guid>(role))).Succeeded,
                        "sql_test_role_create_failed");
            var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
            var admin = new ApplicationUser { Id = Guid.NewGuid(),
                Email = "admin-" + suffix, UserName = "admin-" + suffix, EmailConfirmed = true };
            var student = new ApplicationUser { Id = Guid.NewGuid(),
                Email = "student-" + suffix, UserName = "student-" + suffix, EmailConfirmed = true };
            foreach (var (user, role) in new[] { (admin, "Admin"), (student, "Student") })
            {
                Assert((await users.CreateAsync(user, password)).Succeeded, "sql_test_user_create_failed");
                Assert((await users.AddToRoleAsync(user, role)).Succeeded, "sql_test_role_assign_failed");
            }
            db.StudyGroups.Add(new StudyGroup { Id = GroupId, Name = "Processor test group",
                CreateRequestId = Guid.NewGuid(), CreatedAtUtc = DateTimeOffset.UtcNow,
                CreatedByAdminId = admin.Id });
            db.StudentGroupMemberships.Add(new StudentGroupMembership { Id = Guid.NewGuid(),
                StudentId = student.Id, GroupId = GroupId, StartedAtUtc = DateTimeOffset.UtcNow,
                AssignedByAdminId = admin.Id });
            await db.SaveChangesAsync();
        }

        public async Task<HttpClient> LoginAsync(string role)
        {
            return await LoginAsAsync(role + "-" + suffix, password);
        }

        public async Task<HttpClient> LoginAsAsync(string email, string accountPassword,
            bool refreshCsrfAfterLogin = true)
        {
            var client = CreateClient(new WebApplicationFactoryClientOptions
            { BaseAddress = new Uri("https://localhost"), AllowAutoRedirect = false });
            try
            {
                await RefreshCsrfAsync(client);
                using var login = await client.PostAsJsonAsync("/api/auth/login",
                    new { email, password = accountPassword });
                Assert(login.StatusCode == HttpStatusCode.OK,
                    "sql_test_login_status_" + (int)login.StatusCode);
                if (refreshCsrfAfterLogin) await RefreshCsrfAsync(client);
                return client;
            }
            catch { client.Dispose(); throw; }
        }

        private static async Task RefreshCsrfAsync(HttpClient client)
        {
            using var csrf = await client.GetAsync("/api/auth/csrf");
            var cookie = csrf.Headers.GetValues("Set-Cookie")
                .Single(x => x.StartsWith("XSRF-TOKEN=", StringComparison.Ordinal));
            var token = Uri.UnescapeDataString(cookie.Split(';')[0]["XSRF-TOKEN=".Length..]);
            client.DefaultRequestHeaders.Remove("X-XSRF-TOKEN");
            client.DefaultRequestHeaders.Add("X-XSRF-TOKEN", token);
        }
    }
}
