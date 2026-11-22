using System.Security.Cryptography;
using System.Text.Json;
using Favo.Series.Api;
using Microsoft.Extensions.Configuration;
using Npgsql;

// Offline Film catalog tool. Every write command is a dry run unless --apply is given.
//   migrate
//   import <batch-folder> --batch <batch-id> [--apply]      manifest.json + verification.json from tools/catalog
//   summaries <summaries.tsv> [--apply]                      WikidataId<TAB>Summary, written by us
//   decisions <decisions.tsv> --batch <batch-id> [--apply]   WikidataId<TAB>Film|Hidden<TAB>Note (editorial corrections)
//   viewer-import <movie.db> [--apply]                       one-time copy of viewer data from the old SQLite store
var command = args.FirstOrDefault();
var apply = args.Contains("--apply");
string? Option(string name) { var i = Array.IndexOf(args, name); return i >= 0 && i + 1 < args.Length ? args[i + 1] : null; }
var config = new ConfigurationBuilder().AddUserSecrets(typeof(CatalogImport).Assembly, optional: true).AddEnvironmentVariables().Build();
var connection = Option("--connection") ?? config.GetConnectionString("Database");
if (command is null || connection is null)
{
    Console.Error.WriteLine("Kullanım: migrate | import <klasör> --batch <kimlik> [--apply] | summaries <tsv> [--apply] | decisions <tsv> --batch <kimlik> [--apply] | viewer-import <movie.db> [--apply]");
    Console.Error.WriteLine("Bağlantı: ConnectionStrings:Database (user-secrets) veya --connection.");
    return 1;
}
await using var db = NpgsqlDataSource.Create(connection);
try
{
    return command switch
    {
        "migrate" => await CatalogImport.Migrate(db),
        "import" => await CatalogImport.Import(db, args.ElementAtOrDefault(1) ?? "", Option("--batch") ?? "", apply),
        "summaries" => await CatalogImport.Summaries(db, args.ElementAtOrDefault(1) ?? "", apply),
        "decisions" => await CatalogImport.Decisions(db, args.ElementAtOrDefault(1) ?? "", Option("--batch") ?? "", apply),
        "viewer-import" => await CatalogImport.ViewerImport(db, args.ElementAtOrDefault(1) ?? "", apply),
        _ => throw new CatalogImportException($"Bilinmeyen komut: {command}"),
    };
}
catch (CatalogImportException e) { Console.Error.WriteLine("HATA: " + e.Message); return 2; }

public sealed class CatalogImportException(string message) : Exception(message);

public sealed record ManifestRecord(int Number, string WikidataId, long Revision, string Title, string? OriginalTitle, int? ReleaseYear,
    string? ReleaseDate, int? RuntimeMinutes, int[] Genres, string[] Directors, string[] Cast, string[] Countries, string? OriginalLanguage,
    string? ImdbId, int? TmdbId, int Popularity, string SourceUrl, string SourceSha256, string EvidenceNote, string Decision,
    int? EndYear = null, int? Seasons = null, int? Episodes = null, string[]? Networks = null);
public sealed record Verification(string ManifestSha256, int Verified, DateTimeOffset CheckedAtUtc, string[] Errors);

