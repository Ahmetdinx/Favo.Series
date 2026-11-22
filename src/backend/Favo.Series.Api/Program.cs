using Favo.Series.Api;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Npgsql;
using Microsoft.IdentityModel.Tokens;

var builder = WebApplication.CreateBuilder(args);
// Favo.Identity signs access tokens (Movie verifies them with its published key) and owns the shared
// profile and follow graph, read from /api/people with the caller's token.
var identityUri = TrustedOrigin("Identity:ApiOrigin", "http://localhost:5110/");
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer(options =>
{
    options.MapInboundClaims = false;
    options.MetadataAddress = new Uri(identityUri, ".well-known/openid-configuration").ToString();
    options.RequireHttpsMetadata = identityUri.Scheme == Uri.UriSchemeHttps;
    options.TokenValidationParameters = new TokenValidationParameters
    {
        ValidIssuer = builder.Configuration["Identity:Issuer"] ?? "favo-identity",
        ValidAudience = builder.Configuration["Identity:Audience"] ?? "favo",
        ValidAlgorithms = [SecurityAlgorithms.RsaSha256],
        ClockSkew = TimeSpan.FromSeconds(30),
    };
});
builder.Services.AddAuthorization();
builder.Services.AddHttpClient<SharedIdentity>(client=>{client.BaseAddress=identityUri;client.Timeout=TimeSpan.FromSeconds(10);})
    .ConfigurePrimaryHttpMessageHandler(()=>new HttpClientHandler{AllowAutoRedirect=false,UseCookies=false});
// The catalog and the viewer data live in the shared Postgres ("series" schema); the catalog is filled offline from Wikidata
// by tools/Favo.Series.CatalogImport, which also applies the schema migrations.
var catalogConnection = builder.Configuration.GetConnectionString("Database")
    ?? throw new InvalidOperationException("Configure ConnectionStrings:Database (user-secrets in development).");
builder.Services.AddSingleton(NpgsqlDataSource.Create(catalogConnection));
builder.Services.AddSingleton<MovieCatalog>();
builder.Services.AddSingleton<MovieStore>();
var app = builder.Build();
app.UseAuthentication();
app.UseAuthorization();
app.MapGet("/", () => Results.Ok(new { service = "Favo.Series.Api", status = "running" }));
var movies = app.MapGroup("/api/series");
movies.AddEndpointFilter(async (context, next) => {
    context.HttpContext.Response.Headers.CacheControl = "no-store";
    try { return await next(context); }
    catch (MovieProviderException e) { return Results.Json(new { code = e.Code, message = e.Message }, statusCode: e.Status); }
    catch (PostgresException) { return Results.Json(new { code = "catalog_unavailable", message = "Dizi kataloğu hazır değil." }, statusCode: 503); }
    catch (NpgsqlException) { return Results.Json(new { code = "catalog_unavailable", message = "Dizi kataloğuna şu anda ulaşılamıyor." }, statusCode: 503); }
});
movies.MapGet("/genres", async (MovieCatalog catalog, CancellationToken ct) => Results.Ok(await catalog.Genres(ct)));
movies.MapGet("/", async (string? query, int? page, int? year, int? genre, string? sort, MovieCatalog catalog, CancellationToken ct) => {
    var request = new CatalogQuery(query?.Trim() ?? "", page ?? 1, year, genre, sort ?? "mixed");
    if (!request.IsValid()) return Results.BadRequest(new { code = "invalid_query", message = "Arama ve filtre değerlerini kontrol et." });
    return Results.Ok(await catalog.Browse(request, ct));
});
movies.MapGet("/{id:int}", async (int id, MovieCatalog catalog, CancellationToken ct) =>
    id <= 0 ? Results.BadRequest() : Results.Ok(await catalog.Details(id, ct)));
movies.MapMovieCommunity();
app.Run();

Uri TrustedOrigin(string key, string developmentDefault)
{
    var value = builder.Configuration[key] ?? (builder.Environment.IsDevelopment() ? developmentDefault : throw new InvalidOperationException($"Configure {key}."));
    if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) || uri.UserInfo.Length>0 || uri.Query.Length>0 || uri.Fragment.Length>0 || uri.AbsolutePath!="/" || (uri.Scheme!="https" && !(builder.Environment.IsDevelopment() && uri.Scheme=="http" && uri.IsLoopback)))
        throw new InvalidOperationException($"{key} must be a trusted HTTPS origin (loopback HTTP allowed in Development).");
    return uri;
}
public partial class Program { }
