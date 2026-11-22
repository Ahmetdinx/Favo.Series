using System.Globalization;
using System.Text;
using Npgsql;

namespace Favo.Series.Api;

public sealed record CatalogQuery(string Query, int Page, int? Year, int? Genre, string Sort)
{
    public static readonly string[] Sorts = ["mixed", "popular", "newest", "title"];
    public bool IsValid() => Query.Length <= 120 && Page is >= 1 and <= 500 && (Year is null or >= 1888 and <= 2100)
        && (Genre is null or > 0) && Sorts.Contains(Sort);
}
public sealed record GenreInfo(int Id, string Name);
/// <summary>A catalog genre with the number of visible films in it (the catalog's genre chips show the count).</summary>
public sealed record GenreCount(int Id, string Name, int Count);
/// <summary>A catalog card. PosterUrl stays empty until licensed posters exist; the UI then draws its own cover.</summary>
public sealed record MovieCard(int Id, string Title, string? OriginalTitle, string? PosterUrl, int? Year, string? Director);
/// <summary>Approximate is true when nothing matched exactly and spelling-similar films are shown instead.</summary>
public sealed record MoviePage(MovieCard[] Items, int Page, int TotalPages, int TotalResults, bool Approximate = false);
/// <summary>A series in the catalog. Runtime is an episode's length, Directors are the creators; EndYear is null while it still airs.</summary>
public sealed record MovieDetails(MovieCard Movie, string? Description, int? Runtime, GenreInfo[] Genres, string[] Directors,
    string[] Cast, string[] Countries, string? ImdbUrl, string WikidataUrl, int? EndYear = null, int? Seasons = null, int? Episodes = null, string[]? Networks = null);
public sealed class MovieProviderException(string code, string message, int status) : Exception(message)
{
    public string Code { get; } = code;
    public int Status { get; } = status;
}

/// <summary>Search text shared by the import tool and the API: Turkish-aware lower case without accents or punctuation.</summary>
public static class CatalogText
{
    static readonly CultureInfo Turkish = CultureInfo.GetCultureInfo("tr-TR");
    public static string Normalize(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return "";
        var lower = value.ToLower(Turkish).Replace('ı', 'i').Normalize(NormalizationForm.FormD);
        var text = new StringBuilder(lower.Length);
        foreach (var c in lower)
        {
            if (CharUnicodeInfo.GetUnicodeCategory(c) == UnicodeCategory.NonSpacingMark) continue;
            text.Append(char.IsLetterOrDigit(c) ? c : ' ');
        }
        return string.Join(' ', text.ToString().Split(' ', StringSplitOptions.RemoveEmptyEntries));
    }
}

/// <summary>Film's own catalog (Postgres "series" schema, filled offline from Wikidata). Only visible films are served.</summary>
public sealed class MovieCatalog(NpgsqlDataSource db)
{
    public const int PageSize = 20;
    readonly CatalogSearchVocabulary vocabulary = new(db);
    const string Columns = """
        f.id, f.title, f.original_title, f.poster_url, f.release_year, f.directors, f.description, f.runtime_minutes,
        f.cast_names, f.countries, f.imdb_id, f.wikidata_id,
        coalesce((SELECT array_agg(g.id ORDER BY g.id) FROM series.film_genres fg JOIN series.genres g ON g.id = fg.genre_id WHERE fg.film_id = f.id), '{}') AS genre_ids,
        coalesce((SELECT array_agg(g.name ORDER BY g.id) FROM series.film_genres fg JOIN series.genres g ON g.id = fg.genre_id WHERE fg.film_id = f.id), '{}') AS genre_names,
        f.end_year, f.seasons, f.episodes, f.networks
        """;

    public async Task<GenreCount[]> Genres(CancellationToken ct)
    {
        await using var command = db.CreateCommand("""
            SELECT g.id, g.name, count(f.id)::int FROM series.genres g
            LEFT JOIN series.film_genres fg ON fg.genre_id = g.id
            LEFT JOIN series.visible_films f ON f.id = fg.film_id
            GROUP BY g.id, g.name
            """);
        await using var reader = await command.ExecuteReaderAsync(ct);
        List<GenreCount> genres = [];
        while (await reader.ReadAsync(ct)) genres.Add(new(reader.GetInt32(0), reader.GetString(1), reader.GetInt32(2)));
        return genres.OrderBy(g => g.Name, StringComparer.Create(CultureInfo.GetCultureInfo("tr-TR"), false)).ToArray();
    }

