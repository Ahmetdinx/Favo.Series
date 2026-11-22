namespace Favo.Series.Api;

public sealed record AchievementBadge(int Threshold, string Title);
public sealed record AchievementTrack(string Kind, string Label, int Count, AchievementBadge? Current,
    AchievementBadge? Next, int Remaining, int ProgressPercent, AchievementBadge[] Badges);

public sealed record TasteGenre(int Id, string Name, int Percent);
public sealed record TasteCriterion(string Key, string Label);
public sealed record FilmTasteProfile(bool Ready, int WatchedCount, int RatingCount, int FilmsNeeded, int RatingsNeeded,
    string? Title, TasteGenre[] Genres, TasteCriterion[] Strengths, string[] Traits, decimal? AverageScore, MovieCard? Signature);

public sealed record SummaryFilm(MovieCard Movie, string[] Directors, int? Runtime, DateTimeOffset WatchedAtUtc, decimal? Score);
public sealed record SummaryGenre(int Id, string Name, int Count);
public sealed record SummaryDirector(string Name, int Count);
public sealed record SummaryMonth(int Month, int Count);
public sealed record FilmSummary(int Year, int? Month, int[] AvailableYears, int FilmCount, int Minutes, int PreviousFilmCount,
    SummaryMonth[] Months, SummaryGenre[] Genres, SummaryDirector? TopDirector, decimal? AverageScore,
    SummaryFilm? Favorite, SummaryFilm? Longest, SummaryFilm[] Films);

/// <summary>Film counterparts of the Books badges, viewer identity and monthly/yearly summary, built from a viewer's own entries.</summary>
public sealed record CompatibilitySuggestion(MovieCard Movie, decimal? Score);
public sealed record FilmCompatibility(bool Ready, int? Percent, string? Label, string[] SharedGenres, int CommonFilms, int ComparedRatings, CompatibilitySuggestion[] Suggestions);

public static class FilmJourney
{
    public const int MinimumFilms = 5;
    public const int MinimumRatings = 3;
    // Türkiye has used a fixed UTC+3 offset since 2016; summary periods follow the viewer's calendar.
    static readonly TimeSpan Turkey = TimeSpan.FromHours(3);

    public static AchievementTrack[] Achievements(int watched, int rated) =>
    [
        Track("watching", "İzleme", watched, [new(1, "İlk Bölüm"), new(10, "Dizisever"), new(100, "Dizi Kurdu"), new(1000, "Yaşayan Arşiv")]),
        Track("evaluation", "Değerlendirme", rated, [new(1, "İlk İzlenim"), new(10, "Dikkatli İzleyici"), new(100, "Dizi Eleştirmeni"), new(1000, "Usta Eleştirmen")]),
    ];

    public static AchievementTrack[] Achievements(MovieEntry[] entries) =>
        Achievements(entries.Count(e => e.State == "watched"), entries.Count(e => e.Overall is not null));

    static AchievementTrack Track(string kind, string label, int count, AchievementBadge[] badges)
    {
        ArgumentOutOfRangeException.ThrowIfNegative(count);
        var current = badges.LastOrDefault(b => b.Threshold <= count);
        var next = badges.FirstOrDefault(b => b.Threshold > count);
        var floor = current?.Threshold ?? 0;
        var percent = next is null ? 100 : (int)((long)(count - floor) * 100 / (next.Threshold - floor));
        return new(kind, label, count, current, next, next is null ? 0 : next.Threshold - count, percent, badges);
    }

    // TMDB genre ids → single-genre archetype, the character noun and the flavour adjective for two-genre titles.
    static readonly Dictionary<int, (string Archetype, string Character, string Flavour)> Identities = new()
    {
        [28] = ("Aksiyon tutkunu", "aksiyoncu", "Adrenalin dolu"),
        [12] = ("Serüven tutkunu", "serüvenci", "Maceraperest"),
        [16] = ("Çizgi ruhlu izleyici", "animasyon sever", "Renkli"),
        [35] = ("Gülümseyen izleyici", "neşeli izleyici", "Esprili"),
        [80] = ("Kara dosyaların takipçisi", "suç avcısı", "Sert"),
        [99] = ("Gerçeğin tanığı", "belgeselci", "Meraklı"),
        [18] = ("Hayatın tanığı", "hayat gözlemcisi", "Derinlere dalan"),
        [10751] = ("Aile izleyicisi", "aile izleyicisi", "Sıcakkanlı"),
        [14] = ("Hayal gezgini", "hayal gezgini", "Hayalperest"),
        [36] = ("Zaman yolcusu", "zaman yolcusu", "Geçmişe tutkun"),
        [27] = ("Karanlığı seven izleyici", "gece kuşu", "Karanlığa meraklı"),
        [10402] = ("Ritmi seven izleyici", "melodi avcısı", "Ritim tutkunu"),
        [9648] = ("Dedektif ruhlu izleyici", "dedektif", "Gizem peşindeki"),
        [10749] = ("Romantik ruh", "romantik", "Duygusal"),
        [878] = ("Gelecek meraklısı", "gelecek meraklısı", "Geleceğe bakan"),
        [10770] = ("Ekran dostu", "ekran dostu", "Rahat"),
        [53] = ("Gerilim avcısı", "gerilim avcısı", "Nefesini tutan"),
        [10752] = ("Cephe tanığı", "cephe tanığı", "Cesur"),
        [37] = ("Sınır kovboyu", "kovboy", "Tozlu yolların"),
    };

