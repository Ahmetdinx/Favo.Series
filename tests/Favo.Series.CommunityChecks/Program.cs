extern alias movie;
extern alias identity;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Favo.Series.Api;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using Testcontainers.PostgreSql;
using IdentityDbContext = identity::Favo.Identity.Persistence.IdentityDbContext;

// Movie community features against the real Favo account service (Kestrel 5111) and a disposable database.
var favoRoot=Environment.GetEnvironmentVariable("FAVO_ROOT")!;
var movieRoot=Environment.GetEnvironmentVariable("FAVO_SERIES_ROOT")!;
await using var database=new PostgreSqlBuilder("postgres:18.4-alpine3.24").WithDatabase("movie_checks").WithUsername("postgres").WithPassword("test-only").Build();
await database.StartAsync();
var keyPath=Path.Combine(Path.GetTempPath(),$"favo-series-checks-{Guid.NewGuid():N}.pem");
await using var accountsFactory=new IdentityFactory(favoRoot,database.GetConnectionString(),keyPath);
accountsFactory.UseKestrel(5111);
using(var scope=accountsFactory.Services.CreateScope())
 await scope.ServiceProvider.GetRequiredService<IdentityDbContext>().Database.MigrateAsync();
// Film's own catalog: the real schema plus three fixture films (one hidden by a later editorial decision).
await using(var catalogDb=NpgsqlDataSource.Create(database.GetConnectionString())){
 await CatalogSchema.Migrate(catalogDb);
 await using var seed=catalogDb.CreateCommand("""
  INSERT INTO series.films (id, wikidata_id, source_revision, title, original_title, release_year, runtime_minutes, directors, popularity, search_text) VALUES
   (42, 'Q900042', 1, 'Test Filmi · Son Seans', 'Last Screening', 2026, 110, '{Test Yönetmeni}', 90, 'test filmi son seans last screening test yonetmeni'),
   (43, 'Q900043', 1, 'Test Filmi · Gece Yolculuğu', 'Night Journey', 2025, 95, '{Test Yönetmeni}', 80, 'test filmi gece yolculugu night journey test yonetmeni'),
   (44, 'Q900044', 1, 'Gizlenen Kayıt', NULL, 2020, 90, '{}', 99, 'gizlenen kayit');
  INSERT INTO series.film_genres VALUES (42, 18), (43, 18), (44, 35);
  INSERT INTO series.editorial_decisions (film_id, decision, batch_id) VALUES (42,'Film','checks'),(43,'Film','checks'),(44,'Film','checks'),(44,'Hidden','checks-fix');
  """);
 await seed.ExecuteNonQueryAsync();
}
await using var movieFactory=new MovieFactory(movieRoot,database.GetConnectionString());
if(args.Contains("--serve"))movieFactory.UseKestrel(5141);
using var anonymous=movieFactory.CreateClient();
var checks=0;
void Check(bool value,string name){if(!value)throw new Exception(name);checks++;Console.WriteLine("PASS "+name);}
async Task<JsonElement> Read(HttpClient c,string path){var r=await c.GetAsync(path);r.EnsureSuccessStatusCode();return await r.Content.ReadFromJsonAsync<JsonElement>();}
async Task<(HttpClient Accounts,HttpClient Movie,Guid Id)> User(string name){
 var client=new HttpClient{BaseAddress=new Uri("http://localhost:5111")};
 (await client.PostAsJsonAsync("/api/identity/register",new{email=name+"@example.test",nickname=name,password="Cinema-Test-Only-2026!"})).EnsureSuccessStatusCode();
 var r=await client.PostAsJsonAsync("/api/identity/login",new{email=name+"@example.test",password="Cinema-Test-Only-2026!"});r.EnsureSuccessStatusCode();var login=await r.Content.ReadFromJsonAsync<JsonElement>();
 client.DefaultRequestHeaders.Authorization=new AuthenticationHeaderValue("Bearer",login.GetProperty("accessToken").GetString());
 (await client.PutAsJsonAsync("/api/people/me",new{nickname=name,isPublic=true})).EnsureSuccessStatusCode();
 var film=movieFactory.CreateClient();film.DefaultRequestHeaders.Authorization=client.DefaultRequestHeaders.Authorization;
 return(client,film,login.GetProperty("userId").GetGuid());
}
var browse=await Read(anonymous,"/api/series/?query=GECE%20YOLCULU%C4%9EU");
Check(browse.GetProperty("totalResults").GetInt32()==1 && browse.GetProperty("items")[0].GetProperty("id").GetInt32()==43,"Catalog search is Turkish-aware");
var all=await Read(anonymous,"/api/series/?sort=popular");
Check(all.GetProperty("totalResults").GetInt32()==2 && all.GetProperty("items")[0].GetProperty("id").GetInt32()==42,"Hidden films are not listed; best-known first");
Check((await Read(anonymous,"/api/series/")).GetProperty("totalResults").GetInt32()==2,"Default mixed order lists every visible film");
var fuzzy=await Read(anonymous,"/api/series/?query=gece%20yolculgu");
Check(fuzzy.GetProperty("approximate").GetBoolean() && fuzzy.GetProperty("items")[0].GetProperty("id").GetInt32()==43,"Misspelled search falls back to similar titles");
Check(!(await Read(anonymous,"/api/series/?query=gizlenen%20kayt")).GetProperty("items").EnumerateArray().Any(),"Fallback search never shows hidden films");
Check((await anonymous.GetAsync("/api/series/44")).StatusCode==HttpStatusCode.NotFound,"Latest editorial decision hides a film");
Check((await Read(anonymous,"/api/series/?genre=18&sort=newest")).GetProperty("items")[0].GetProperty("id").GetInt32()==42,"Genre filter and newest order");
var ada=await User("movieada");var deniz=await User("moviedeniz");var ece=await User("movieece");var can=await User("moviecan");
var scores=MovieRecommendations.Criteria.Keys.ToDictionary(k=>k,_=>10);
Check((await anonymous.GetAsync("/api/series/community/me")).StatusCode==HttpStatusCode.Unauthorized,"Anonymous profile denied");
Check((await anonymous.PutAsJsonAsync("/api/series/community/avatar",new{avatarId="noir"})).StatusCode==HttpStatusCode.Unauthorized,"Anonymous mutation denied");
anonymous.DefaultRequestHeaders.Authorization=new AuthenticationHeaderValue("Bearer","forged");
Check((await anonymous.GetAsync("/api/series/community/me")).StatusCode==HttpStatusCode.Unauthorized,"Forged bearer rejected by shared identity");
Check((await ada.Movie.PutAsJsonAsync("/api/series/community/avatar",new{avatarId="unknown"})).StatusCode==HttpStatusCode.BadRequest,"Unknown avatar rejected");
(await ada.Movie.PutAsJsonAsync("/api/series/community/avatar",new{avatarId="space"})).EnsureSuccessStatusCode();
Check((await Read(ada.Movie,"/api/series/community/me")).GetProperty("avatarId").GetString()=="space","Film avatar persisted");
Check((await Read(deniz.Movie,"/api/series/community/me")).GetProperty("avatarId").GetString()=="projector","Avatar is account scoped");
Check(!(await Read(ada.Accounts,"/api/people/me")).TryGetProperty("avatarId",out _),"Film avatar stays out of the shared account");
Check((await ada.Movie.PutAsJsonAsync("/api/series/community/preferences",new{genres=new[]{18},criteria=new[]{"theme","theme"}})).StatusCode==HttpStatusCode.BadRequest,"Duplicate criteria rejected");
(await ada.Movie.PutAsJsonAsync("/api/series/community/preferences",new{genres=new[]{18},criteria=new[]{"theme","visuals","pace"}})).EnsureSuccessStatusCode();
Check((await ada.Movie.PutAsJsonAsync("/api/series/community/entry/42",new{state="watched",scores=new{theme=11}})).StatusCode==HttpStatusCode.BadRequest,"Incomplete/out of range rating rejected");
Check((await ada.Movie.PutAsJsonAsync("/api/series/community/entry/44",new{state="watchlist"})).StatusCode==HttpStatusCode.NotFound,"Hidden or unknown film cannot be added");
Check((await ada.Movie.PutAsJsonAsync("/api/series/community/entry/42",new{state="watching",scores})).StatusCode==HttpStatusCode.BadRequest,"Unwatched rating rejected");
foreach(var u in new[]{deniz,ece,can})(await u.Movie.PutAsJsonAsync("/api/series/community/entry/42",new{state="watched",scores})).EnsureSuccessStatusCode();
(await deniz.Movie.PutAsJsonAsync("/api/series/community/entry/43",new{state="watching"})).EnsureSuccessStatusCode();
// Ara verdim / Yarım bıraktım and a one-time undo that restores the previous entry.
(await deniz.Movie.PutAsJsonAsync("/api/series/community/entry/43",new{state="dropped"})).EnsureSuccessStatusCode();
Check((await Read(deniz.Movie,"/api/series/community/entry/43")).GetProperty("entry").GetProperty("state").GetString()=="dropped","Dropped state saved");
(await deniz.Movie.PostAsync("/api/series/community/entry/43/undo",null)).EnsureSuccessStatusCode();
Check((await Read(deniz.Movie,"/api/series/community/entry/43")).GetProperty("entry").GetProperty("state").GetString()=="watching","Undo restores the previous state");
Check((await deniz.Movie.PostAsync("/api/series/community/entry/43/undo",null)).StatusCode==HttpStatusCode.Conflict,"Undo works once");
Check((await deniz.Movie.PutAsJsonAsync("/api/series/community/entry/43",new{state="finished"})).StatusCode==HttpStatusCode.BadRequest,"Unknown state rejected");
(await deniz.Accounts.PutAsync("/api/people/movieada/follow",null)).EnsureSuccessStatusCode();
(await ada.Accounts.PutAsync("/api/people/moviedeniz/follow",null)).EnsureSuccessStatusCode();
var home=await Read(ada.Movie,"/api/series/community/home");
Check(home.GetProperty("reviews").GetArrayLength()==1,"Follower film rating visible");
Check(home.GetProperty("watching").GetArrayLength()==1,"Following film activity visible");
var suggestion=home.GetProperty("suggestions").EnumerateArray().Single(s=>s.GetProperty("movie").GetProperty("id").GetInt32()==42);
Check(suggestion.GetProperty("shelf").GetString()=="perfect","Three ratings above nine plus genre and three priorities form perfect match");
Check(suggestion.GetProperty("reasons").EnumerateArray().Any(r=>r.GetString()!.Contains("takipçin")),"Follower rating contributes explained signal");
// Home page general picks: open to guests; a viewer never sees the films they watched.
var everyone=await anonymous.GetAsync("/api/series/community/highlights");
var picks=await everyone.Content.ReadFromJsonAsync<JsonElement>();
Check(everyone.Headers.CacheControl?.Public==true && picks.GetProperty("star").GetProperty("films")[0].GetProperty("movie").GetProperty("id").GetInt32()==42
    && picks.GetProperty("mostWatched").GetProperty("films")[0].GetProperty("viewers").GetInt32()==3,"Week's star and most watched are public");
