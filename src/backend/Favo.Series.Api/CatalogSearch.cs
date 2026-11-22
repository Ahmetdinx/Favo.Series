using System.Text;
using Npgsql;

namespace Favo.Series.Api;

/// <summary>
/// Spelling-tolerant word comparison (mirrors Books' TextMatch): Turkish letters folded, and a "loose" form that ignores
/// the usual transliteration differences (Tarkovski / Tarkovsky, Kubrik / Kubrick).
/// </summary>
public static class TextMatch
{
    public static string[] Words(string? value) => CatalogText.Normalize(value).Split(' ', StringSplitOptions.RemoveEmptyEntries);

    /// <summary>sh/ch/ph/th/ck/w/q/x/j spellings unified, doubled letters collapsed, "y" after a vowel dropped, other "y" read as "i".</summary>
    public static string Loose(string word)
    {
        var w = word.Replace("sch", "s").Replace("sh", "s").Replace("ch", "c").Replace("ph", "f").Replace("th", "t")
            .Replace("ck", "k").Replace('w', 'v').Replace('q', 'k').Replace("x", "ks").Replace('j', 'y');
        StringBuilder result = new(w.Length);
        foreach (var c in w)
        {
            if (result.Length > 0 && result[^1] == c) continue;
            if (c == 'y' && result.Length > 0 && "aeiou".Contains(result[^1])) continue;
            result.Append(c == 'y' ? 'i' : c);
        }
        return result.ToString();
    }

    /// <summary>Levenshtein distance, stopping early once it exceeds <paramref name="limit"/>.</summary>
    public static int Distance(string a, string b, int limit)
    {
        if (Math.Abs(a.Length - b.Length) > limit) return limit + 1;
        var previous = new int[b.Length + 1];
        var current = new int[b.Length + 1];
        for (var j = 0; j <= b.Length; j++) previous[j] = j;
        for (var i = 1; i <= a.Length; i++)
        {
            current[0] = i;
            var rowMin = current[0];
            for (var j = 1; j <= b.Length; j++)
            {
                current[j] = Math.Min(Math.Min(current[j - 1] + 1, previous[j] + 1), previous[j - 1] + (a[i - 1] == b[j - 1] ? 0 : 1));
                rowMin = Math.Min(rowMin, current[j]);
            }
            if (rowMin > limit) return limit + 1;
            (previous, current) = (current, previous);
        }
        return previous[b.Length];
    }

    /// <summary>Allowed typos for a word of this length: none below 5 letters, one up to 8, then two.</summary>
    public static int Tolerance(int length) => length < 5 ? 0 : length <= 8 ? 1 : 2;

    public static bool SimilarWord(string a, string b)
    {
        if (a == b) return true;
        var la = Loose(a);
        var lb = Loose(b);
        if (la == lb) return true;
        var tolerance = Tolerance(Math.Min(la.Length, lb.Length));
        return tolerance > 0 && Distance(la, lb, tolerance) <= tolerance;
    }

    /// <summary>A word matches a typed term when it starts with it, or is the same word up to spelling.</summary>
    public static bool Matches(string word, string term)
    {
        if (term.Length >= 3 && word.StartsWith(term, StringComparison.Ordinal)) return true;
        if (SimilarWord(word, term)) return true;
        // A partly typed long word: "tarkovs" finds "tarkovsky".
        if (term.Length < 5) return false;
        var looseWord = Loose(word);
        var looseTerm = Loose(term);
        if (looseWord.StartsWith(looseTerm, StringComparison.Ordinal)) return true;
        return looseWord.Length > looseTerm.Length && Distance(looseWord[..looseTerm.Length], looseTerm, 1) <= 1;
    }
}

/// <summary>
/// Folded title and director words of every visible film, used only when an exact search finds nothing
/// ("Godfater", "Kubrik", "Yüzüklerin Efendsi"). Rebuilt every few minutes; the catalog changes only through offline imports.
/// </summary>
public sealed class CatalogSearchVocabulary(NpgsqlDataSource db)
{
    public sealed record Entry(int FilmId, string[] Words);

    const int MaximumMatches = 300;
    static readonly TimeSpan Lifetime = TimeSpan.FromMinutes(10);
    readonly SemaphoreSlim gate = new(1, 1);
    (DateTimeOffset BuiltAt, Entry[] Entries)? cache;

    public async Task<int[]> Find(string query, CancellationToken ct)
    {
        var terms = TextMatch.Words(query).Distinct().Take(8).ToArray();
        if (terms.Length == 0 || terms.All(t => t.Length < 3)) return [];
        return Find(await Entries(ct), terms).Take(MaximumMatches).ToArray();
    }

    /// <summary>Films whose words cover every typed term; short filler terms ("the", "ve") may stay unmatched when longer ones match.</summary>
    public static IEnumerable<int> Find(IEnumerable<Entry> entries, string[] terms)
    {
        var required = terms.Where(t => t.Length >= 3).ToArray();
        return entries.Where(e => required.All(term => e.Words.Any(word => TextMatch.Matches(word, term)))).Select(e => e.FilmId);
    }

    async Task<Entry[]> Entries(CancellationToken ct)
    {
        if (cache is { } fresh && DateTimeOffset.UtcNow - fresh.BuiltAt < Lifetime) return fresh.Entries;
        await gate.WaitAsync(ct);
        try
        {
            if (cache is { } built && DateTimeOffset.UtcNow - built.BuiltAt < Lifetime) return built.Entries;
            await using var command = db.CreateCommand("SELECT f.id, f.title, f.original_title, f.directors FROM series.visible_films f");
            await using var reader = await command.ExecuteReaderAsync(ct);
            List<Entry> entries = [];
            while (await reader.ReadAsync(ct))
            {
                var texts = new[] { reader.GetString(1), reader.IsDBNull(2) ? null : reader.GetString(2) }.Concat(reader.GetFieldValue<string[]>(3));
                entries.Add(new(reader.GetInt32(0), texts.SelectMany(TextMatch.Words).Distinct().ToArray()));
            }
            cache = (DateTimeOffset.UtcNow, entries.ToArray());
            return cache.Value.Entries;
        }
        finally { gate.Release(); }
    }
}