    /// <summary>A second genre with at least a 20% share adds its flavour; otherwise the single archetype stands.</summary>
    public static string IdentityTitle(TasteGenre[] top)
    {
        if (top.Length == 0) return "Meraklı izleyici";
        if (top.Length > 1 && top[1].Percent >= 20 && Identities.TryGetValue(top[0].Id, out var first) && Identities.TryGetValue(top[1].Id, out var second))
            return second.Flavour + " " + first.Character;
        return Identities.TryGetValue(top[0].Id, out var single) ? single.Archetype : "Meraklı izleyici";
    }

    /// <summary>
    /// Genres weigh watched films equally and rated films by how much the viewer liked them (0.2 for 1/10 to 2 for 10/10);
    /// strengths are criteria clearly above the film's own average in the films the viewer liked at least as much as their median.
    /// </summary>
    public static FilmTasteProfile Taste(MovieEntry[] entries, IReadOnlyDictionary<int, MovieDetails> films)
    {
        var known = entries.Where(e => films.ContainsKey(e.MovieId)).ToArray();
        var watched = known.Where(e => e.State == "watched").ToArray();
        var rated = known.Where(e => e.Overall is not null).ToArray();
        var filmsNeeded = Math.Max(0, MinimumFilms - watched.Length);
        var ratingsNeeded = Math.Max(0, MinimumRatings - rated.Length);
        if (filmsNeeded > 0 && ratingsNeeded > 0)
            return new(false, watched.Length, rated.Length, filmsNeeded, ratingsNeeded, null, [], [], [], null, null);

        var weights = watched.Concat(rated).DistinctBy(e => e.MovieId)
            .ToDictionary(e => e.MovieId, e => e.Overall is decimal score ? 0.2m + 1.8m * (score - 1) / 9 : 1m);
        var scores = new Dictionary<int, (string Name, decimal Score)>();
        foreach (var (id, weight) in weights)
            foreach (var genre in films[id].Genres)
                scores[genre.Id] = (genre.Name, (scores.TryGetValue(genre.Id, out var s) ? s.Score : 0) + weight);
        var total = scores.Values.Sum(s => s.Score);
        var top = total == 0 ? [] : scores.OrderByDescending(s => s.Value.Score).ThenBy(s => s.Key).Take(3)
            .Select(s => new TasteGenre(s.Key, s.Value.Name, (int)Math.Round(s.Value.Score / total * 100))).ToArray();

        var traits = new List<string>();
        var dated = weights.Keys.Select(id => films[id].Movie.Year).OfType<int>().ToArray();
        if (dated.Length > 0 && dated.Count(year => year < 1980) * 2 >= dated.Length)
            traits.Add("Klasik dizilere sadık");
        decimal? average = rated.Length > 0 ? Math.Round(rated.Average(e => e.Overall!.Value), 1) : null;
        if (rated.Length >= MinimumRatings)
            traits.Add(average >= 8.2m ? "Cömert puanlayıcı" : average <= 6.2m ? "Titiz puanlayıcı" : "Dengeli puanlayıcı");
        if (top.Length >= 3 && top[0].Percent < 35) traits.Add("Türler arasında gezen");

        // The signature film is the best-loved rated film; it needs a clear 8/10 to speak for the viewer.
        var signature = rated.Where(e => e.Overall >= 8).OrderByDescending(e => e.Overall).ThenBy(e => e.MovieId).FirstOrDefault();
        return new(true, watched.Length, rated.Length, filmsNeeded, ratingsNeeded, IdentityTitle(top), top,
            rated.Length >= MinimumRatings ? Strengths(rated) : [], traits.ToArray(), average,
            signature is null ? null : films[signature.MovieId].Movie);
    }