public static class CatalogImport
{
    /// <summary>
    /// Copies the viewer documents of the old SQLite store (App_Data/movie.db) into series.viewer_documents. Rows that already
    /// exist in Postgres are kept as they are, so running it again changes nothing. Dry run unless --apply.
    /// </summary>
    public static async Task<int> ViewerImport(NpgsqlDataSource db, string path, bool apply)
    {
        if (!File.Exists(path)) throw new CatalogImportException($"SQLite dosyası bulunamadı: {path}");
        List<(string Kind, Guid Owner, string Item, string Payload)> rows = [];
        await using (var sqlite = new Microsoft.Data.Sqlite.SqliteConnection(new Microsoft.Data.Sqlite.SqliteConnectionStringBuilder { DataSource = path, Mode = Microsoft.Data.Sqlite.SqliteOpenMode.ReadOnly }.ToString()))
        {
            await sqlite.OpenAsync();
            await using var read = sqlite.CreateCommand();
            read.CommandText = "SELECT kind, owner, item, payload FROM documents ORDER BY kind, owner, item";
            await using var reader = await read.ExecuteReaderAsync();
            while (await reader.ReadAsync())
            {
                if (!Guid.TryParse(reader.GetString(1), out var owner)) throw new CatalogImportException($"Geçersiz sahip kimliği: {reader.GetString(1)}");
                using var _ = JsonDocument.Parse(reader.GetString(3)); // every payload must be valid JSON before anything is written
                rows.Add((reader.GetString(0), owner, reader.GetString(2), reader.GetString(3)));
            }
        }
        foreach (var group in rows.GroupBy(r => r.Kind).OrderBy(g => g.Key)) Console.WriteLine($"{group.Key}: {group.Count()} kayıt, {group.Select(r => r.Owner).Distinct().Count()} kullanıcı");
        if (!apply) { Console.WriteLine($"Deneme: {rows.Count} kayıt okunur. Yazmak için --apply ekle."); return 0; }
        await using var connection = await db.OpenConnectionAsync();
        await using var transaction = await connection.BeginTransactionAsync();
        var added = 0;
        foreach (var row in rows)
        {
            await using var insert = new NpgsqlCommand("INSERT INTO series.viewer_documents (kind, owner, item, payload) VALUES (@k, @o, @i, @v::jsonb) ON CONFLICT DO NOTHING", connection, transaction);
            insert.Parameters.AddWithValue("k", row.Kind); insert.Parameters.AddWithValue("o", row.Owner); insert.Parameters.AddWithValue("i", row.Item); insert.Parameters.AddWithValue("v", row.Payload);
            added += await insert.ExecuteNonQueryAsync();
        }
        await transaction.CommitAsync();
        Console.WriteLine($"Yazıldı: {added} yeni kayıt, {rows.Count - added} zaten vardı.");
        return 0;
    }

    static readonly JsonSerializerOptions Json = new() { PropertyNameCaseInsensitive = true };

    public static async Task<int> Migrate(NpgsqlDataSource db)
    {
        var applied = await CatalogSchema.Migrate(db);
        Console.WriteLine(applied.Length == 0 ? "Şema güncel." : $"Uygulanan migration: {string.Join(", ", applied)}");
        return 0;
    }