bool HasFilm(JsonElement result,int id)=>new[]{"star","mostWatched"}.Any(list=>result.GetProperty(list).GetProperty("films").EnumerateArray().Any(f=>f.GetProperty("movie").GetProperty("id").GetInt32()==id));
Check(HasFilm(await Read(ada.Movie,"/api/series/community/me/highlights"),42) && !HasFilm(await Read(deniz.Movie,"/api/series/community/me/highlights"),42),"Highlights leave out the viewer's watched films");
(await deniz.Accounts.PutAsJsonAsync("/api/people/me",new{nickname="moviedeniz",isPublic=false})).EnsureSuccessStatusCode();
home=await Read(ada.Movie,"/api/series/community/home");
Check(home.GetProperty("reviews").GetArrayLength()==0 && home.GetProperty("watching").GetArrayLength()==0,"Private profile removed from both activity feeds");
Check((await ada.Movie.GetAsync("/api/series/community/profile/moviedeniz")).StatusCode==HttpStatusCode.NotFound,"Private film profile denied");
Check((await ada.Accounts.GetAsync("/api/people/moviedeniz")).StatusCode==HttpStatusCode.NotFound,"Shared public identity respects privacy");
(await deniz.Accounts.PutAsJsonAsync("/api/people/me",new{nickname="moviedeniz",isPublic=true})).EnsureSuccessStatusCode();
// Profile showcase: life film and five films that left a mark.
Check((await deniz.Movie.PutAsJsonAsync("/api/series/community/showcase/life",new{movieId=44})).StatusCode==HttpStatusCode.NotFound,"Hidden film cannot be the life film");
(await deniz.Movie.PutAsJsonAsync("/api/series/community/showcase/life",new{movieId=42})).EnsureSuccessStatusCode();
(await deniz.Movie.PutAsJsonAsync("/api/series/community/showcase/influential/1",new{movieId=43})).EnsureSuccessStatusCode();
Check((await deniz.Movie.PutAsJsonAsync("/api/series/community/showcase/influential/2",new{movieId=43})).StatusCode==HttpStatusCode.Conflict,"A film sits on one showcase position");
Check((await deniz.Movie.PutAsJsonAsync("/api/series/community/showcase/influential/6",new{movieId=42})).StatusCode==HttpStatusCode.BadRequest,"Showcase has five positions");
var shown=(await Read(ada.Movie,"/api/series/community/profile/moviedeniz")).GetProperty("showcase");
Check(shown.GetProperty("lifeFilmId").GetInt32()==42 && shown.GetProperty("influential")[0].GetProperty("movieId").GetInt32()==43 && shown.GetProperty("films").GetArrayLength()==2,"Public profile shows the showcase with its films");
(await deniz.Movie.DeleteAsync("/api/series/community/showcase/life")).EnsureSuccessStatusCode();
Check((await Read(deniz.Movie,"/api/series/community/showcase")).GetProperty("lifeFilmId").ValueKind==JsonValueKind.Null,"Life film can be removed");
Check((await Read(deniz.Movie,"/api/series/community/me")).GetProperty("achievements")[0].GetProperty("kind").GetString()=="watching","Profile carries badge tracks for the celebration");
(await deniz.Accounts.DeleteAsync("/api/people/movieada/follow")).EnsureSuccessStatusCode();
Check((await Read(ada.Movie,"/api/series/community/home")).GetProperty("reviews").GetArrayLength()==0,"Unfollow removes follower reviews");
(await ada.Movie.PutAsJsonAsync("/api/series/community/feedback/42",new{choice="dismissed"})).EnsureSuccessStatusCode();
Check(!(await Read(ada.Movie,"/api/series/community/home")).GetProperty("suggestions").EnumerateArray().Any(s=>s.GetProperty("movie").GetProperty("id").GetInt32()==42),"Dismissed movie excluded");
(await ada.Movie.DeleteAsync("/api/series/community/feedback/42")).EnsureSuccessStatusCode();
(await ada.Movie.PutAsJsonAsync("/api/series/community/entry/42",new{state="watched",scores})).EnsureSuccessStatusCode();
Check(!(await Read(ada.Movie,"/api/series/community/home")).GetProperty("suggestions").EnumerateArray().Any(s=>s.GetProperty("movie").GetProperty("id").GetInt32()==42),"Watched/rated movie excluded");
(await ada.Movie.DeleteAsync("/api/series/community/entry/42")).EnsureSuccessStatusCode();
Check((await Read(deniz.Movie,"/api/series/community/me")).GetProperty("entries").GetArrayLength()==2,"Delete cannot affect another user's films");
await using(var fresh=NpgsqlDataSource.Create(database.GetConnectionString()))Check(new MovieStore(fresh).Avatar(ada.Id)=="space","Viewer data is stored in Postgres and survives a new store");
Check((await Read(deniz.Movie,"/api/series/community/directory?query=movieada")).GetProperty("items")[0].GetProperty("avatarId").GetString()=="space","Search uses saved movie avatar");
Check((await Read(ada.Movie,"/api/series/community/directory?kind=following")).GetProperty("items").GetArrayLength()==1,"Movie follows list uses shared graph");
var weighted=MovieRecommendations.Criteria.Keys.ToDictionary(k=>k,_=>10);weighted["pace"]=1;
Check(new MovieEntry(ada.Id,42,"watched",weighted,DateTimeOffset.UtcNow).Overall==9.1m,"Same weighting as Books: pace ten percent, other criteria fifteen");
var store=movieFactory.Services.GetRequiredService<MovieStore>();
var films=(await movieFactory.Services.GetRequiredService<MovieCatalog>().GetMany([42,43],default)).Values.ToArray();
var entries=store.All<MovieEntry>("entry");
var pref=new MoviePreference([18],["theme","visuals","pace"]);
Check(MovieRecommendations.Rank(films,entries.Where(e=>e.UserId!=can.Id).ToArray(),[],ada.Id,pref,[]).All(s=>s.Shelf!="perfect"),"Fewer than three ratings never claims perfect");
var nine=entries.Select(e=>e with{Scores=e.Scores is null?null:MovieRecommendations.Criteria.Keys.ToDictionary(k=>k,_=>9)}).ToArray();
Check(MovieRecommendations.Rank(films,nine,[],ada.Id,pref,[]).All(s=>s.Shelf!="perfect"),"Exactly nine does not meet above-nine threshold");
Check(MovieRecommendations.Rank(films,entries,[],ada.Id,new([35],["theme","visuals","pace"]),[]).Any(s=>s.Shelf=="discovery"),"Strong out-of-genre film uses discovery shelf");
Check(MovieRecommendations.Rank(films,[],[],ada.Id,new([35],[]),[]).Length==0,"Unrelated genre without evidence excluded");
Console.WriteLine($"PASS: {checks} Movie community integration checks. Disposable databases only.");
if(args.Contains("--serve")){
 (await deniz.Accounts.PutAsync("/api/people/movieada/follow",null)).EnsureSuccessStatusCode();
 Console.WriteLine("PREVIEW READY: Movie5141 Accounts5111; movieada@example.test / Cinema-Test-Only-2026!");
 using var stop=new CancellationTokenSource();Console.CancelKeyPress+=(_,e)=>{e.Cancel=true;stop.Cancel();};try{await Task.Delay(Timeout.Infinite,stop.Token);}catch(OperationCanceledException){}
}

sealed class IdentityFactory(string root,string connection,string keyPath):WebApplicationFactory<identity::Program>{
 protected override void ConfigureWebHost(IWebHostBuilder b){b.UseContentRoot(Path.Combine(root,"src/backend/Favo.Identity.Api"));b.UseEnvironment("Testing");b.UseSetting("ConnectionStrings:Database",connection);b.UseSetting("Jwt:Issuer","favo-identity");b.UseSetting("Jwt:Audience","favo");b.UseSetting("Jwt:SigningKeyPath",keyPath);b.UseSetting("Jwt:ExpirationMinutes","60");b.UseSetting("Google:ClientId","");b.UseSetting("Logging:LogLevel:Default","Warning");}
}
sealed class MovieFactory(string root,string catalog):WebApplicationFactory<movie::Program>{
 protected override void ConfigureWebHost(IWebHostBuilder b){b.UseContentRoot(Path.Combine(root,"src/backend/Favo.Series.Api"));b.UseEnvironment("Development");b.UseSetting("Identity:ApiOrigin","http://localhost:5111/");b.UseSetting("ConnectionStrings:Database",catalog);b.UseSetting("Logging:LogLevel:Default","Warning");}
}
