using System.Text.Json;
using System.Text.RegularExpressions;

namespace ShadowingEnglish.Api.Modules.AI;

// Optional fields keep lessons approved before the V1 activity port readable.
public sealed record VocabularyCard(string Word, string MeaningAr, string ExampleEn, string ExampleAr,
    string Kind = "word", bool IncludeForStudent = true, string? Explanation = null,
    string? ExtraExample = null, string? UsageNote = null, bool TestLater = false);
public sealed record DictationCard(int Position, bool Enabled = true, string[]? AcceptedAnswers = null,
    string? Hint = null);
public sealed record LessonTranscriptSegment(int Position, string Text);
public sealed record QuizCard(string Question, string[] Options, int CorrectIndex, string ExplanationAr,
    string Type = "multiple-choice", bool Enabled = true, string? CorrectAnswer = null);
public sealed record LessonMaterial(VocabularyCard[] Vocabulary, QuizCard[] Quiz, string GrammarFocus,
    string ConversationScenario, DictationCard[]? Dictation = null, string[]? ConversationGoals = null,
    string? AiRole = null, string? StudentRole = null, string? OpeningMessage = null,
    bool ShadowingReviewEnabled = false, string[]? ReviewedStages = null);
public sealed record ChatFeedback(string Reply, string Correction, string BetterAnswer, string GrammarTip);

public static class LessonMaterialRules
{
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private static readonly string[] Stages = ["vocabulary", "listen-type", "quiz", "conversation"];

    public static bool ReadyToApprove(LessonMaterial material) =>
        material.ReviewedStages is { } reviewed && Stages.All(reviewed.Contains);

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
            return Valid(normalized, source) ? normalized : null;
        }
        catch (JsonException) { return null; }
    }

    public static LessonMaterial? PrepareDraft(LessonMaterial generated,
        IReadOnlyList<LessonTranscriptSegment> segments)
    {
        var dictation = segments.Where(x => x.Text.Trim().Length is >= 1 and <= 600)
            .Select(x => new DictationCard(x.Position, true, [x.Text.Trim()], null)).ToArray();
        if (dictation.Length == 0) return null;
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
            Quiz = quiz.ToArray(), Dictation = dictation,
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
        if (material is null || material.Vocabulary is not { Length: >= 1 and <= 20 } ||
            material.Quiz is not { Length: >= 1 and <= 12 } ||
            !Field(material.GrammarFocus, 200) || !Field(material.ConversationScenario, 240) ||
            !Optional(material.AiRole, 100) || !Optional(material.StudentRole, 100) ||
            !Optional(material.OpeningMessage, 240) ||
            material.ConversationGoals is { Length: > 6 } ||
            material.ConversationGoals?.Any(x => !Field(x, 160)) == true ||
            material.ReviewedStages is { } reviewed &&
                (reviewed.Length > Stages.Length || reviewed.Distinct().Count() != reviewed.Length ||
                    reviewed.Any(x => !Stages.Contains(x)))) return false;

        var sourceWords = Tokens(source);
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var card in material.Vocabulary)
        {
            if (card is null || !Field(card.Word, 80) || !Field(card.MeaningAr, 120) ||
                !Field(card.ExampleEn, 200) || !Field(card.ExampleAr, 200) ||
                !Optional(card.Explanation, 300) || !Optional(card.ExtraExample, 200) ||
                !Optional(card.UsageNote, 200) || card.Kind is not ("word" or "chunk") ||
                !seen.Add(card.Word.Trim()) ||
                !Regex.IsMatch(card.Word, "^[a-zA-Z]+(?:['-][a-zA-Z]+)*(?: [a-zA-Z]+(?:['-][a-zA-Z]+)*)*$") ||
                (card.Kind == "word" && card.Word.Contains(' ')) ||
                (card.Kind == "chunk" && !card.Word.Contains(' ')) ||
                !ContainsPhrase(sourceWords, Tokens(card.Word))) return false;
        }
        if (!material.Vocabulary.Any(x => x.IncludeForStudent) || !material.Quiz.Any(x => x.Enabled)) return false;
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
            return result is not null && Field(result.Reply, 400) && Field(result.Correction, 300) &&
                Field(result.BetterAnswer, 300) && Field(result.GrammarTip, 300) ? result : null;
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
    private static bool Field(string? value, int max) =>
        !string.IsNullOrWhiteSpace(value) && value.Trim().Length <= max;
    private static bool Optional(string? value, int max) => value is null || value.Trim().Length <= max;
}