    /// <summary>
    /// Applies a verified manifest. Like Kitap's PublisherImport: the verification must match the manifest hash and be at most
    /// 24 hours old, and a batch id can never be reused for different content. Re-applying the same batch does nothing.
    /// </summary>
    public static async Task<int> Import(NpgsqlDataSource db, string folder, string batch, bool apply)
    {
        if (string.IsNullOrWhiteSpace(batch)) throw new CatalogImportException("--batch gerekli.");
        var manifestPath = Path.Combine(folder, "manifest.json");
        var verificationPath = Path.Combine(folder, "verification.json");
        if (!File.Exists(manifestPath)) throw new CatalogImportException($"{manifestPath} yok.");
        var bytes = await File.ReadAllBytesAsync(manifestPath);
        var hash = Convert.ToHexStringLower(SHA256.HashData(bytes));
        var records = JsonSerializer.Deserialize<ManifestRecord[]>(bytes, Json) ?? [];
        Validate(records);
        if (!File.Exists(verificationPath)) throw new CatalogImportException("verification.json yok; önce tools/catalog/verify-manifest.mjs çalıştır.");
        var verification = JsonSerializer.Deserialize<Verification>(await File.ReadAllBytesAsync(verificationPath), Json)!;
        if (verification.ManifestSha256 != hash) throw new CatalogImportException("Doğrulama bu manifest için yapılmamış (hash eşleşmiyor).");
        if (verification.Errors.Length > 0) throw new CatalogImportException($"Doğrulamada {verification.Errors.Length} hata var.");
        if (DateTimeOffset.UtcNow - verification.CheckedAtUtc > TimeSpan.FromHours(24) && apply)
            throw new CatalogImportException("Doğrulama 24 saatten eski; yeniden doğrula.");

        await using var connection = await db.OpenConnectionAsync();
        await using var transaction = await connection.BeginTransactionAsync();
        await Exec(connection, transaction, "SELECT pg_advisory_xact_lock(hashtext('favo-series-import'))");
        var existing = await Scalar<string>(connection, transaction, "SELECT manifest_sha256 FROM series.import_batches WHERE batch_id = @b", ("b", batch));
        if (existing == hash) { Console.WriteLine($"{batch} zaten uygulanmış; değişiklik yok."); return 0; }
        if (existing is not null) throw new CatalogImportException($"{batch} kimliği farklı içerikle kullanılmış; yeni bir parti kimliği seç.");

        int added = 0, updated = 0;
        foreach (var r in records)
        {
            var filmId = await Scalar<int?>(connection, transaction, "SELECT id FROM series.films WHERE wikidata_id = @w", ("w", r.WikidataId));
            await using (var upsert = new NpgsqlCommand("""
                INSERT INTO series.films (wikidata_id, source_revision, title, original_title, release_year, release_date, runtime_minutes,
                  directors, cast_names, countries, original_language, imdb_id, tmdb_id, popularity, search_text, end_year, seasons, episodes, networks)
                VALUES (@w, @rev, @title, @orig, @year, @date, @runtime, @directors, @cast, @countries, @lang, @imdb, @tmdb, @pop, @search, @end, @seasons, @episodes, @networks)
                ON CONFLICT (wikidata_id) DO UPDATE SET source_revision = excluded.source_revision, title = excluded.title,
                  original_title = excluded.original_title, release_year = excluded.release_year, release_date = excluded.release_date,
                  runtime_minutes = excluded.runtime_minutes, directors = excluded.directors, cast_names = excluded.cast_names,
                  countries = excluded.countries, original_language = excluded.original_language, imdb_id = excluded.imdb_id,
                  tmdb_id = excluded.tmdb_id, popularity = excluded.popularity, search_text = excluded.search_text, end_year = excluded.end_year,
                  seasons = excluded.seasons, episodes = excluded.episodes, networks = excluded.networks, updated_at = now()
                RETURNING id
                """, connection, transaction))
            {
                upsert.Parameters.AddWithValue("w", r.WikidataId);
                upsert.Parameters.AddWithValue("rev", r.Revision);
                upsert.Parameters.AddWithValue("title", r.Title);
                upsert.Parameters.AddWithValue("orig", (object?)r.OriginalTitle ?? DBNull.Value);
                upsert.Parameters.AddWithValue("year", (object?)r.ReleaseYear ?? DBNull.Value);
                upsert.Parameters.AddWithValue("date", r.ReleaseDate is null ? DBNull.Value : DateOnly.Parse(r.ReleaseDate));
                upsert.Parameters.AddWithValue("runtime", (object?)r.RuntimeMinutes ?? DBNull.Value);
                upsert.Parameters.AddWithValue("directors", r.Directors);
                upsert.Parameters.AddWithValue("cast", r.Cast);
                upsert.Parameters.AddWithValue("countries", r.Countries);
                upsert.Parameters.AddWithValue("lang", (object?)r.OriginalLanguage ?? DBNull.Value);
                upsert.Parameters.AddWithValue("imdb", (object?)r.ImdbId ?? DBNull.Value);
                upsert.Parameters.AddWithValue("tmdb", (object?)r.TmdbId ?? DBNull.Value);
                upsert.Parameters.AddWithValue("pop", r.Popularity);
                upsert.Parameters.AddWithValue("end", (object?)r.EndYear ?? DBNull.Value);
                upsert.Parameters.AddWithValue("seasons", (object?)r.Seasons ?? DBNull.Value);
                upsert.Parameters.AddWithValue("episodes", (object?)r.Episodes ?? DBNull.Value);
                upsert.Parameters.AddWithValue("networks", r.Networks ?? []);
                // Searchable by Turkish title, original title and directors.
                upsert.Parameters.AddWithValue("search", CatalogText.Normalize(string.Join(' ', new[] { r.Title, r.OriginalTitle }.Concat(r.Directors).OfType<string>())));
                var id = (int)(await upsert.ExecuteScalarAsync())!;
                if (filmId is null) added++; else updated++;
                filmId = id;
            }
            await Exec(connection, transaction, "DELETE FROM series.film_genres WHERE film_id = @f", ("f", filmId.Value));
            foreach (var genre in r.Genres)
                await Exec(connection, transaction, "INSERT INTO series.film_genres (film_id, genre_id) VALUES (@f, @g)", ("f", filmId.Value), ("g", genre));
            // A decision is recorded only when it differs from the film's latest one; history is never rewritten.
            var latest = await Scalar<string>(connection, transaction, "SELECT decision FROM series.editorial_decisions WHERE film_id = @f ORDER BY id DESC LIMIT 1", ("f", filmId.Value));
            if (latest != r.Decision)
                await Exec(connection, transaction, "INSERT INTO series.editorial_decisions (film_id, decision, batch_id, note) VALUES (@f, @d, @b, @n)",
                    ("f", filmId.Value), ("d", r.Decision), ("b", batch), ("n", r.EvidenceNote));
        }
        await Exec(connection, transaction, "INSERT INTO series.import_batches (batch_id, manifest_sha256, record_count) VALUES (@b, @h, @c)", ("b", batch), ("h", hash), ("c", records.Length));
        Console.WriteLine($"{batch}: {added} yeni, {updated} güncellenen dizi{(apply ? "." : " (deneme; yazmak için --apply).")}");
        if (apply) await transaction.CommitAsync(); else await transaction.RollbackAsync();
        return 0;
    }