    public async Task<MoviePage> Browse(CatalogQuery query, CancellationToken ct)
    {
        if (!query.IsValid()) throw new ArgumentException("Invalid movie query.", nameof(query));
        var search = CatalogText.Normalize(query.Query);
        var page = await Browse(query, search, null, ct);
        if (page.TotalResults > 0 || search.Length == 0) return page;
        // Nothing matched exactly: retry spelling-tolerantly ("Godfater" finds "The Godfather", "Kubrik" finds Kubrick).
        var similar = await vocabulary.Find(search, ct);
        if (similar.Length == 0) return page;
        var approximate = await Browse(query, search, similar, ct);
        return approximate.TotalResults > 0 ? approximate with { Approximate = true } : page;
    }

    async Task<MoviePage> Browse(CatalogQuery query, string search, int[]? ids, CancellationToken ct)
    {
        List<string> where = [];
        var command = db.CreateCommand();
        if (ids is not null) { where.Add("f.id = ANY(@ids)"); command.Parameters.AddWithValue("ids", ids); }
        else if (search.Length > 0) where.Add("f.search_text LIKE @like");
        if (search.Length > 0) { command.Parameters.AddWithValue("like", "%" + search + "%"); command.Parameters.AddWithValue("prefix", search + "%"); }
        if (query.Year is int year) { where.Add("f.release_year = @year"); command.Parameters.AddWithValue("year", year); }
        if (query.Genre is int genre) { where.Add("EXISTS (SELECT 1 FROM series.film_genres g WHERE g.film_id = f.id AND g.genre_id = @genre)"); command.Parameters.AddWithValue("genre", genre); }
        // A search puts titles that start with the words first; otherwise the chosen order applies.
        var order = (search.Length > 0 && ids is null ? "(f.search_text LIKE @prefix) DESC, " : "") + query.Sort switch
        {
            "newest" => "f.release_year DESC NULLS LAST, f.popularity DESC, f.id",
            "title" => "f.search_text, f.id",
            "popular" => "f.popularity DESC, f.id",
            // Search results read best when the best-known match comes first, so a search ignores the shuffle.
            _ when search.Length > 0 => "f.popularity DESC, f.id",
            // A daily shuffle (Türkiye date as the seed), so paging stays stable within a day and the shelf changes tomorrow.
            _ => "md5(f.id::text || @seed), f.id",
        };
        command.Parameters.AddWithValue("seed", MixedSeed());
        command.CommandText = $"SELECT {Columns}, count(*) OVER () AS total FROM series.visible_films f {(where.Count > 0 ? "WHERE " + string.Join(" AND ", where) : "")} ORDER BY {order} LIMIT @take OFFSET @skip";
        command.Parameters.AddWithValue("take", PageSize);
        command.Parameters.AddWithValue("skip", (query.Page - 1) * PageSize);
        await using (command)
        {
            var (films, total) = await Read(command, ct);
            return new(films.Select(f => f.Movie).ToArray(), query.Page, Math.Min(500, Math.Max(1, (int)Math.Ceiling(total / (double)PageSize))), total);
        }
    }

    /// <summary>The mixed order's seed: today's date in Türkiye (UTC+3).</summary>
    public static string MixedSeed() => DateTime.UtcNow.AddHours(3).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    public async Task<MovieDetails> Details(int id, CancellationToken ct) =>
        (await GetMany([id], ct)).GetValueOrDefault(id) ?? throw new MovieProviderException("not_found", "Dizi bulunamadı.", 404);

