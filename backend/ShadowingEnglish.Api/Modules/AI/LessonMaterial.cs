using System.Text.Json;
using System.Text.RegularExpressions;

namespace ShadowingEnglish.Api.Modules.AI;

// Optional fields keep lessons approved before the V1 activity port readable.
public sealed record VocabularyCard(string Word, string MeaningAr, string ExampleEn, string ExampleAr,
    string Kind = "word", bool IncludeForStudent = true, string? Explanation = null,
    string? ExtraExample = null, string? UsageNote = null, bool TestLater = false,
    string? ImageUrl = null, bool RepeatForReview = false);
public sealed record DictationCard(int Position, bool Enabled = true, string[]? AcceptedAnswers = null,
    string? Hint = null);
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
    int? VocabularyTargetCount = null);
public sealed record ChatFeedback(string Reply, string Correction, string BetterAnswer, string GrammarTip,
    bool? FocusMet = null);

public static class LessonMaterialRules
{
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

    public static int ConversationTurns(LessonMaterial material) => material.ConversationTurnTarget ?? 10;
    public static bool CountsConversationTurn(LessonMaterial material, ChatFeedback feedback) =>
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
        string source, IReadOnlyList<LessonTranscriptSegment> segments)
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
                    var goals = root.TryGetProperty("conversationGoals", out var goalsJson) &&
                        goalsJson.ValueKind == JsonValueKind.Array
                        ? goalsJson.Deserialize<string[]>(Json) : null;
                    result = current with
                    {
                        ConversationScenario = scenario.Trim(), ConversationGoals = goals,
                        OpeningMessage = scenario.Trim()
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

    public static LessonMaterial? PrepareDraft(LessonMaterial generated,
        IReadOnlyList<LessonTranscriptSegment> segments, string level = "B1")
    {
        var dictation = segments.Where(x => x.Text.Trim().Length is >= 1 and <= 600 &&
                (level != "A1" || Tokens(x.Text).Length <= 8))
            .Select(x => new DictationCard(x.Position, true, [x.Text.Trim()], null)).ToArray();
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
            segments.Select(x => x.Position).ToArray()) ? material : null;
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
            if (dictation.Length is < 1 or > 20 || !dictation.Any(x => x.Enabled) ||
                dictation.Select(x => x.Position).Distinct().Count() != dictation.Length) return false;
            foreach (var item in dictation)
            {
                if (item.Position < 1 || (segmentPositions is null ? item.Position > 20 :
                    !segmentPositions.Contains(item.Position)) || !Optional(item.Hint, 160) ||
                    item.AcceptedAnswers is not { Length: >= 1 and <= 5 } ||
                    item.AcceptedAnswers.Any(x => !Field(x, 600))) return false;
            }
        }
        return true;
    }

    public static ChatFeedback? ParseFeedback(string raw)
    {
        try
        {
            var result = JsonSerializer.Deserialize<ChatFeedback>(ObjectOnly(raw), Json);
            return result is not null && Field(result.Reply, 400) && Optional(result.Correction, 300) &&
                Optional(result.BetterAnswer, 300) && Optional(result.GrammarTip, 300) ? result : null;
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