    static void Validate(ManifestRecord[] records)
    {
        if (records.Length == 0) throw new CatalogImportException("Manifest boş.");
        var errors = new List<string>();
        foreach (var r in records)
        {
            if (!System.Text.RegularExpressions.Regex.IsMatch(r.WikidataId ?? "", "^Q[1-9][0-9]*$")) errors.Add($"{r.Number}: geçersiz Wikidata kimliği");
            if (string.IsNullOrWhiteSpace(r.Title)) errors.Add($"{r.WikidataId}: ad yok");
            if (r.Decision is not ("Film" or "Hidden")) errors.Add($"{r.WikidataId}: karar Film veya Hidden olmalı");
            if (r.Genres.Any(g => !KnownGenres.Contains(g))) errors.Add($"{r.WikidataId}: bilinmeyen tür");
            if (string.IsNullOrWhiteSpace(r.SourceSha256) || string.IsNullOrWhiteSpace(r.SourceUrl)) errors.Add($"{r.WikidataId}: kaynak kanıtı yok");
        }
        if (records.Select(r => r.WikidataId).Distinct().Count() != records.Length) errors.Add("Aynı dizi manifestte birden çok kez var.");
        if (errors.Count > 0) throw new CatalogImportException(string.Join(Environment.NewLine, errors.Take(20)));
    }

    static readonly HashSet<int> KnownGenres = [28, 12, 16, 35, 80, 99, 18, 10751, 14, 36, 27, 10402, 9648, 10749, 878, 53, 10752, 37];

