using Npgsql;

namespace Favo.Series.Api;

/// <summary>
/// Versioned SQL for the Dizi catalog in the shared Postgres ("series" schema). Migrations 1-2 are Film's, table names included,
/// so the two codebases stay alike; 3 adds what only a series has. The API never migrates on startup;
/// the offline catalog tool applies these (`dotnet run --project tools/Favo.Series.CatalogImport -- migrate`).
/// Genre ids follow the TMDB numbering so saved preferences and viewer identities keep their meaning.
/// </summary>
public static class CatalogSchema
{
    static readonly (int Version, string Sql)[] Migrations =
    [
        (1, """
            CREATE SCHEMA IF NOT EXISTS series;
            CREATE TABLE series.genres (id int PRIMARY KEY, name text NOT NULL, slug text NOT NULL UNIQUE);
            INSERT INTO series.genres (id, name, slug) VALUES
              (28,'Aksiyon','aksiyon'),(12,'Macera','macera'),(16,'Animasyon','animasyon'),(35,'Komedi','komedi'),
              (80,'Suç','suc'),(99,'Belgesel','belgesel'),(18,'Dram','dram'),(10751,'Aile','aile'),(14,'Fantastik','fantastik'),
              (36,'Tarih','tarih'),(27,'Korku','korku'),(10402,'Müzik','muzik'),(9648,'Gizem','gizem'),(10749,'Romantik','romantik'),
              (878,'Bilim Kurgu','bilim-kurgu'),(53,'Gerilim','gerilim'),(10752,'Savaş','savas'),(37,'Western','western');
            CREATE TABLE series.films (
              id serial PRIMARY KEY,
              wikidata_id text NOT NULL UNIQUE,
              source_revision bigint NOT NULL,
              title text NOT NULL,
              original_title text,
              release_year int,
              release_date date,
              runtime_minutes int,
              directors text[] NOT NULL DEFAULT '{}',
              cast_names text[] NOT NULL DEFAULT '{}',
              countries text[] NOT NULL DEFAULT '{}',
              original_language text,
              imdb_id text,
              tmdb_id int,
              poster_url text,
              description text,
              popularity int NOT NULL DEFAULT 0,
              search_text text NOT NULL,
              created_at timestamptz NOT NULL DEFAULT now(),
              updated_at timestamptz NOT NULL DEFAULT now());
            CREATE INDEX films_popularity ON series.films (popularity DESC, id);
            CREATE INDEX films_release_year ON series.films (release_year);
            CREATE TABLE series.film_genres (
              film_id int NOT NULL REFERENCES series.films ON DELETE CASCADE,
              genre_id int NOT NULL REFERENCES series.genres,
              PRIMARY KEY (film_id, genre_id));
            CREATE INDEX film_genres_genre ON series.film_genres (genre_id);
            CREATE TABLE series.import_batches (
              batch_id text PRIMARY KEY, manifest_sha256 text NOT NULL, record_count int NOT NULL,
              applied_at timestamptz NOT NULL DEFAULT now());
            -- Editorial history is append-only: a correction is a new decision, never an update.
            CREATE TABLE series.editorial_decisions (
              id bigserial PRIMARY KEY,
              film_id int NOT NULL REFERENCES series.films,
              decision text NOT NULL CHECK (decision IN ('Film', 'Hidden')),
              batch_id text NOT NULL,
              note text,
              created_at timestamptz NOT NULL DEFAULT now());
            CREATE INDEX editorial_decisions_film ON series.editorial_decisions (film_id, id DESC);
            CREATE VIEW series.visible_films AS
              SELECT f.* FROM series.films f
              JOIN (SELECT DISTINCT ON (film_id) film_id, decision FROM series.editorial_decisions ORDER BY film_id, id DESC) d
                ON d.film_id = f.id
              WHERE d.decision = 'Film';
            """),
        // Viewer data (watch entries, feedback, preferences, avatars, showcase, undo) moves from App_Data/movie.db (SQLite).
        // The API keeps its document shape; the views give each kind readable columns for SQL clients and reports.
        (2, """
            CREATE TABLE series.viewer_documents (
              kind text NOT NULL,
              owner uuid NOT NULL,
              item text NOT NULL,
              payload jsonb NOT NULL,
              updated_at timestamptz NOT NULL DEFAULT now(),
              PRIMARY KEY (kind, owner, item));
            CREATE INDEX viewer_documents_kind_item ON series.viewer_documents (kind, item);
            CREATE VIEW series.viewer_entries AS
              SELECT owner AS user_id, item::int AS film_id, payload->>'state' AS state,
                (payload->>'overall')::numeric AS overall, payload->'scores' AS scores,
                (payload->>'updatedAtUtc')::timestamptz AS updated_at, (payload->>'watchedAtUtc')::timestamptz AS watched_at
              FROM series.viewer_documents WHERE kind = 'entry';
            CREATE VIEW series.viewer_feedback AS
              SELECT owner AS user_id, item::int AS film_id, payload->>'choice' AS choice, updated_at
              FROM series.viewer_documents WHERE kind = 'feedback';
            CREATE VIEW series.viewer_preferences AS
              SELECT owner AS user_id, payload->'genres' AS genres, payload->'criteria' AS criteria, updated_at
              FROM series.viewer_documents WHERE kind = 'preference';
            CREATE VIEW series.viewer_avatars AS
              SELECT owner AS user_id, payload->>'avatarId' AS avatar_id, updated_at
              FROM series.viewer_documents WHERE kind = 'avatar';
            CREATE VIEW series.viewer_showcases AS
              SELECT owner AS user_id, (payload->>'lifeFilmId')::int AS life_film_id, payload->'influential' AS influential, updated_at
              FROM series.viewer_documents WHERE kind = 'showcase';
            """),
        // A series runs over years and seasons and airs on a channel or platform. The view is recreated so f.* includes the new columns.
        (3, """
            ALTER TABLE series.films ADD COLUMN end_year int, ADD COLUMN seasons int, ADD COLUMN episodes int,
              ADD COLUMN networks text[] NOT NULL DEFAULT '{}';
            CREATE OR REPLACE VIEW series.visible_films AS
              SELECT f.* FROM series.films f
              JOIN (SELECT DISTINCT ON (film_id) film_id, decision FROM series.editorial_decisions ORDER BY film_id, id DESC) d
                ON d.film_id = f.id
              WHERE d.decision = 'Film';
            """),
    ];