    /// <summary>
    /// How close two viewers' tastes are, as on Books: genre leanings always count; once both rated the same films,
    /// their score agreement weighs in too (up to half, reached at five shared ratings).
    /// </summary>
    public static FilmCompatibility Compatibility(MovieEntry[] mine, MovieEntry[] theirs, IReadOnlyDictionary<int, MovieDetails> films)
    {
        mine = mine.Where(e => films.ContainsKey(e.MovieId)).ToArray();
        theirs = theirs.Where(e => films.ContainsKey(e.MovieId)).ToArray();
        if (!IsReady(mine) || !IsReady(theirs)) return new(false, null, null, [], 0, 0, []);
        var myGenres = GenreWeights(mine, films); var theirGenres = GenreWeights(theirs, films);
        var similarity = 0.1 + 0.9 * Cosine(myGenres, theirGenres);
        var theirScores = theirs.Where(e => e.Overall is not null).ToDictionary(e => e.MovieId, e => e.Overall!.Value);
        var pairs = mine.Where(e => e.Overall is not null && theirScores.ContainsKey(e.MovieId)).Select(e => (Mine: e.Overall!.Value, Theirs: theirScores[e.MovieId])).ToArray();
        if (pairs.Length > 0)
        {
            var agreement = 1 - (double)pairs.Average(p => Math.Abs(p.Mine - p.Theirs)) / 9;
            var weight = Math.Min(pairs.Length, 5) / 10.0;
            similarity = (1 - weight) * similarity + weight * agreement;
        }
        var percent = (int)Math.Round(Math.Clamp(similarity, 0, 1) * 100);
        var mySeen = Seen(mine).ToHashSet();
        var common = Seen(theirs).Count(mySeen.Contains);
        var myTotal = myGenres.Values.Sum(g => g.Score); var theirTotal = theirGenres.Values.Sum(g => g.Score);
        var shared = myGenres.Where(g => theirGenres.ContainsKey(g.Key))
            .Select(g => (g.Value.Name, Share: Math.Min(g.Value.Score / myTotal, theirGenres[g.Key].Score / theirTotal)))
            .Where(g => g.Share >= 0.1m).OrderByDescending(g => g.Share).ThenBy(g => g.Name).Take(3).Select(g => g.Name).ToArray();
        // Their loved films (8+) that I have not touched in any list yet.
        var touched = mine.Select(e => e.MovieId).ToHashSet();
        var suggestions = theirScores.Where(s => s.Value >= 8 && !touched.Contains(s.Key)).OrderByDescending(s => s.Value).ThenBy(s => s.Key).Take(3)
            .Select(s => new CompatibilitySuggestion(films[s.Key].Movie, Math.Round(s.Value, 1))).ToArray();
        return new(true, percent, CompatibilityLabel(percent), shared, common, pairs.Length, suggestions);
    }

    static IEnumerable<int> Seen(MovieEntry[] entries) => entries.Where(e => e.State == "watched" || e.Overall is not null).Select(e => e.MovieId).Distinct();
    static bool IsReady(MovieEntry[] entries) => entries.Count(e => e.Overall is not null) >= MinimumRatings || entries.Count(e => e.State == "watched") >= MinimumFilms;

    /// <summary>Genre weights from watched and rated films; a rating scales its film between 0.2 and 2.</summary>
    static Dictionary<int, (string Name, decimal Score)> GenreWeights(MovieEntry[] entries, IReadOnlyDictionary<int, MovieDetails> films)
    {
        var scores = new Dictionary<int, (string Name, decimal Score)>();
        foreach (var e in entries.Where(e => e.State == "watched" || e.Overall is not null).DistinctBy(e => e.MovieId))
        {
            var weight = e.Overall is decimal score ? 0.2m + 1.8m * (score - 1) / 9 : 1m;
            foreach (var genre in films[e.MovieId].Genres)
                scores[genre.Id] = (genre.Name, (scores.TryGetValue(genre.Id, out var s) ? s.Score : 0) + weight);
        }
        return scores;
    }

    static double Cosine(Dictionary<int, (string Name, decimal Score)> a, Dictionary<int, (string Name, decimal Score)> b)
    {
        var dot = a.Where(x => b.ContainsKey(x.Key)).Sum(x => (double)(x.Value.Score * b[x.Key].Score));
        var norm = Math.Sqrt(a.Values.Sum(v => (double)(v.Score * v.Score))) * Math.Sqrt(b.Values.Sum(v => (double)(v.Score * v.Score)));
        return norm == 0 ? 0 : dot / norm;
    }

