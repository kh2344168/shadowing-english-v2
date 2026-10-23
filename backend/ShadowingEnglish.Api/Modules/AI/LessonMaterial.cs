using System.Text.Json;
using System.Text.RegularExpressions;

namespace ShadowingEnglish.Api.Modules.AI;

// Optional fields keep lessons approved before the V1 activity port readable.
public sealed record VocabularyCard(string Word, string MeaningAr, string ExampleEn, string ExampleAr,
    string Kind = "word", bool IncludeForStudent = true, string? Explanation = null,
    string? ExtraExample = null, string? UsageNote = null, bool TestLater = false,
    string? ImageUrl = null, bool RepeatForReview = false);
public sealed record DictationCard(int Position, bool Enabled = true, string[]? AcceptedAnswers = null,
    string? Hint = null, string Mode = "full-sentence", int? TargetWordIndex = null,
    double? AudioStartSeconds = null, double? AudioEndSeconds = null);
public sealed record LessonTranscriptSegment(int Position, string Text);
public sealed record QuizCard(string Question, string[] Options, int CorrectIndex, string ExplanationAr,
    string Type = "multiple-choice", bool Enabled = true, string? CorrectAnswer = null);
public sealed record LessonMaterial(VocabularyCard[] Vocabulary, QuizCard[] Quiz, string GrammarFocus,
    string ConversationScenario, DictationCard[]? Dictation = null, string[]? ConversationGoals = null,
    string? AiRole = null, string? StudentRole = null, string? OpeningMessage = null,
    bool ShadowingReviewEnabled = false, string[]? ReviewedStages = null,
    int? ConversationTurnTarget = null, string? ConversationLearningOutcome = null,
    string? ConversationFocusTense = null, string[]? ConversationTargetWords = null,
    string ConversationCorrectionMode = "lesson-only", bool VocabularyOnly = false,
    int? VocabularyTargetCount = null, string? ConversationSupportMode = null,
    string? ConversationHelpAr = null, string? ConversationModelAnswer = null,
    string? ConversationContextType = null, string[]? ConversationAllowedFacts = null,
    string[]? ConversationSuccessSteps = null, int? ConversationMinTurns = null,
    int? ConversationMaxTurns = null);
public sealed record ChatFeedback(string Reply, string Correction, string BetterAnswer, string GrammarTip,
    bool? FocusMet = null, string[]? MetSteps = null, ConversationIssue[]? Issues = null,
    bool CriticalFactError = false);
public sealed record ConversationIssue(string Original, string Suggested, string Reason, string Kind);
public sealed record ConversationResult(bool GoalMet, int ReplyCount, int RelevantReplies, string[] MetSteps,
    string[] MissingSteps, ConversationIssue[] Issues, string? RetrySentence,
    bool EndedEarly, string Outcome);

public static class LessonMaterialRules
{
    public static readonly string[] DictationModes = ["full-sentence", "missing-word", "word-order", "single-word"];
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private static readonly string[] DefaultApprovalStages = [
        "vocabulary", "listen-type", "grammar", "vocabulary-quiz", "grammar-quiz",
        "word-order", "conversation"
    ];
    private static readonly string[] LegacyApprovalStages =
        ["vocabulary", "listen-type", "quiz", "conversation"];
    private static readonly HashSet<string> AcceptedReviewStages =
        [.. DefaultApprovalStages, "quiz"];
    public static readonly string[] GeneratableStages =
        ["vocabulary", "listen-type", "grammar", "vocabulary-quiz", "grammar-quiz", "word-order", "conversation"];
    private static readonly HashSet<string> ConversationTenses =
        ["present-simple", "present-continuous", "past-simple", "past-continuous",
            "present-perfect", "future-simple"];
    private static readonly HashSet<string> ConversationSupportModes =
        ["first-steps", "guided", "independent"];
    private static readonly HashSet<string> ConversationContextTypes =
        ["situation", "clip", "professional"];