    public static async Task<int[]> Migrate(NpgsqlDataSource db, CancellationToken ct = default)
    {
        await using var connection = await db.OpenConnectionAsync(ct);
        await using var transaction = await connection.BeginTransactionAsync(ct);
        await using (var setup = new NpgsqlCommand("""
            SELECT pg_advisory_xact_lock(hashtext('favo-series-schema'));
            CREATE SCHEMA IF NOT EXISTS series;
            CREATE TABLE IF NOT EXISTS series.schema_migrations (version int PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
            """, connection, transaction))
            await setup.ExecuteNonQueryAsync(ct);
        var applied = new HashSet<int>();
        await using (var read = new NpgsqlCommand("SELECT version FROM series.schema_migrations", connection, transaction))
        await using (var reader = await read.ExecuteReaderAsync(ct))
            while (await reader.ReadAsync(ct)) applied.Add(reader.GetInt32(0));
        List<int> done = [];
        foreach (var (version, sql) in Migrations.Where(m => !applied.Contains(m.Version)))
        {
            await using var command = new NpgsqlCommand(sql + "; INSERT INTO series.schema_migrations (version) VALUES (@v);", connection, transaction);
            command.Parameters.AddWithValue("v", version);
            await command.ExecuteNonQueryAsync(ct);
            done.Add(version);
        }
        await transaction.CommitAsync(ct);
        return done.ToArray();
    }
}