    public static string CompatibilityLabel(int percent) => percent switch
    {
        >= 85 => "Dizi ikizi",
        >= 70 => "Çok uyumlu",
        >= 50 => "Ortak kanallar",
        >= 30 => "Farklı kanallar",
        _ => "Farklı dünyalar"
    };

    static TasteCriterion[] Strengths(MovieEntry[] rated)
    {
        var keys = MovieRecommendations.Criteria.Keys.ToArray();
        var median = rated.Select(e => e.Overall!.Value).Order().ElementAt(rated.Length / 2);
        var liked = rated.Where(e => e.Overall >= median).ToArray();
        return keys.Select(key => (Key: key, Lift: liked.Average(e => e.Scores![key] - e.Scores!.Values.Average())))
            .OrderByDescending(x => x.Lift).Where(x => x.Lift >= 0.3).Take(2)
            .Select(x => new TasteCriterion(x.Key, MovieRecommendations.Criteria[x.Key])).ToArray();
    }

    public static bool IsValidPeriod(int year, int? month) => year is >= 2000 and <= 2100 && month is null or (>= 1 and <= 12);

    /// <summary>When the film was marked watched; entries saved before this was recorded fall back to their last update.</summary>
    public static DateTimeOffset? WatchedAt(MovieEntry entry) => entry.State == "watched" ? entry.WatchedAtUtc ?? entry.UpdatedAtUtc : null;

    public static FilmSummary Summary(MovieEntry[] entries, IReadOnlyDictionary<int, MovieDetails> films, int year, int? month, DateTimeOffset now)
    {
        var watched = entries.Where(e => films.ContainsKey(e.MovieId) && WatchedAt(e) is not null)
            // A watched series counts its whole run: episode length times episodes (one episode when the count is unknown).
            .Select(e => new SummaryFilm(films[e.MovieId].Movie, films[e.MovieId].Directors, films[e.MovieId].Runtime * (films[e.MovieId].Episodes ?? 1), WatchedAt(e)!.Value, e.Overall))
            .ToArray();
        var inPeriod = watched.Where(f => InPeriod(f.WatchedAtUtc, year, month)).OrderByDescending(f => f.WatchedAtUtc).ToArray();
        var (previousYear, previousMonth) = month is null ? (year - 1, (int?)null) : month == 1 ? (year - 1, 12) : (year, month - 1);
        var years = watched.Select(f => Local(f.WatchedAtUtc).Year).Append(Local(now).Year).Distinct().OrderDescending().ToArray();

        var months = month is null
            ? Enumerable.Range(1, 12).Select(m => new SummaryMonth(m, inPeriod.Count(f => Local(f.WatchedAtUtc).Month == m))).ToArray()
            : [];
        var genres = inPeriod.SelectMany(f => films[f.Movie.Id].Genres).GroupBy(g => g.Id)
            .Select(g => new SummaryGenre(g.Key, g.First().Name, g.Count()))
            .OrderByDescending(g => g.Count).ThenBy(g => g.Name, StringComparer.Ordinal).Take(3).ToArray();
        // A favourite director needs at least two films in the period; ties go to the alphabetically first name.
        var director = inPeriod.SelectMany(f => f.Directors.Take(1)).GroupBy(d => d)
            .Select(g => new SummaryDirector(g.Key, g.Count())).Where(d => d.Count >= 2)
            .OrderByDescending(d => d.Count).ThenBy(d => d.Name, StringComparer.Ordinal).FirstOrDefault();
        var rated = inPeriod.Where(f => f.Score is not null).ToArray();
        decimal? average = rated.Length > 0 ? Math.Round(rated.Average(f => f.Score!.Value), 1) : null;
        var favorite = rated.OrderByDescending(f => f.Score).ThenByDescending(f => f.WatchedAtUtc).FirstOrDefault();
        var longest = inPeriod.Where(f => f.Runtime is not null && f.Movie.Id != favorite?.Movie.Id)
            .OrderByDescending(f => f.Runtime).ThenBy(f => f.Movie.Title, StringComparer.Ordinal).FirstOrDefault();
        return new(year, month, years, inPeriod.Length, inPeriod.Sum(f => f.Runtime ?? 0),
            watched.Count(f => InPeriod(f.WatchedAtUtc, previousYear, previousMonth)), months, genres, director, average,
            favorite, inPeriod.Length > 1 ? longest : null, inPeriod);
    }

    static DateTimeOffset Local(DateTimeOffset utc) => utc.ToOffset(Turkey);
    static bool InPeriod(DateTimeOffset utc, int year, int? month) { var local = Local(utc); return local.Year == year && (month is null || local.Month == month); }
}