    public static bool StructuredConversation(LessonMaterial material) =>
        material.ConversationMinTurns is not null && material.ConversationMaxTurns is not null &&
        material.ConversationSuccessSteps is { Length: > 0 };
    public static int ConversationMaximum(LessonMaterial material) =>
        StructuredConversation(material) ? material.ConversationMaxTurns!.Value : ConversationTurns(material);
    public static string[] MetConversationSteps(LessonMaterial material, IEnumerable<ChatFeedback> feedback) =>
        (material.ConversationSuccessSteps ?? []).Where(step => feedback.Any(item =>
            item.MetSteps?.Contains(step, StringComparer.OrdinalIgnoreCase) == true)).ToArray();
    public static bool ConversationGoalMet(LessonMaterial material, IEnumerable<ChatFeedback> feedback) =>
        StructuredConversation(material) && MetConversationSteps(material, feedback).Length ==
            material.ConversationSuccessSteps!.Length;
    public static ConversationResult ConversationSummary(LessonMaterial material,
        IReadOnlyList<(string Answer, ChatFeedback Feedback)> turns, bool endedEarly)
    {
        var met = MetConversationSteps(material, turns.Select(x => x.Feedback));
        var missing = (material.ConversationSuccessSteps ?? []).Except(met, StringComparer.OrdinalIgnoreCase).ToArray();
        var goal = missing.Length == 0 && turns.Count >= (material.ConversationMinTurns ?? 1);
        var issues = turns.SelectMany(x => x.Feedback.Issues ?? []).Where(x =>
            !string.IsNullOrWhiteSpace(x.Original) && !string.IsNullOrWhiteSpace(x.Suggested) &&
            !string.Equals(x.Original.Trim(), x.Suggested.Trim(), StringComparison.OrdinalIgnoreCase))
            .GroupBy(x => x.Original.Trim(), StringComparer.OrdinalIgnoreCase)
            .Select(x => x.First())
            .OrderByDescending(x => x.Kind.Contains("fact", StringComparison.OrdinalIgnoreCase) ? 3 :
                x.Kind.Contains("goal", StringComparison.OrdinalIgnoreCase) ||
                x.Kind.Contains("vocabulary", StringComparison.OrdinalIgnoreCase) ? 2 : 1)
            .Take(3);
        var compactIssues = CompactConversationIssues(issues);
        return new ConversationResult(goal, turns.Count, turns.Count(x => x.Feedback.FocusMet == true),
            met, missing, compactIssues,
            compactIssues.FirstOrDefault()?.Suggested, endedEarly,
            goal ? "goal-met" : endedEarly ? "ended-early" : "goal-incomplete");
    }
    public static ConversationIssue[] CompactConversationIssues(IEnumerable<ConversationIssue> issues) =>
        issues.Take(3).Select(x => new ConversationIssue(
            x.Original[..Math.Min(x.Original.Length, 120)],
            x.Suggested[..Math.Min(x.Suggested.Length, 120)],
            x.Reason[..Math.Min(x.Reason.Length, 100)],
            x.Kind[..Math.Min(x.Kind.Length, 30)])).ToArray();
    public static bool SafeProfessionalReply(LessonMaterial material, string reply)
    {
        if (material.ConversationContextType != "professional") return true;
        if (Regex.IsMatch(reply, @"\b(?:I|we)\s+(?:have|just)\s+(?:cancelled|canceled|refunded|activated|changed|processed|issued|applied)\b",
            RegexOptions.IgnoreCase)) return false;
        if (Regex.IsMatch(reply,
            @"\b(?:your|the)\s+(?:subscription|account|plan)\s+(?:has been|is now)\s+(?:cancelled|canceled|activated|changed)\b|\b(?:refund|cancellation)\s+(?:has been|is)\s+(?:processed|completed)\b",
            RegexOptions.IgnoreCase)) return false;
        var facts = string.Join(" ", material.ConversationAllowedFacts ?? []);
        var amounts = Regex.Matches(reply, @"(?:[$€£]\s*\d+(?:\.\d+)?|\b\d+(?:\.\d+)?\s*%)");
        return amounts.All(amount => facts.Contains(amount.Value, StringComparison.OrdinalIgnoreCase));
    }

    public static int ConversationTurns(LessonMaterial material) => material.ConversationTurnTarget ??
        (material.ConversationSupportMode switch { "first-steps" => 3, "guided" => 5,
            "independent" => 8, _ => 10 });
    public static bool CountsConversationTurn(LessonMaterial material, ChatFeedback feedback) =>
        material.ConversationSupportMode is not null ? feedback.FocusMet == true :
        string.IsNullOrWhiteSpace(material.ConversationFocusTense) || feedback.FocusMet == true;

    public static bool ReadyToApprove(LessonMaterial material, IEnumerable<string>? requiredStages = null)
    {
        if (material.ReviewedStages is not { } reviewed) return false;
        var required = requiredStages?.Distinct().ToArray() ??
            (reviewed.Contains("quiz") && !reviewed.Any(DefaultApprovalStages[2..].Contains)
                ? LegacyApprovalStages
                : DefaultApprovalStages);
        return required.All(stage =>
            reviewed.Contains(stage) || reviewed.Contains("quiz") &&
            stage is "grammar" or "vocabulary-quiz" or "grammar-quiz" or "word-order");
    }