    public async Task<Dictionary<int, MovieDetails>> GetMany(IEnumerable<int> ids, CancellationToken ct)
    {
        var list = ids.Distinct().ToArray();
        if (list.Length == 0) return [];
        await using var command = db.CreateCommand($"SELECT {Columns}, 0::bigint AS total FROM series.visible_films f WHERE f.id = ANY(@ids)");
        command.Parameters.AddWithValue("ids", list);
        return (await Read(command, ct)).Films.ToDictionary(f => f.Movie.Id);
    }

    /// <summary>Every visible film as a card, best known first; the Letterboxd import matches titles against it.</summary>
    public async Task<MovieCard[]> Cards(CancellationToken ct)
    {
        await using var command = db.CreateCommand("SELECT f.id, f.title, f.original_title, f.poster_url, f.release_year, f.directors[1] FROM series.visible_films f ORDER BY f.popularity DESC, f.id");
        await using var reader = await command.ExecuteReaderAsync(ct);
        List<MovieCard> cards = [];
        while (await reader.ReadAsync(ct))
            cards.Add(new(reader.GetInt32(0), reader.GetString(1), reader.IsDBNull(2) ? null : reader.GetString(2), reader.IsDBNull(3) ? null : reader.GetString(3),
                reader.IsDBNull(4) ? null : reader.GetInt32(4), reader.IsDBNull(5) ? null : reader.GetString(5)));
        return cards.ToArray();
    }

    /// <summary>The recommendation pool: the best-known films in the chosen genres plus the best-known films overall.</summary>
    public async Task<MovieDetails[]> Candidates(int[] genres, int perGenre, int general, CancellationToken ct)
    {
        await using var command = db.CreateCommand($"""
            SELECT {Columns}, 0::bigint AS total FROM series.visible_films f WHERE f.id IN (
              SELECT id FROM (SELECT f2.id, row_number() OVER (PARTITION BY fg.genre_id ORDER BY f2.popularity DESC, f2.id) AS n
                FROM series.visible_films f2 JOIN series.film_genres fg ON fg.film_id = f2.id WHERE fg.genre_id = ANY(@genres)) ranked WHERE n <= @perGenre
              UNION SELECT id FROM (SELECT f3.id FROM series.visible_films f3 ORDER BY f3.popularity DESC, f3.id LIMIT @general) top)
            """);
        command.Parameters.AddWithValue("genres", genres);
        command.Parameters.AddWithValue("perGenre", perGenre);
        command.Parameters.AddWithValue("general", general);
        return (await Read(command, ct)).Films.ToArray();
    }

    static async Task<(List<MovieDetails> Films, int Total)> Read(NpgsqlCommand command, CancellationToken ct)
    {
        await using var reader = await command.ExecuteReaderAsync(ct);
        List<MovieDetails> films = [];
        var total = 0;
        while (await reader.ReadAsync(ct))
        {
            var directors = reader.GetFieldValue<string[]>(5);
            var ids = reader.GetFieldValue<int[]>(12);
            var names = reader.GetFieldValue<string[]>(13);
            var imdb = reader.IsDBNull(10) ? null : reader.GetString(10);
            films.Add(new(
                new(reader.GetInt32(0), reader.GetString(1), reader.IsDBNull(2) ? null : reader.GetString(2), reader.IsDBNull(3) ? null : reader.GetString(3),
                    reader.IsDBNull(4) ? null : reader.GetInt32(4), directors.FirstOrDefault()),
                reader.IsDBNull(6) ? null : reader.GetString(6), reader.IsDBNull(7) ? null : reader.GetInt32(7),
                ids.Zip(names, (i, n) => new GenreInfo(i, n)).ToArray(), directors, reader.GetFieldValue<string[]>(8), reader.GetFieldValue<string[]>(9),
                imdb is null ? null : "https://www.imdb.com/title/" + imdb + "/", "https://www.wikidata.org/wiki/" + reader.GetString(11),
                reader.IsDBNull(14) ? null : reader.GetInt32(14), reader.IsDBNull(15) ? null : reader.GetInt32(15), reader.IsDBNull(16) ? null : reader.GetInt32(16),
                reader.GetFieldValue<string[]>(17)));
            total = (int)reader.GetInt64(18);
        }
        return (films, total);
    }
}
