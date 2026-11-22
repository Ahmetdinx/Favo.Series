namespace Favo.Series.Api;

public sealed record HighlightFilm(MovieCard Movie, int[] Genres, decimal? Score, int Ratings, int Viewers, string[] Strengths);

/// <summary>A list and the period it covers: "week", "month", "year" or "all" when the shorter periods were too quiet.</summary>
public sealed record HighlightList(string Period, HighlightFilm[] Films);

public sealed record FilmHighlightsResult(HighlightList Star, HighlightList MostWatched);

/// <summary>
/// The general picks on the home page, the film counterpart of Kitap's "Herkesin rafından": the week's star (highest
/// rated) and the month's most watched (most often marked "İzledim"). A quiet period widens to the next one only when
/// that adds films. For a signed-in viewer, films they are watching, have watched, paused, dropped, rated or turned
/// down are left out.
/// </summary>
public static class FilmHighlights
{
    public const int StarCount = 5;
    public const int MostWatchedCount = 6;

    /// <summary>Every film starts with two votes of 7, an ordinary good score: two 9s rank above a single 10.</summary>
    public const decimal PriorWeight = 2;
    public const decimal PriorScore = 7;

    /// <summary>A criterion counts as a strength when viewers give it this average or more; the home page matches it to the viewer's chosen criteria.</summary>
    public const decimal StrengthThreshold = 8;

    private static readonly (string Period, int? Days)[] StarPeriods = [("week", 7), ("month", 30), ("year", 365), ("all", null)];
    private static readonly (string Period, int? Days)[] WatchPeriods = [("month", 30), ("year", 365), ("all", null)];

    /// <summary>Films that can appear: rated or watched by someone. The caller loads these from the catalog.</summary>
    public static int[] CandidateIds(IEnumerable<MovieEntry> entries) =>
        entries.Where(e => e.Overall is not null || e.State == "watched").Select(e => e.MovieId).Distinct().ToArray();

    /// <summary>The viewer's own started or rated films and the suggestions they dismissed: never suggested back.</summary>
    public static HashSet<int> Excluded(IEnumerable<MovieEntry> entries, IEnumerable<MovieFeedback> feedback, Guid viewer) =>
        entries.Where(e => e.UserId == viewer && (e.State is "watching" or "watched" or "paused" or "dropped" || e.Scores is not null))
            .Select(e => e.MovieId)
            .Concat(feedback.Where(f => f.UserId == viewer && f.Choice == "dismissed").Select(f => f.MovieId))
            .ToHashSet();

    public static decimal Weighted(decimal average, int count) =>
        (average * count + PriorScore * PriorWeight) / (count + PriorWeight);

    public static FilmHighlightsResult Build(MovieEntry[] entries, IReadOnlyDictionary<int, MovieDetails> films, HashSet<int> excluded, DateTimeOffset now)
    {
        var rated = entries.Where(e => e.Overall is not null).ToArray();
        bool Shown(int id) => films.ContainsKey(id) && !excluded.Contains(id);

        HighlightList star = new("week", []);
        foreach (var (period, days) in StarPeriods)
        {
            DateTimeOffset since = days is int d ? now.AddDays(-d) : DateTimeOffset.MinValue;
            HighlightFilm[] list = rated.Where(e => e.UpdatedAtUtc >= since && Shown(e.MovieId))
                .GroupBy(e => e.MovieId)
                .Select(g => (Id: g.Key, Average: g.Average(e => e.Overall!.Value), Votes: g.ToArray()))
                .OrderByDescending(r => Weighted(r.Average, r.Votes.Length)).ThenByDescending(r => r.Votes.Length).ThenBy(r => r.Id)
                .Take(StarCount)
                .Select(r => Film(films[r.Id], Math.Round(r.Average, 1), r.Votes.Length, 0, Strengths(r.Votes)))
                .ToArray();
            if (list.Length > star.Films.Length) star = new(period, list);
            if (list.Length >= 3) break;
        }

        HighlightList watched = new("month", []);
        foreach (var (period, days) in WatchPeriods)
        {
            DateTimeOffset since = days is int d ? now.AddDays(-d) : DateTimeOffset.MinValue;
            HighlightFilm[] list = entries.Where(e => e.State == "watched" && (e.WatchedAtUtc ?? e.UpdatedAtUtc) >= since && Shown(e.MovieId))
                .GroupBy(e => e.MovieId)
                .Select(g => (Id: g.Key, Viewers: g.Count(), Latest: g.Max(e => e.WatchedAtUtc ?? e.UpdatedAtUtc)))
                .OrderByDescending(r => r.Viewers).ThenByDescending(r => r.Latest).ThenBy(r => r.Id)
                .Take(MostWatchedCount)
                .Select(r => Film(films[r.Id], null, 0, r.Viewers, []))
                .ToArray();
            if (list.Length > watched.Films.Length) watched = new(period, list);
            if (list.Length >= 4) break;
        }
        return new(star, watched);
    }

    /// <summary>The criteria viewers rated highest for a film, strongest first.</summary>
    public static string[] Strengths(MovieEntry[] votes) =>
        MovieRecommendations.Criteria.Keys
            .Select(key => (Key: key, Average: votes.Average(v => (decimal)v.Scores![key])))
            .Where(c => c.Average >= StrengthThreshold)
            .OrderByDescending(c => c.Average)
            .Select(c => c.Key)
            .ToArray();

    private static HighlightFilm Film(MovieDetails details, decimal? score, int ratings, int viewers, string[] strengths) =>
        new(details.Movie, details.Genres.Select(g => g.Id).ToArray(), score, ratings, viewers, strengths);
}