    public static LessonMaterial? Parse(string raw, string source, int[]? segmentPositions = null)
    {
        try
        {
            var material = JsonSerializer.Deserialize<LessonMaterial>(ObjectOnly(raw), Json);
            return Valid(material, source, segmentPositions) ? material : null;
        }
        catch (JsonException) { return null; }
    }

    // Models may omit the new `kind` field or add punctuation around a quoted phrase.
    // Normalize only generated output; edited/approved content still uses strict Parse/Valid.
    public static LessonMaterial? ParseGenerated(string raw, string source)
    {
        try
        {
            var material = JsonSerializer.Deserialize<LessonMaterial>(ObjectOnly(raw), Json);
            if (material?.Vocabulary is null) return null;
            var vocabulary = material.Vocabulary.Select(card => card is null ? null : card with
            {
                Word = Regex.Replace(card.Word?.Trim() ?? "", @"^[^a-zA-Z]+|[^a-zA-Z]+$", ""),
                Kind = (card.Word?.Trim() ?? "").Contains(' ') ? "chunk" : "word"
            }).ToArray();
            var normalized = material with { Vocabulary = vocabulary! };
            return normalized.Vocabulary.Length > 0 && normalized.Quiz.Length > 0 &&
                !string.IsNullOrWhiteSpace(normalized.GrammarFocus) &&
                !string.IsNullOrWhiteSpace(normalized.ConversationScenario) &&
                Valid(normalized, source) ? normalized : null;
        }
        catch (JsonException) { return null; }
    }

    public static LessonMaterial? ParseVocabularyGenerated(string raw, string source)
    {
        try
        {
            using var document = JsonDocument.Parse(ObjectOnly(raw));
            if (!document.RootElement.TryGetProperty("vocabulary", out var cardsJson)) return null;
            var cards = cardsJson.Deserialize<VocabularyCard[]>(Json);
            if (cards is null) return null;
            var normalized = cards.Select(card => card with
            {
                Word = Regex.Replace(card.Word?.Trim() ?? "", @"^[^a-zA-Z]+|[^a-zA-Z]+$", ""),
                Kind = (card.Word?.Trim() ?? "").Contains(' ') ? "chunk" : "word"
            }).ToArray();
            var material = new LessonMaterial(normalized, [], "", "", ReviewedStages: [], VocabularyOnly: true);
            return normalized.Length > 0 && Valid(material, source) ? material : null;
        }
        catch (JsonException) { return null; }
    }

    public static LessonMaterial EmptyDraft() => new([], [], "", "", ReviewedStages: []);

