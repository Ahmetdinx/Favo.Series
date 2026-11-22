using Favo.Series.Api;
var count = 0;
void Check(bool value, string name) { if (!value) throw new Exception(name); count++; Console.WriteLine("PASS " + name); }
foreach (var query in new[] { new CatalogQuery("", 0, null, null, "popular"), new("", 501, null, null, "popular"), new(new string('x',121), 1, null, null, "popular"), new("", 1, 1000, null, "popular"), new("", 1, null, -1, "popular"), new("",1,null,null,"invalid"), new("",1,null,null,"top") })
 Check(!query.IsValid(), "Invalid filter rejected");
Check(new CatalogQuery("İstanbul", 1, 2001, 18, "newest").IsValid() && new CatalogQuery("", 1, null, null, "title").IsValid(), "Search can combine year, genre and order");
Check(CatalogText.Normalize("  İSTANBUL'da Şeker, Ağaç & Çiçek!  ") == "istanbul da seker agac cicek", "Search text is Turkish-aware and accent-free");
Check(CatalogText.Normalize("Amélie") == "amelie" && CatalogText.Normalize("IŞIK") == "isik" && CatalogText.Normalize(null) == "", "Accents and dotless i normalized");
// Spelling-tolerant fallback search and the daily mixed order.
Check(new CatalogQuery("", 1, null, null, "mixed").IsValid() && System.Text.RegularExpressions.Regex.IsMatch(MovieCatalog.MixedSeed(), @"^\d{4}-\d{2}-\d{2}$"), "Mixed order is valid and seeded by the date");
Check(TextMatch.Matches("godfather", "godfater") && TextMatch.Matches("kubrick", "kubrik") && TextMatch.Matches("tarkovsky", "tarkovski") && TextMatch.Matches("efendisi", "efendsi"), "Typos and transliterations match");
var vocabulary = new CatalogSearchVocabulary.Entry[] { new(1, ["the", "godfather", "francis", "ford", "coppola"]), new(2, ["yuzuklerin", "efendisi", "peter", "jackson"]), new(3, ["alien", "ridley", "scott"]) };
Check(CatalogSearchVocabulary.Find(vocabulary, ["godfater", "copola"]).SequenceEqual([1]) && CatalogSearchVocabulary.Find(vocabulary, ["yuzuklerin", "efendsi"]).SequenceEqual([2]) && !CatalogSearchVocabulary.Find(vocabulary, ["zzzqq"]).Any() && !CatalogSearchVocabulary.Find(vocabulary, ["cat"]).Any(), "Fallback search finds misspelled titles and directors only");
// Profile showcase: one life film and five films that left a mark.
var showcase = FilmShowcase.Empty.WithLife(7).WithInfluential(1, 10)!.WithInfluential(3, 11)!;
Check(showcase.WithInfluential(2, 10) is null && showcase.WithInfluential(1, 12)!.Influential.Select(p => p.MovieId).SequenceEqual([12, 11]), "A showcase film sits on one position and replacing a position keeps the others");
Check(showcase.Visible([10]) is { LifeFilmId: null, Influential: [{ MovieId: 10, Position: 1 }] } && showcase.WithoutInfluential(3).FilmIds.SequenceEqual([7, 10]), "Hidden films drop out of the showcase");
// Badges, viewer identity and summaries.
var tracks = FilmJourney.Achievements(0, 10);
Check(tracks[0].Current is null && tracks[0].Next!.Title == "İlk Bölüm" && tracks[0].Remaining == 1, "No watching badge before the first film");
Check(tracks[1].Current!.Title == "Dikkatli İzleyici" && tracks[1].Next!.Threshold == 100 && tracks[1].ProgressPercent == 0, "Evaluation badge thresholds");
Check(FilmJourney.Achievements(1000, 0)[0].ProgressPercent == 100 && FilmJourney.Achievements(1000, 0)[0].Next is null, "Final badge completes the track");
Check(FilmJourney.IdentityTitle([new(9648, "Gizem", 60), new(878, "Bilim Kurgu", 25)]) == "Geleceğe bakan dedektif", "Two-genre identity");
Check(FilmJourney.IdentityTitle([new(9648, "Gizem", 85), new(878, "Bilim Kurgu", 15)]) == "Dedektif ruhlu izleyici", "Minor second genre ignored");
var viewer = Guid.NewGuid();
MovieDetails Film(int id, int genre, int runtime, string director, int year = 2010) =>
    new(new(id, "Film " + id, "Film " + id, null, year, director), null, runtime, [new(genre, "Tür " + genre)], [director], [], [], null, "https://www.wikidata.org/wiki/Q" + id);
