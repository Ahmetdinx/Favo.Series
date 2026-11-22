# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Favo Dizi; kendi dizi kataloğu (Wikidata künyeleri, bizim özetlerimiz), izleme listeleri, yedi ölçütlü değerlendirme, öneriler ve ortak takip ağı sunan uygulamadır. Favo.Movie'den (Film) türetildi ve işlevleri onunla birebir aynıdır; renkleri gece mavisi/turkuazdır.

## Film ile ilişki

- Kod Film'in kopyasıdır. Proje ve ad alanı `Favo.Series`; iç tür adları (`MovieCard`, `MovieStore`, `FilmCover`, `FilmJourney`, CSS'teki `film-*` sınıfları) bilerek Film'deki gibi bırakıldı ki iki depo arasında değişiklik taşımak kolay kalsın. Film'de yapılan bir iyileştirme genelde dosya karşılaştırılarak buraya taşınır; tersi de geçerlidir.
- Dışa görünen her şey Dizi'ye özeldir: yol `/dizi/`, API `/api/series`, Postgres şeması `series` (tablo adları Film'deki gibi `films`, `film_genres`, `visible_films`; editoryal karar değeri de `Film`), portlar 5140 (API) ve 5177 (tek başına ön yüz), tarayıcı anahtarları `favo-dizi:*`, user-secrets kimliği `favo-series-local-2026`.
- Diziye özgü olan: `CatalogSchema` migration 3 (`end_year`, `seasons`, `episodes`, `networks`), `MovieDetails`'teki aynı adlı alanlar, dizi sayfasındaki künye (yayın aralığı, sezon, bölüm, bölüm süresi, kanal) ve özetteki toplam süre (bölüm süresi × bölüm sayısı). `Directors` dizinin yaratıcılarıdır (Wikidata P170, yoksa P57); `Runtime` bir bölümün süresidir.
- Film'deki Letterboxd içe aktarımı Dizi'de yoktur.
- Metinler: film → dizi, seyirci → izleyici, sinemasever → dizisever, yönetmen → yaratıcı, perde/salon → ekran/kanal. "Herkesin perdesinden" burada "Herkesin ekranından"dır. Altın çerçeve renk dönüşümünden bilerek muaf tutuldu.

## Komutlar

```powershell
dotnet build Favo.Series.slnx
dotnet run --project tests/Favo.Series.Checks      # 39 kontrol; veritabanı gerekmez
dotnet run --project tools/Favo.Series.CatalogImport -- migrate   # series şeması; API açılışta migration çalıştırmaz
dotnet run --project src/backend/Favo.Series.Api
npm --prefix src/frontend ci
npm --prefix src/frontend run lint
```

Ön yüzü Favo ağ geçidi için derlemek `Favo/scripts/Build-Series.ps1` ile yapılır (`/dizi/` tabanıyla `Favo/artifacts/series` altına); `npm run build` yalnızca yerel `dist` üretir. `Favo/Start-Favo.ps1` Dizi API'sini de başlatır.

Topluluk entegrasyon kontrolleri Docker ve Favo deposunu gerektirir, `Favo.Series.slnx` derlemesine dahil değildir:

```powershell
$env:FAVO_ROOT='C:/Projects/Favo'
$env:FAVO_SERIES_ROOT='C:/Projects/Favo.Series'
dotnet run --project tests/Favo.Series.CommunityChecks -c Release -p:FavoRoot=C:/Projects/Favo
```

Kontrol projeleri çalıştırılabilir programlardır, `dotnet test` bulmaz; ilk başarısız kontrolde durur.

## Katalog

Akış Film ile aynıdır (`tools/catalog/README.md`): aday → manifest → Wikidata'ya karşı doğrulama (24 saat geçerli, hash eşleşmeli) → `--apply`; özetleri biz yazarız, Vikipedi metni kopyalanmaz, afiş yerine tipografik kapak kullanılır. Adaylar televizyon dizisi, animasyon dizisi, mini dizi, anime ve web dizisi türlerinden gelir. Türk dizilerinin az dilde maddesi olduğu için ayrı ve düşük bir eşikle toplanır ve manifestte kotayla yer alır (`prepare-manifest.mjs <parti> [adet=500] [türk=100]`). Bölüm, sezon, medya serisi ve tek film kayıtları alınmaz.

## Mimari, kimlik ve kurallar

Film'in CLAUDE.md'sindeki mimari, kimlik, öneri ve puan kuralları burada da aynen geçerlidir (tek API projesi, ham SQL, `MovieStore` belge deposu `series.viewer_documents`, hesap servisinin RS256 token'ı ve `/api/people` uçları, yedi ölçüt ve öneri puanları, "Herkesin ekranından" ve altın çerçeve kuralı). `src/frontend/src/auth/sessionTransport.ts` ve `src/frontend/src/campaign.ts` Favo, Favo.Books ve Favo.Movie ile birebir aynı kalmalıdır. Sayfa çerçevesi (`layout.css`) ve profil rafı Kitap ile aynı ölçülerdedir. Kayıt Kitap'ın `/kitap/register?donus=/dizi/baslangic` sayfasında yapılır.