    // The worker merges only the requested stage into the newest teacher-edited snapshot.
    // A model response cannot replace fields belonging to a different stage.
    public static LessonMaterial? MergeStageGenerated(string stage, string raw, LessonMaterial current,
        string source, IReadOnlyList<LessonTranscriptSegment> segments, string level = "B1",
        string lessonType = "situation")
    {
        if (!GeneratableStages.Contains(stage)) return null;
        try
        {
            using var document = JsonDocument.Parse(ObjectOnly(raw));
            var root = document.RootElement;
            LessonMaterial result;
            switch (stage)
            {
                case "vocabulary":
                {
                    var cards = ParseVocabularyGenerated(raw, source)?.Vocabulary;
                    if (cards is null) return null;
                    // Conversation focus words are teacher choices belonging to another
                    // stage. Keep their cards if a vocabulary regeneration omits them.
                    var focused = current.ConversationTargetWords ?? [];
                    var retained = current.Vocabulary.Where(card =>
                        focused.Contains(card.Word, StringComparer.OrdinalIgnoreCase) &&
                        !cards.Any(newCard => string.Equals(newCard.Word, card.Word,
                            StringComparison.OrdinalIgnoreCase)));
                    result = current with { Vocabulary = cards.Concat(retained).ToArray() };
                    break;
                }
                case "grammar":
                {
                    var focus = ReadString(root, "grammarFocus");
                    if (string.IsNullOrWhiteSpace(focus)) return null;
                    result = current with { GrammarFocus = focus.Trim() };
                    break;
                }
                case "conversation":
                {
                    var scenario = ReadString(root, "conversationScenario");
                    if (string.IsNullOrWhiteSpace(scenario)) return null;
                    // A1 starts with first steps only when the teacher's existing choices
                    // fit that mode. Never reject a valid model response because an
                    // implicit default conflicts with four selected focus words, tense,
                    // turn limits, or correction scope already saved in the draft.
                    var firstStepsCompatible = current.ConversationTargetWords is not { Length: > 3 } &&
                        string.IsNullOrWhiteSpace(current.ConversationFocusTense) &&
                        current.ConversationTurnTarget is not > 5 &&
                        current.ConversationMaxTurns is not > 6 &&
                        current.ConversationCorrectionMode is null or "lesson-only";
                    var support = current.ConversationSupportMode ?? (level switch
                    {
                        "A1" when firstStepsCompatible => "first-steps",
                        "A1" or "A2" => "guided",
                        _ => "independent"
                    });
                    var goals = root.TryGetProperty("conversationGoals", out var goalsJson) &&
                        goalsJson.ValueKind == JsonValueKind.Array
                        ? goalsJson.Deserialize<string[]>(Json) : null;
                    goals = goals?.Where(goal => !string.IsNullOrWhiteSpace(goal))
                        .Select(goal => goal.Trim()).Take(6).ToArray();
                    var steps = current.ConversationSuccessSteps is { Length: > 0 } savedSteps &&
                        savedSteps.All(step => !string.IsNullOrWhiteSpace(step))
                        ? savedSteps : goals is { Length: > 0 } ? goals :
                            ["يجيب عن سؤال المحاور في موقف الدرس"];
                    var opening = ReadString(root, "openingMessage")?.Trim();
                    var help = ReadString(root, "conversationHelpAr")?.Trim();
                    var example = ReadString(root, "conversationModelAnswer")?.Trim();
                    var starterFallback = support == "first-steps" &&
                        (string.IsNullOrWhiteSpace(help) || string.IsNullOrWhiteSpace(example));
                    result = current with
                    {
                        ConversationScenario = scenario.Trim(), ConversationGoals = goals,
                        AiRole = !string.IsNullOrWhiteSpace(current.AiRole) ? current.AiRole :
                            ReadString(root, "aiRole")?.Trim() is { Length: > 0 } aiRole ? aiRole : "Conversation partner",
                        StudentRole = !string.IsNullOrWhiteSpace(current.StudentRole) ? current.StudentRole :
                            ReadString(root, "studentRole")?.Trim() is { Length: > 0 } studentRole ? studentRole : "Learner",
                        ConversationContextType = current.ConversationContextType ??
                            (lessonType == "clip" ? "clip" : "situation"),
                        ConversationSuccessSteps = steps,
                        ConversationAllowedFacts = current.ConversationAllowedFacts ?? [],
                        ConversationMinTurns = current.ConversationMinTurns ??
                            (support == "first-steps" ? 2 : support == "guided" ? 5 : 6),
                        ConversationMaxTurns = current.ConversationMaxTurns ??
                            (support == "first-steps" ? 4 : support == "guided" ? 10 : 12),
                        OpeningMessage = starterFallback ? "Hi! How are you?" :
                            !string.IsNullOrWhiteSpace(opening) ? opening :
                            support == "first-steps" ? "Hi! How are you?" : scenario.Trim(),
                        ConversationSupportMode = support,
                        ConversationTurnTarget = support == "first-steps" &&
                            current.ConversationSupportMode is null &&
                            current.ConversationTurnTarget is > 5 ? 3 :
                            current.ConversationTurnTarget ??
                            (support == "first-steps" ? 3 : support == "guided" ? 5 : 8),
                        ConversationLearningOutcome = !string.IsNullOrWhiteSpace(current.ConversationLearningOutcome) ?
                            current.ConversationLearningOutcome : steps[0],
                        ConversationHelpAr = starterFallback ? "يمكنك الرد بكلمة واحدة أو عبارة قصيرة." :
                            !string.IsNullOrWhiteSpace(help) ? help :
                            support == "first-steps" ? "يمكنك الرد بكلمة واحدة أو عبارة قصيرة." : null,
                        ConversationModelAnswer = starterFallback ? "I'm good." :
                            !string.IsNullOrWhiteSpace(example) ? example :
                            support == "first-steps" ? "I'm good." : null
                    };
                    break;
                }
                case "vocabulary-quiz":
                case "grammar-quiz":
                case "word-order":
                {
                    if (!root.TryGetProperty("quiz", out var quizJson)) return null;
                    var cards = quizJson.Deserialize<QuizCard[]>(Json);
                    var quizType = stage switch
                    {
                        "vocabulary-quiz" => "vocabulary-card",
                        "grammar-quiz" => "multiple-choice",
                        _ => "word-order"
                    };
                    if (cards is not { Length: >= 1 and <= 12 } ||
                        cards.Any(x => x is null || x.Type != quizType)) return null;
                    result = current with { Quiz = current.Quiz.Where(x => x.Type != quizType)
                        .Concat(cards).ToArray() };
                    break;
                }
                case "listen-type":
                {
                    if (!root.TryGetProperty("dictation", out var dictationJson)) return null;
                    var cards = dictationJson.Deserialize<DictationCard[]>(Json);
                    if (cards is not { Length: >= 1 and <= 20 }) return null;
                    result = current with { Dictation = cards };
                    break;
                }
                default: return null;
            }
            result = result with { ReviewedStages = (current.ReviewedStages ?? [])
                .Where(x => x != stage).ToArray() };
            return Valid(result, source, segments.Select(x => x.Position).ToArray()) &&
                ValidDictationForSegments(result, segments) &&
                HasStageData(result, stage) ? result : null;
        }
        catch (JsonException) { return null; }
    }