Dictionary<string,int> Scores(int all, int visuals) => MovieRecommendations.Criteria.Keys.ToDictionary(k => k, k => k == "visuals" ? visuals : all);
var films = new[] { Film(1, 878, 120, "Nolan"), Film(2, 878, 150, "Nolan"), Film(3, 18, 95, "Ceylan"), Film(4, 878, 100, "Villeneuve"), Film(5, 18, 200, "Ceylan"), Film(6, 35, 90, "Allen") }.ToDictionary(f => f.Movie.Id);
var march = new DateTimeOffset(2026, 3, 31, 22, 30, 0, TimeSpan.Zero); // 1 April in Türkiye
var entries = new MovieEntry[] {
    new(viewer, 1, "watched", Scores(9, 10), march, march),
    new(viewer, 2, "watched", Scores(8, 9), march.AddDays(-40), march.AddDays(-40)),
    new(viewer, 3, "watched", Scores(5, 5), march.AddDays(10), march.AddDays(10)),
    new(viewer, 4, "watched", null, new DateTimeOffset(2025, 6, 1, 0, 0, 0, TimeSpan.Zero)),
    new(viewer, 5, "watching", null, march),
    new(viewer, 6, "watchlist", null, march) };
var taste = FilmJourney.Taste(entries, films);
Check(taste.Ready && taste.Title == "Gelecek meraklısı" && taste.Genres[0].Id == 878, "Taste follows watched and liked genres");
Check(taste.Strengths.Any(s => s.Key == "visuals") && taste.Signature!.Id == 1, "Strength and signature film from own ratings");
Check(!FilmJourney.Taste(entries.Take(2).ToArray(), films).Ready, "Identity waits for enough films or ratings");
var year = FilmJourney.Summary(entries, films, 2026, null, march);
Check(year.FilmCount == 3 && year.Minutes == 365 && year.PreviousFilmCount == 1, "Yearly summary counts watched films and runtime");
Check(year.Months[3].Count == 2 && year.Months[1].Count == 1, "Months follow Türkiye time");
Check(year.TopDirector!.Name == "Nolan" && year.Favorite!.Movie.Id == 1 && year.Longest!.Movie.Id == 2, "Summary highlights");
Check(year.AvailableYears.SequenceEqual(new[] { 2026, 2025 }) && year.AverageScore is not null, "Summary years and average");
var april = FilmJourney.Summary(entries, films, 2026, 4, march);
Check(april.FilmCount == 2 && april.Months.Length == 0 && april.PreviousFilmCount == 0, "Monthly summary");
Check(!FilmJourney.IsValidPeriod(1999, null) && !FilmJourney.IsValidPeriod(2026, 13) && FilmJourney.IsValidPeriod(2026, 12), "Summary period validated");
Check(MovieStates.IsValid("paused") && MovieStates.IsValid("dropped") && !MovieStates.IsValid("finished") && !MovieStates.IsValid(null), "Five watch states, as on Books");
// Viewer compatibility, as on the Books reader profile.
var other = Guid.NewGuid();
var twin = new MovieEntry[] { new(other, 1, "watched", Scores(9, 10), march), new(other, 2, "watched", Scores(8, 9), march), new(other, 4, "watched", Scores(9, 9), march), new(other, 6, "watched", null, march) };
var match = FilmJourney.Compatibility(entries, twin, films);
Check(match.Ready && match.Percent >= 85 && match.Label == "Dizi ikizi" && match.ComparedRatings == 2 && match.SharedGenres[0] == "Tür 878", "Similar viewers are a close match");
Check(match.Suggestions.Length == 0 && match.CommonFilms == 3, "Films already in my lists are not suggested");
var stranger = new MovieEntry[] { new(other, 3, "watched", Scores(9, 9), march), new(other, 5, "watched", Scores(9, 9), march), new(other, 6, "watched", Scores(9, 9), march) };
var far = FilmJourney.Compatibility(entries.Take(4).ToArray(), stranger, films);
Check(far.Ready && far.Percent < match.Percent && far.Suggestions.Select(x => x.Movie.Id).SequenceEqual([5, 6]), "Different tastes score lower and suggest unseen loved films");
Check(!FilmJourney.Compatibility(entries.Take(2).ToArray(), twin, films).Ready, "Compatibility waits for both identities");
// Home page general picks: the week's star and the month's most watched.
MovieDetails Details(int id, int genre) => new(new MovieCard(id, "Film " + id, null, null, 2000, null), null, null, [new(genre, "Tür")], [], [], [], null, "https://www.wikidata.org/");
var today = new DateTimeOffset(2026, 11, 20, 12, 0, 0, TimeSpan.Zero);
Guid a = Guid.NewGuid(), b = Guid.NewGuid(), me = Guid.NewGuid();
var shown = new Dictionary<int, MovieDetails> { [21] = Details(21, 18), [22] = Details(22, 35), [23] = Details(23, 18), [24] = Details(24, 18) };
MovieEntry[] week = [
    new(a, 21, "watched", Scores(9, 9), today.AddDays(-1), today.AddDays(-1)), new(b, 21, "watched", Scores(9, 9), today.AddDays(-2), today.AddDays(-2)),
    new(a, 22, "watched", Scores(10, 10), today.AddDays(-1), today.AddDays(-1)),
    new(a, 23, "watched", Scores(5, 5), today.AddDays(-3), today.AddDays(-3)), new(b, 23, "watched", null, today.AddDays(-3), today.AddDays(-3)),
    new(a, 24, "watched", Scores(9, 9), today.AddDays(-20), today.AddDays(-20)), new(a, 99, "watched", Scores(10, 10), today, today),
];
var picks = FilmHighlights.Build(week, shown, [], today);
Check(picks.Star.Period == "week" && picks.Star.Films.Select(f => f.Movie.Id).SequenceEqual([21, 22, 23]), "Two 9s outrank a single 10; hidden films and older ratings stay out of the week");
Check(picks.Star.Films[0].Score == 9m && picks.Star.Films[0].Ratings == 2 && picks.Star.Films[0].Strengths.Length == 7 && picks.Star.Films[2].Strengths.Length == 0, "Star carries its average, vote count and strong criteria");
Check(picks.MostWatched.Films[0].Movie.Id is 21 or 23 && picks.MostWatched.Films[0].Viewers == 2 && picks.MostWatched.Period == "month", "Most watched counts viewers who marked İzledim");
var quiet = FilmHighlights.Build([week[0], week[5]], shown, [], today);
Check(quiet.Star.Period == "month" && quiet.Star.Films.Length == 2, "A quiet week widens to the month only when that adds films");
MovieEntry[] mine = [.. week, new(me, 21, "watched", null, today, today), new(me, 23, "watchlist", null, today)];
var excluded = FilmHighlights.Excluded(mine, [new(me, 22, "dismissed"), new(me, 24, "interested")], me);
var personal = FilmHighlights.Build(mine, shown, excluded, today);
Check(excluded.SetEquals([21, 22]) && !personal.Star.Films.Any(f => f.Movie.Id is 21 or 22) && personal.Star.Films.Any(f => f.Movie.Id == 23), "A viewer never sees films they watched or dismissed; their watchlist stays");
Console.WriteLine($"PASS: {count} Movie checks. No database or network used.");
