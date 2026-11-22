namespace Favo.Series.Api;

public static class CommunityEndpoints
{
    public sealed record EntryRequest(string State, Dictionary<string,int>? Scores);
    public sealed record FeedbackRequest(string Choice);
    public sealed record NamePage(string[] Items, bool HasMore);
    public sealed record MemberPage(NetworkMember[] Items, bool HasMore);
    public sealed record ReferralPage(int Total, NetworkMember[] Readers);
    public static void MapMovieCommunity(this RouteGroupBuilder movies)
    {
        movies.MapGet("/community/options", () => Results.Ok(new { criteria=MovieRecommendations.Criteria, avatars=MovieRecommendations.Avatars }));
        // Public rating summary for the detail page: weighted overall and per-criterion averages of complete ratings.
        movies.MapGet("/community/ratings/{id:int}", (int id,MovieStore store)=>{
            var votes=store.All<MovieEntry>("entry").Where(e=>e.MovieId==id && e.Overall is not null).ToArray();
            return Results.Ok(new {
                ratingCount=votes.Length,
                averageScore=votes.Length==0 ? (decimal?)null : Math.Round(votes.Average(e=>e.Overall!.Value),2),
                criteriaAverages=votes.Length==0 ? new Dictionary<string,decimal>() : MovieRecommendations.Criteria.Keys.ToDictionary(k=>k,k=>Math.Round(votes.Average(e=>(decimal)e.Scores![k]),2))
            });
        });
        // The home page's general picks; the same for every guest, so no sign-in is needed.
        movies.MapGet("/community/highlights", async (HttpContext ctx,MovieStore store,MovieCatalog catalog,CancellationToken ct)=>{
            ctx.Response.Headers.CacheControl="public, max-age=300";
            return Results.Ok(await Highlights(store,catalog,null,ct));
        });
        var group=movies.MapGroup("/community");
        group.AddEndpointFilter(async (context,next)=>{
            var identity=context.HttpContext.RequestServices.GetRequiredService<SharedIdentity>();
            context.HttpContext.Items["viewer"]=await identity.Viewer(context.HttpContext,context.HttpContext.RequestAborted);
            return await next(context);
        });
        group.MapGet("/me", async (HttpContext ctx,MovieStore store,MovieCatalog catalog,CancellationToken ct)=>{
            var v=Viewer(ctx); var feedback=store.All<MovieFeedback>("feedback",v.UserId.ToString());
            var titles=await catalog.GetMany(feedback.Select(f=>f.MovieId),ct);
            var own=store.All<MovieEntry>("entry",v.UserId.ToString());
            return Results.Ok(new {v.Nickname,v.IsPublic,avatarId=store.Avatar(v.UserId),preferences=store.Preferences(v.UserId),entries=await Entries(store,catalog,v.UserId,ct),achievements=FilmJourney.Achievements(own),
                feedback=feedback.Select(f=>new{f.MovieId,f.Choice,title=titles.GetValueOrDefault(f.MovieId)?.Movie.Title})});
        });
        group.MapGet("/directory", async(string? query,string? kind,int? page,HttpContext ctx,SharedIdentity identity,MovieStore store,CancellationToken ct)=>{
            var number=page??1; if(number<1 || number>500)return Results.BadRequest();
            string[] names;bool hasMore;var token=SharedIdentity.Token(ctx);
            if(kind is "followers" or "following"){
                var network=await identity.Get<MovieNetwork>("api/people/me/network-members",token,ct);
                var members=(kind=="followers"?network.Followers:network.Following).OrderBy(m=>m.Nickname,StringComparer.Ordinal).Skip((number-1)*20).Take(21).ToArray();
                return Results.Ok(new {items=members.Take(20).Select(m=>new{m.Nickname,avatarId=store.Avatar(m.Id)}),hasMore=members.Length>20});
            }
            if(kind is not null || string.IsNullOrWhiteSpace(query) || !System.Text.RegularExpressions.Regex.IsMatch(query,"^[a-zA-Z0-9_]{2,24}$"))return Results.BadRequest(new{message="En az iki karakterle kullanıcı adı ara."});
            var result=await identity.Get<NamePage>($"api/people/?query={Uri.EscapeDataString(query)}&page={number}",token,ct);names=result.Items;hasMore=result.HasMore;
            var visible=new List<object>();
            foreach(var name in names){try{var member=await identity.Get<NetworkMember>("api/people/"+Uri.EscapeDataString(name),token,ct);visible.Add(new{member.Nickname,avatarId=store.Avatar(member.Id)});}catch(MovieProviderException e)when(e.Status==404){}}
            return Results.Ok(new{items=visible,hasMore});
        });
        group.MapPut("/avatar", (FilmAvatar value,HttpContext ctx,MovieStore store)=>{
            if(!MovieRecommendations.Avatars.Contains(value.AvatarId))return Results.BadRequest(new {message="Listeden bir avatar seç."});
            store.Save("avatar",Viewer(ctx).UserId.ToString(),"",value);return Results.NoContent();
        });
        // Profile showcase: "Hayatımın dizisi" and the five films that left a mark (Books' bedside and "İz bırakanlar").
        group.MapGet("/showcase", async (HttpContext ctx,MovieStore store,MovieCatalog catalog,CancellationToken ct)=>
            Results.Ok(await ShowcaseView(store,catalog,Viewer(ctx).UserId,ct)));
        group.MapPut("/showcase/life", async (ShowcaseLifeRequest value,HttpContext ctx,MovieStore store,MovieCatalog catalog,CancellationToken ct)=>{
            if(!(await catalog.GetMany([value.MovieId],ct)).ContainsKey(value.MovieId))return Results.NotFound(new {message="Dizi katalogda bulunamadı."});
            var owner=Viewer(ctx).UserId;
            store.Save("showcase",owner.ToString(),"",Showcase(store,owner).WithLife(value.MovieId));
            return Results.Ok(await ShowcaseView(store,catalog,owner,ct));
        });
        group.MapDelete("/showcase/life", async (HttpContext ctx,MovieStore store,MovieCatalog catalog,CancellationToken ct)=>{
            var owner=Viewer(ctx).UserId;
            store.Save("showcase",owner.ToString(),"",Showcase(store,owner).WithLife(null));
            return Results.Ok(await ShowcaseView(store,catalog,owner,ct));
        });
        group.MapPut("/showcase/influential/{position:int}", async (int position,ShowcasePickRequest value,HttpContext ctx,MovieStore store,MovieCatalog catalog,CancellationToken ct)=>{
            if(position is < 1 or > FilmShowcase.Positions)return Results.BadRequest(new {message="Sıra 1 ile 5 arasında olmalı."});
            if(!(await catalog.GetMany([value.MovieId],ct)).ContainsKey(value.MovieId))return Results.NotFound(new {message="Dizi katalogda bulunamadı."});
            var owner=Viewer(ctx).UserId;
            var next=Showcase(store,owner).WithInfluential(position,value.MovieId);
            if(next is null)return Results.Conflict(new {message="Bu dizi zaten iz bırakanlar arasında."});
            store.Save("showcase",owner.ToString(),"",next);
            return Results.Ok(await ShowcaseView(store,catalog,owner,ct));
        });
        group.MapDelete("/showcase/influential/{position:int}", async (int position,HttpContext ctx,MovieStore store,MovieCatalog catalog,CancellationToken ct)=>{
            var owner=Viewer(ctx).UserId;
            store.Save("showcase",owner.ToString(),"",Showcase(store,owner).WithoutInfluential(position));
            return Results.Ok(await ShowcaseView(store,catalog,owner,ct));
        });
        group.MapPut("/preferences", async (MoviePreference value,HttpContext ctx,MovieStore store,MovieCatalog catalog,CancellationToken ct)=>{
            if(!MovieRecommendations.ValidPreferences(value))return Results.BadRequest(new {message="En fazla beş tür ve üç farklı öncelik seç."});
            if(value.Genres.Length>0 && value.Genres.Except((await catalog.Genres(ct)).Select(g=>g.Id)).Any())return Results.BadRequest(new {message="Geçerli türleri seç."});
            store.Save("preference",Viewer(ctx).UserId.ToString(),"",value);return Results.NoContent();
        });
        group.MapGet("/entry/{id:int}", (int id,HttpContext ctx,MovieStore store)=>Results.Ok(new {entry=store.Get<MovieEntry>("entry",Viewer(ctx).UserId.ToString(),id.ToString())}));
        group.MapPut("/entry/{id:int}", async (int id,EntryRequest value,HttpContext ctx,MovieStore store,MovieCatalog catalog,CancellationToken ct)=>{
            if(id<=0 || !MovieStates.IsValid(value.State) || (value.Scores is not null && (!MovieRecommendations.ValidScores(value.Scores) || value.State!="watched")))
                return Results.BadRequest(new {message="İzleme durumunu ve 1–10 arasındaki yedi puanı kontrol et."});
            await catalog.Details(id,ct); // Writes are only accepted for films the catalog shows.
            var owner=Viewer(ctx).UserId.ToString(); var now=DateTimeOffset.UtcNow;
            // Keep the first "watched" moment so adding scores later does not move the film to another summary period.
            var previous=store.Get<MovieEntry>("entry",owner,id.ToString());
            var watchedAt=value.State=="watched" ? (previous is null ? null : FilmJourney.WatchedAt(previous)) ?? now : (DateTimeOffset?)null;
            store.Save("entry",owner,id.ToString(),new MovieEntry(Viewer(ctx).UserId,id,value.State,value.Scores,now,watchedAt));
            store.Save("undo",owner,id.ToString(),new EntryUndo(previous,now));
            return Results.NoContent();
        });
        group.MapDelete("/entry/{id:int}", (int id,HttpContext ctx,MovieStore store)=>{
            var owner=Viewer(ctx).UserId.ToString();
            store.Save("undo",owner,id.ToString(),new EntryUndo(store.Get<MovieEntry>("entry",owner,id.ToString()),DateTimeOffset.UtcNow));
            store.Delete("entry",owner,id.ToString());return Results.NoContent();
        });
        // "Geri al": restores the entry exactly as it was before the last change (watched moment and scores included), once.
        group.MapPost("/entry/{id:int}/undo", (int id,HttpContext ctx,MovieStore store)=>{
            var owner=Viewer(ctx).UserId.ToString();
            var undo=store.Get<EntryUndo>("undo",owner,id.ToString());
            if(undo is null || DateTimeOffset.UtcNow-undo.ChangedAtUtc>EntryUndo.Window)return Results.Conflict(new {message="Geri alınacak bir değişiklik kalmadı."});
            if(undo.Previous is null)store.Delete("entry",owner,id.ToString()); else store.Save("entry",owner,id.ToString(),undo.Previous);
            store.Delete("undo",owner,id.ToString());
            return Results.Ok(new {entry=undo.Previous});
        });
        group.MapPut("/feedback/{id:int}", async (int id,FeedbackRequest value,HttpContext ctx,MovieStore store,MovieCatalog catalog,CancellationToken ct)=>{
            if(id<=0 || value.Choice is not ("interested" or "dismissed"))return Results.BadRequest();
            await catalog.Details(id,ct);
            store.Save("feedback",Viewer(ctx).UserId.ToString(),id.ToString(),new MovieFeedback(Viewer(ctx).UserId,id,value.Choice));return Results.NoContent();
        });
        group.MapDelete("/feedback/{id:int}", (int id,HttpContext ctx,MovieStore store)=>{store.Delete("feedback",Viewer(ctx).UserId.ToString(),id.ToString());return Results.NoContent();});
        group.MapGet("/profile/{nickname}", async (string nickname,HttpContext ctx,MovieStore store,MovieCatalog catalog,SharedIdentity identity,CancellationToken ct)=>{
            var path="api/people/"+Uri.EscapeDataString(nickname);
            var member=await identity.Get<NetworkMember>(path,SharedIdentity.Token(ctx),ct);
            var entries=await Entries(store,catalog,member.Id,ct);
            var current=await identity.Get<NetworkMember>(path,SharedIdentity.Token(ctx),ct);
            if(current.Id!=member.Id)return Results.NotFound();
            var own=store.All<MovieEntry>("entry",member.Id.ToString());
            return Results.Ok(new {member.Nickname,avatarId=store.Avatar(member.Id),entries,showcase=await ShowcaseView(store,catalog,member.Id,ct),achievements=FilmJourney.Achievements(own),taste=FilmJourney.Taste(own,await catalog.GetMany(own.Select(e=>e.MovieId),ct))});
        });
        // Taste match with another public viewer, as on the Books reader profile.
        group.MapGet("/compatibility/{nickname}", async (string nickname,HttpContext ctx,MovieStore store,MovieCatalog catalog,SharedIdentity identity,CancellationToken ct)=>{
            var member=await identity.Get<NetworkMember>("api/people/"+Uri.EscapeDataString(nickname),SharedIdentity.Token(ctx),ct);
            var me=Viewer(ctx).UserId;
            if(member.Id==me)return Results.BadRequest(new {message="Kendinle uyumun hesaplanmaz."});
            var mine=store.All<MovieEntry>("entry",me.ToString()); var theirs=store.All<MovieEntry>("entry",member.Id.ToString());
            var films=await catalog.GetMany(mine.Concat(theirs).Select(e=>e.MovieId).Distinct(),ct);
            return Results.Ok(FilmJourney.Compatibility(mine,theirs,films));
        });
        // People who joined through the viewer's shared links, with their Film avatars.
        group.MapGet("/referrals", async (HttpContext ctx,SharedIdentity identity,MovieStore store,CancellationToken ct)=>{
            var referrals=await identity.Get<ReferralPage>("api/people/me/referrals",SharedIdentity.Token(ctx),ct);
            return Results.Ok(new {referrals.Total,readers=referrals.Readers.Select(p=>new{p.Nickname,avatarId=store.Avatar(p.Id)})});
        });
        group.MapGet("/journey", async (HttpContext ctx,MovieStore store,MovieCatalog catalog,CancellationToken ct)=>{
            var own=store.All<MovieEntry>("entry",Viewer(ctx).UserId.ToString());
            return Results.Ok(new {achievements=FilmJourney.Achievements(own),taste=FilmJourney.Taste(own,await catalog.GetMany(own.Select(e=>e.MovieId),ct))});
        });
        group.MapGet("/summary", async (int year,int? month,HttpContext ctx,MovieStore store,MovieCatalog catalog,CancellationToken ct)=>{
            if(!FilmJourney.IsValidPeriod(year,month))return Results.BadRequest(new {message="Geçerli bir yıl ve ay seç."});
            var own=store.All<MovieEntry>("entry",Viewer(ctx).UserId.ToString());
            return Results.Ok(FilmJourney.Summary(own,await catalog.GetMany(own.Select(e=>e.MovieId),ct),year,month,DateTimeOffset.UtcNow));
        });
        group.MapGet("/me/highlights", async (HttpContext ctx,MovieStore store,MovieCatalog catalog,CancellationToken ct)=>{
            ctx.Response.Headers.CacheControl="no-store";
            return Results.Ok(await Highlights(store,catalog,Viewer(ctx).UserId,ct));
        });
        group.MapGet("/home", async (HttpContext ctx,MovieStore store,SharedIdentity identity,MovieCatalog catalog,CancellationToken ct)=>{
            var viewer=Viewer(ctx); var token=SharedIdentity.Token(ctx); var preference=store.Preferences(viewer.UserId);
            var entries=store.All<MovieEntry>("entry");
            // Refresh visibility/follows immediately before composing personal activity.
            var network=await identity.Get<MovieNetwork>("api/people/me/network-members",token,ct);
            var following=network.Following.ToDictionary(m=>m.Id); var followers=network.Followers.ToDictionary(m=>m.Id);
            // The pool: best-known films in the chosen genres and overall, plus every film the viewer or their circle touched.
            var pool=await catalog.Candidates(preference.Genres,60,200,ct);
            var touched=await catalog.GetMany(entries.Where(e=>e.UserId==viewer.UserId || following.ContainsKey(e.UserId) || followers.ContainsKey(e.UserId)).Select(e=>e.MovieId),ct);
            var map=pool.ToDictionary(f=>f.Movie.Id); foreach(var (id,film) in touched) map[id]=film;
            object[] Activity(Dictionary<Guid,NetworkMember> people,bool reviews)=>entries.Where(e=>people.ContainsKey(e.UserId) && map.ContainsKey(e.MovieId) && (reviews ? e.Overall is not null : e.State=="watching"))
                .OrderByDescending(e=>e.UpdatedAtUtc).Take(12).Select(e=>(object)new {people[e.UserId].Nickname,avatarId=store.Avatar(e.UserId),movie=map[e.MovieId].Movie,e.Overall,e.UpdatedAtUtc}).ToArray();
            var suggestions=MovieRecommendations.Rank(map.Values.ToArray(),entries,store.All<MovieFeedback>("feedback",viewer.UserId.ToString()),viewer.UserId,preference,followers.Keys.ToHashSet());
            return Results.Ok(new {preferences=preference,suggestions,watching=Activity(following,false),reviews=Activity(followers,true),catalogNotice=(string?)null});
        });
    }
    private static MovieViewer Viewer(HttpContext ctx)=>(MovieViewer)ctx.Items["viewer"]!;
    /// <summary>The week's star and the month's most watched; for a viewer, without the films they started, rated or dismissed.</summary>
    private static async Task<FilmHighlightsResult> Highlights(MovieStore store,MovieCatalog catalog,Guid? viewer,CancellationToken ct){
        var entries=store.All<MovieEntry>("entry");
        var films=await catalog.GetMany(FilmHighlights.CandidateIds(entries),ct);
        var excluded=viewer is Guid id ? FilmHighlights.Excluded(entries,store.All<MovieFeedback>("feedback",id.ToString()),id) : [];
        return FilmHighlights.Build(entries,films,excluded,DateTimeOffset.UtcNow);
    }
    private static FilmShowcase Showcase(MovieStore store,Guid owner)=>store.Get<FilmShowcase>("showcase",owner.ToString())??FilmShowcase.Empty;
    /// <summary>The showcase with its film cards; films hidden from the catalog since they were picked are left out.</summary>
    private static async Task<object> ShowcaseView(MovieStore store,MovieCatalog catalog,Guid owner,CancellationToken ct){
        var showcase=Showcase(store,owner);
        var films=await catalog.GetMany(showcase.FilmIds,ct);
        var visible=showcase.Visible(films.Keys);
        return new {visible.LifeFilmId,visible.Influential,films=films.Values.Select(f=>f.Movie).ToArray()};
    }
    private static async Task<object[]> Entries(MovieStore store,MovieCatalog catalog,Guid user,CancellationToken ct)
    {
        var entries=store.All<MovieEntry>("entry",user.ToString()).OrderByDescending(e=>e.UpdatedAtUtc).ToArray();
        var films=await catalog.GetMany(entries.Select(e=>e.MovieId),ct);
        // Entries for films the catalog no longer shows (or never had) stay stored but are not listed.
        return entries.Where(e=>films.ContainsKey(e.MovieId)).Select(e=>(object)new {entry=new{e.MovieId,e.State,e.Scores,e.Overall,e.UpdatedAtUtc},movie=films[e.MovieId].Movie}).ToArray();
    }
}