    public static bool HasStageData(LessonMaterial material, string stage) => stage switch
    {
        "vocabulary" => material.Vocabulary.Any(x => x.IncludeForStudent),
        "listen-type" => material.Dictation?.Any(x => x.Enabled) == true,
        "grammar" => !string.IsNullOrWhiteSpace(material.GrammarFocus),
        "vocabulary-quiz" => material.Quiz.Any(x => x.Enabled && x.Type == "vocabulary-card"),
        "grammar-quiz" => material.Quiz.Any(x => x.Enabled && x.Type == "multiple-choice"),
        "word-order" => material.Quiz.Any(x => x.Enabled && x.Type == "word-order"),
        "conversation" => !string.IsNullOrWhiteSpace(material.ConversationScenario),
        _ => false
    };

    public static bool HasStageCandidates(LessonMaterial material, string stage) => stage switch
    {
        "vocabulary" => material.Vocabulary.Length > 0,
        "listen-type" => material.Dictation is { Length: > 0 },
        "vocabulary-quiz" => material.Quiz.Any(x => x.Type == "vocabulary-card"),
        "grammar-quiz" => material.Quiz.Any(x => x.Type == "multiple-choice"),
        "word-order" => material.Quiz.Any(x => x.Type == "word-order"),
        _ => HasStageData(material, stage)
    };

    public static LessonMaterial? PrepareDraft(LessonMaterial generated,
        IReadOnlyList<LessonTranscriptSegment> segments, string level = "B1")
    {
        var dictation = segments.Where(x => x.Text.Trim().Length is >= 1 and <= 600 &&
                (level != "A1" || DictationTokens(x.Text).Length <= 8))
            .Select(x => SuggestedDictation(x.Position, x.Text, level, true)).ToArray();
        var quiz = generated.Quiz.ToList();
        var visible = generated.Vocabulary.Where(x => x.IncludeForStudent).ToArray();
        if (visible.Length >= 4 && quiz.Count < 12)
        {
            var options = new[] { visible[1].Word, visible[2].Word, visible[0].Word, visible[3].Word };
            quiz.Add(new QuizCard($"اختر التعبير الذي يعني: {visible[0].MeaningAr}", options, 2,
                $"{visible[0].Word} = {visible[0].MeaningAr}", Type: "vocabulary-card"));
        }
        var sentence = segments.Select(x => Regex.Matches(x.Text, "[a-zA-Z]+(?:['-][a-zA-Z]+)*")
            .Select(word => word.Value).ToArray())
            .FirstOrDefault(words => words.Length is >= 3 and <= 12 &&
                words.Distinct(StringComparer.OrdinalIgnoreCase).Count() == words.Length);
        if (sentence is not null && quiz.Count < 12)
        {
            var reordered = sentence.Skip(1).Concat(sentence.Take(1)).ToArray();
            quiz.Add(new QuizCard("رتّب كلمات جملة الدرس كما سمعتها", reordered, 0,
                "راجع ترتيب الكلمات كما ورد في الجملة الصوتية.", Type: "word-order",
                CorrectAnswer: string.Join(" ", sentence)));
        }
        var material = generated with
        {
            Quiz = quiz.ToArray(), Dictation = dictation.Length == 0 ? null : dictation,
            ConversationGoals = ["استخدم كلمات الدرس في ردود طبيعية", "تدرّب على القاعدة ثم راجع التصحيح"],
            AiRole = "محادث إنجليزي ودود", StudentRole = "متعلم يجيب بالإنجليزية",
            OpeningMessage = generated.ConversationScenario, ShadowingReviewEnabled = true,
            ReviewedStages = []
        };
        return Valid(material, string.Join("\n", segments.Select(x => x.Text)),
            segments.Select(x => x.Position).ToArray()) &&
            ValidDictationForSegments(material, segments) ? material : null;
    }