    /// <summary>Our own Turkish summaries, keyed by Wikidata id so they survive re-imports and fresh databases.</summary>
    public static async Task<int> Summaries(NpgsqlDataSource db, string path, bool apply)
    {
        var rows = ReadTsv(path, 2).Where(r => r[0] != "WikidataId").ToArray();
        await using var connection = await db.OpenConnectionAsync();
        await using var transaction = await connection.BeginTransactionAsync();
        int written = 0, missing = 0;
        foreach (var row in rows)
        {
            var summary = row[1].Trim();
            if (summary.Length is < 40 or > 1500) throw new CatalogImportException($"{row[0]}: özet 40–1500 karakter olmalı.");
            var changed = await Exec(connection, transaction, "UPDATE series.films SET description = @s, updated_at = now() WHERE wikidata_id = @w AND description IS DISTINCT FROM @s", ("s", summary), ("w", row[0]));
            if (changed > 0) written++;
            else if (await Scalar<int?>(connection, transaction, "SELECT id FROM series.films WHERE wikidata_id = @w", ("w", row[0])) is null) missing++;
        }
        Console.WriteLine($"{written} özet yazılacak, {missing} dizi katalogda yok{(apply ? "." : " (deneme; yazmak için --apply).")}");
        if (apply) await transaction.CommitAsync(); else await transaction.RollbackAsync();
        return 0;
    }

    /// <summary>Editorial corrections (e.g. hiding a duplicate) are appended as new decisions under their own batch id.</summary>
    public static async Task<int> Decisions(NpgsqlDataSource db, string path, string batch, bool apply)
    {
        if (string.IsNullOrWhiteSpace(batch)) throw new CatalogImportException("--batch gerekli.");
        var rows = ReadTsv(path, 3).Where(r => r[0] != "WikidataId").ToArray();
        await using var connection = await db.OpenConnectionAsync();
        await using var transaction = await connection.BeginTransactionAsync();
        var count = 0;
        foreach (var row in rows)
        {
            if (row[1] is not ("Film" or "Hidden")) throw new CatalogImportException($"{row[0]}: karar Film veya Hidden olmalı.");
            var film = await Scalar<int?>(connection, transaction, "SELECT id FROM series.films WHERE wikidata_id = @w", ("w", row[0]))
                ?? throw new CatalogImportException($"{row[0]} katalogda yok.");
            count += await Exec(connection, transaction, "INSERT INTO series.editorial_decisions (film_id, decision, batch_id, note) VALUES (@f, @d, @b, @n)",
                ("f", film), ("d", row[1]), ("b", batch), ("n", row[2]));
        }
        Console.WriteLine($"{count} karar eklenecek{(apply ? "." : " (deneme; yazmak için --apply).")}");
        if (apply) await transaction.CommitAsync(); else await transaction.RollbackAsync();
        return 0;
    }

    static string[][] ReadTsv(string path, int columns)
    {
        if (!File.Exists(path)) throw new CatalogImportException($"{path} yok.");
        return File.ReadAllLines(path).Where(l => l.Length > 0).Select(l => l.Split('\t'))
            .Select(r => r.Length >= columns ? r : throw new CatalogImportException($"Eksik sütun: {string.Join(' ', r).Truncate()}")).ToArray();
    }

    static string Truncate(this string value) => value.Length > 60 ? value[..60] + "…" : value;

    static async Task<int> Exec(NpgsqlConnection connection, NpgsqlTransaction transaction, string sql, params (string Name, object Value)[] parameters)
    {
        await using var command = new NpgsqlCommand(sql, connection, transaction);
        foreach (var (name, value) in parameters) command.Parameters.AddWithValue(name, value);
        return await command.ExecuteNonQueryAsync();
    }

    static async Task<T?> Scalar<T>(NpgsqlConnection connection, NpgsqlTransaction transaction, string sql, params (string Name, object Value)[] parameters)
    {
        await using var command = new NpgsqlCommand(sql, connection, transaction);
        foreach (var (name, value) in parameters) command.Parameters.AddWithValue(name, value);
        var result = await command.ExecuteScalarAsync();
        return result is null or DBNull ? default : (T)result;
    }
}
