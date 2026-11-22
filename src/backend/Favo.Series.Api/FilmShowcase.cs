namespace Favo.Series.Api;

public sealed record ShowcasePick(int MovieId, int Position);
public sealed record ShowcaseLifeRequest(int MovieId);
public sealed record ShowcasePickRequest(int MovieId);

/// <summary>
/// The profile showcase, Film's counterpart of Books' bedside book and "İz bırakanlar": one "Hayatımın dizisi" and up to
/// five films that left a mark, each on a fixed position 1-5. A film appears at most once among the five.
/// </summary>
public sealed record FilmShowcase(int? LifeFilmId, ShowcasePick[] Influential)
{
    public const int Positions = 5;
    public static readonly FilmShowcase Empty = new(null, []);

    public IEnumerable<int> FilmIds => (LifeFilmId is int life ? new[] { life } : []).Concat(Influential.Select(p => p.MovieId)).Distinct();

    public FilmShowcase WithLife(int? movieId) => this with { LifeFilmId = movieId };

    /// <summary>Puts the film on the position (replacing what was there); null when it already sits on another position.</summary>
    public FilmShowcase? WithInfluential(int position, int movieId)
    {
        if (position is < 1 or > Positions) throw new ArgumentOutOfRangeException(nameof(position));
        if (Influential.Any(p => p.MovieId == movieId && p.Position != position)) return null;
        return this with { Influential = [.. Influential.Where(p => p.Position != position).Append(new(movieId, position)).OrderBy(p => p.Position)] };
    }

    public FilmShowcase WithoutInfluential(int position) => this with { Influential = [.. Influential.Where(p => p.Position != position)] };

    /// <summary>Drops films that are no longer visible in the catalog, so a hidden film never shows on a profile.</summary>
    public FilmShowcase Visible(ICollection<int> visible) => new(LifeFilmId is int life && visible.Contains(life) ? life : null,
        [.. Influential.Where(p => visible.Contains(p.MovieId))]);
}