    public static bool Valid(LessonMaterial? material, string source, int[]? segmentPositions = null)
    {
        if (material is null || material.Vocabulary is not { Length: <= 20 } ||
            material.Quiz is not { Length: <= 12 } ||
            !Optional(material.GrammarFocus, 200) || !Optional(material.ConversationScenario, 240) ||
            !Optional(material.AiRole, 100) || !Optional(material.StudentRole, 100) ||
            !Optional(material.OpeningMessage, 240) ||
            material.ConversationTurnTarget is < 1 or > 20 ||
            material.VocabularyTargetCount is < 1 or > 20 ||
            !Optional(material.ConversationLearningOutcome, 240) ||
            (material.ConversationSupportMode is { } supportMode &&
                !ConversationSupportModes.Contains(supportMode)) ||
            !Optional(material.ConversationHelpAr, 160) ||
            !Optional(material.ConversationModelAnswer, 160) ||
            (material.ConversationContextType is { } contextType &&
                !ConversationContextTypes.Contains(contextType)) ||
            material.ConversationAllowedFacts is { Length: > 12 } ||
            material.ConversationAllowedFacts?.Any(x => !Field(x, 240)) == true ||
            (material.ConversationContextType == "professional" &&
                material.ConversationMinTurns.HasValue &&
                material.ConversationAllowedFacts is not { Length: > 0 }) ||
            material.ConversationSuccessSteps is { Length: > 6 } ||
            material.ConversationSuccessSteps?.Any(x => !Field(x, 160)) == true ||
            (material.ConversationSuccessSteps is { } successSteps &&
                successSteps.Distinct(StringComparer.OrdinalIgnoreCase).Count() != successSteps.Length) ||
            (material.ConversationMinTurns.HasValue != material.ConversationMaxTurns.HasValue) ||
            (material.ConversationMinTurns is { } minTurns &&
                (minTurns < 1 || material.ConversationMaxTurns is not { } maxTurns ||
                    maxTurns < minTurns || maxTurns > 20 ||
                    material.ConversationSuccessSteps is not { Length: > 0 } ||
                    string.IsNullOrWhiteSpace(material.ConversationContextType) ||
                    string.IsNullOrWhiteSpace(material.AiRole) ||
                    string.IsNullOrWhiteSpace(material.StudentRole) ||
                    string.IsNullOrWhiteSpace(material.ConversationLearningOutcome))) ||
            (material.ConversationSupportMode is not null &&
                (string.IsNullOrWhiteSpace(material.OpeningMessage) ||
                    string.IsNullOrWhiteSpace(material.ConversationLearningOutcome))) ||
            (material.ConversationSupportMode == "first-steps" &&
                (material.ConversationFocusTense is { Length: > 0 } ||
                    material.ConversationTurnTarget is > 5 ||
                    material.ConversationMaxTurns is > 6 ||
                    material.ConversationTargetWords is { Length: > 3 } ||
                    material.ConversationCorrectionMode != "lesson-only" ||
                    string.IsNullOrWhiteSpace(material.ConversationHelpAr) ||
                    string.IsNullOrWhiteSpace(material.ConversationModelAnswer))) ||
            (material.ConversationFocusTense is { Length: > 0 } tense && !ConversationTenses.Contains(tense)) ||
            material.ConversationCorrectionMode is not ("lesson-only" or "all") ||
            material.ConversationTargetWords is { Length: > 12 } ||
            material.ConversationTargetWords?.Any(x => !Field(x, 80)) == true ||
            material.ConversationTargetWords is { } targetWords &&
                (targetWords.Distinct(StringComparer.OrdinalIgnoreCase).Count() != targetWords.Length ||
                    targetWords.Any(x => !material.Vocabulary.Any(v => v.IncludeForStudent &&
                        string.Equals(v.Word, x, StringComparison.OrdinalIgnoreCase)))) ||
            material.ConversationGoals is { Length: > 6 } ||
            material.ConversationGoals?.Any(x => !Field(x, 160)) == true ||
            material.ReviewedStages is { } reviewed &&
                (reviewed.Length > AcceptedReviewStages.Count || reviewed.Distinct().Count() != reviewed.Length ||
                    reviewed.Any(x => !AcceptedReviewStages.Contains(x)))) return false;

        var sourceWords = Tokens(source);
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var card in material.Vocabulary)
        {
            if (card is null || !Field(card.Word, 80) || !Field(card.MeaningAr, 120) ||
                !Field(card.ExampleEn, 200) || !Field(card.ExampleAr, 200) ||
                !Optional(card.Explanation, 300) || !Optional(card.ExtraExample, 200) ||
                !Optional(card.UsageNote, 200) || !Optional(card.ImageUrl, 1000) ||
                card.Kind is not ("word" or "chunk") ||
                !seen.Add(card.Word.Trim()) ||
                !Regex.IsMatch(card.Word, "^[a-zA-Z]+(?:['-][a-zA-Z]+)*(?: [a-zA-Z]+(?:['-][a-zA-Z]+)*)*$") ||
                (card.Kind == "word" && card.Word.Contains(' ')) ||
                (card.Kind == "chunk" && !card.Word.Contains(' ')) ||
                !ContainsPhrase(sourceWords, Tokens(card.Word))) return false;
        }
        foreach (var quiz in material.Quiz)
        {
            if (quiz is null || !Field(quiz.Question, 220) || !Field(quiz.ExplanationAr, 250) ||
                quiz.Type is not ("multiple-choice" or "vocabulary-card" or "word-order") ||
                quiz.Options is null ||
                quiz.Options.Any(x => !Field(x, 120)) ||
                quiz.Options.Distinct(StringComparer.OrdinalIgnoreCase).Count() != quiz.Options.Length) return false;
            if (quiz.Type == "word-order")
            {
                if (quiz.Options.Length is < 3 or > 12 || !Field(quiz.CorrectAnswer, 200) ||
                    !Tokens(quiz.CorrectAnswer!).Order().SequenceEqual(quiz.Options.SelectMany(Tokens).Order()))
                    return false;
            }
            else if (quiz.Options.Length != 4 || quiz.CorrectIndex is < 0 or > 3) return false;
        }
        if (material.Dictation is { } dictation)
        {
            if (dictation.Length is < 1 or > 20 ||
                dictation.Select(x => x.Position).Distinct().Count() != dictation.Length) return false;
            foreach (var item in dictation)
            {
                if (item.Position < 1 || (segmentPositions is null ? item.Position > 20 :
                    !segmentPositions.Contains(item.Position)) || !Optional(item.Hint, 160) ||
                    item.AcceptedAnswers is not { Length: >= 1 and <= 5 } ||
                    item.AcceptedAnswers.Any(x => !Field(x, 600)) ||
                    !DictationModes.Contains(item.Mode) ||
                    (item.Mode is "missing-word" or "single-word") != item.TargetWordIndex.HasValue ||
                    item.TargetWordIndex is < 0 or > 99 ||
                    (item.Mode is not "single-word" &&
                        (item.AudioStartSeconds.HasValue || item.AudioEndSeconds.HasValue)) ||
                    (item.AudioStartSeconds.HasValue != item.AudioEndSeconds.HasValue) ||
                    (item.AudioStartSeconds is { } start && item.AudioEndSeconds is { } end &&
                        (!double.IsFinite(start) || !double.IsFinite(end) || start < 0 ||
                            end <= start || end - start > 10 || end > 600))) return false;
            }
        }
        return true;
    }

    public static DictationCard SuggestedDictation(int position, string text, string level, bool enabled)
    {
        var words = DictationTokens(text);
        if (level == "A1" && words.Length >= 2)
        {
            var target = words.Length / 2;
            return new DictationCard(position, enabled, [words[target]], null,
                "missing-word", target);
        }
        return new DictationCard(position, enabled, [text.Trim()]);
    }

    public static bool ValidDictationForSegments(LessonMaterial material,
        IReadOnlyList<LessonTranscriptSegment> segments)
    {
        if (material.Dictation is null) return true;
        var texts = segments.ToDictionary(x => x.Position, x => x.Text);
        foreach (var item in material.Dictation)
        {
            if (!texts.TryGetValue(item.Position, out var text)) return false;
            var words = DictationTokens(text);
            if (item.Mode == "word-order" &&
                (words.Length is < 3 or > 12 ||
                    item.AcceptedAnswers?.Any(x => DictationTokens(x).SequenceEqual(words)) != true)) return false;
            if (item.Mode is "missing-word" or "single-word")
            {
                if (item.TargetWordIndex is not { } target || target >= words.Length ||
                    (item.Mode == "missing-word" && words.Length < 2) ||
                    item.AcceptedAnswers?.Any(x => DictationTokens(x).Length != 1) != false ||
                    !item.AcceptedAnswers.Any(x => DictationTokens(x).SequenceEqual([words[target]]))) return false;
                if (item.Mode == "single-word" && words.Length > 1 &&
                    (!item.AudioStartSeconds.HasValue || !item.AudioEndSeconds.HasValue)) return false;
            }
            else if (item.TargetWordIndex.HasValue) return false;
        }
        return true;
    }

    // The teacher selects a word or a word order, not an AI-generated answer key.
    // Rebuild that key from the saved lesson transcript so a stale textarea value
    // cannot make an otherwise valid selection fail to save.
    public static LessonMaterial WithSelectedDictationAnswers(LessonMaterial material,
        IReadOnlyList<LessonTranscriptSegment> segments)
    {
        if (material.Dictation is null) return material;
        var texts = segments.ToDictionary(x => x.Position, x => x.Text);
        return material with { Dictation = material.Dictation.Select(item =>
        {
            if (!texts.TryGetValue(item.Position, out var text)) return item;
            if (item.Mode == "word-order")
                return item with { AcceptedAnswers = [text.Trim()] };
            if (item.Mode is "missing-word" or "single-word" &&
                item.TargetWordIndex is { } target)
            {
                var words = DictationTokens(text);
                if (target >= 0 && target < words.Length)
                    return item with { AcceptedAnswers = [words[target]] };
            }
            return item;
        }).ToArray() };
    }

    public static string? DictationPrompt(DictationCard item, string text)
    {
        if (item.Mode != "missing-word" || item.TargetWordIndex is not { } target) return null;
        var matches = Regex.Matches(text, "[a-zA-Z0-9]+(?:'[a-zA-Z0-9]+)?");
        if (target >= matches.Count) return null;
        var match = matches[target];
        return string.Concat(text.AsSpan(0, match.Index), "_____",
            text.AsSpan(match.Index + match.Length));
    }

    public static string[] DictationWordOptions(string text)
    {
        var words = Regex.Matches(text, "[a-zA-Z0-9]+(?:'[a-zA-Z0-9]+)?")
            .Select(x => x.Value).ToArray();
        return words.Length < 2 ? words : words.Skip(1).Concat(words.Take(1)).ToArray();
    }

    private static string[] DictationTokens(string value) =>
        Regex.Matches(value.ToLowerInvariant(), "[a-z0-9]+(?:'[a-z0-9]+)?")
            .Select(x => x.Value).ToArray();

    public static ChatFeedback? ParseFeedback(string raw)
    {
        try
        {
            var result = JsonSerializer.Deserialize<ChatFeedback>(ObjectOnly(raw), Json);
            return result is not null && Field(result.Reply, 400) && Optional(result.Correction, 300) &&
                Optional(result.BetterAnswer, 300) && Optional(result.GrammarTip, 300) &&
                result.MetSteps is not { Length: > 6 } &&
                result.MetSteps?.All(x => Field(x, 160)) != false &&
                result.Issues is not { Length: > 3 } &&
                result.Issues?.All(x => Field(x.Original, 300) && Field(x.Suggested, 300) &&
                    Field(x.Reason, 160) && Field(x.Kind, 40)) != false ? result : null;
        }
        catch (JsonException) { return null; }
    }

    private static string[] Tokens(string value) => Regex.Matches(value.ToLowerInvariant(), "[a-z]+(?:['-][a-z]+)*")
        .Select(x => x.Value).ToArray();
    private static bool ContainsPhrase(string[] source, string[] phrase) => phrase.Length > 0 &&
        Enumerable.Range(0, Math.Max(0, source.Length - phrase.Length + 1))
            .Any(i => source.Skip(i).Take(phrase.Length).SequenceEqual(phrase));
    private static string ObjectOnly(string raw)
    {
        var start = raw.IndexOf('{'); var end = raw.LastIndexOf('}');
        return start < 0 || end < start ? raw : raw[start..(end + 1)];
    }
    private static string? ReadString(JsonElement root, string name) =>
        root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString() : null;
    private static bool Field(string? value, int max) =>
        !string.IsNullOrWhiteSpace(value) && value.Trim().Length <= max;
    private static bool Optional(string? value, int max) => value is null || value.Trim().Length <= max;
}
