# Dizi kataloğu araçları

Dizi kataloğu Favo'nun kendi Postgres veritabanındadır (`series` şeması). Künyeler Wikidata'dan (CC0) çevrimdışı alınır; özetleri biz yazarız, kapaklar Favo'nun tipografik tasarımıdır. Akış Kitap'taki `PublisherImport` ile aynıdır: aday → manifest → kaynağa karşı doğrulama → `--apply`.

```powershell
# 0. Şema (bir kez, sonra her yeni migration'da)
dotnet run --project tools/Favo.Series.CatalogImport -- migrate

# 1. Adaylar: Türkçe Vikipedi maddesi olan, en az N dilde maddesi bulunan diziler (Türk dizileri için ayrı, düşük eşik) (artifacts/catalog, Git dışı)
node tools/catalog/fetch-candidates.mjs 25 1500 4

# 2. Manifest: henüz alınmamış en bilinen diziler
node tools/catalog/prepare-manifest.mjs series-20261122 500 100   # 500 dizi, 100 Türk dizisi kotası; önceki partilerdekiler atlanır

# 3. Doğrulama: her kayıt Wikidata'dan yeniden okunur; 24 saat geçerlidir
node tools/catalog/verify-manifest.mjs series-20261122

# 4. İçe aktarma: önce deneme, sonra --apply
dotnet run --project tools/Favo.Series.CatalogImport -- import data/curation/series-20261122 --batch series-20261122
dotnet run --project tools/Favo.Series.CatalogImport -- import data/curation/series-20261122 --batch series-20261122 --apply

# Özetler (bizim yazdığımız): WikidataId<TAB>Özet
dotnet run --project tools/Favo.Series.CatalogImport -- summaries data/curation/film-summaries/summaries.tsv --apply

# Editoryal düzeltme (tekrar kayıt, film olmayan kayıt): WikidataId<TAB>Film|Hidden (Film = görünür)<TAB>Not
dotnet run --project tools/Favo.Series.CatalogImport -- decisions data/curation/<klasör>/decisions.tsv --batch <yeni-kimlik> --apply
```

Kurallar:

- Bir parti kimliği farklı içerikle yeniden kullanılamaz; aynı manifesti tekrar uygulamak değişiklik yapmaz.
- Doğrulama, manifest dosyasının SHA-256 değerini kaydeder; manifest sonradan değişirse içe aktarma reddedilir.
- Kararlar yalnızca eklenir. Bir filmi gizlemek için yeni bir `Hidden` kararı eklenir; geçmiş silinmez. Katalogda yalnızca son kararı `Film` olanlar görünür.
- Türler Kitap'taki gibi sabit bir listedir (TMDB numaralarıyla uyumlu 18 tür). Wikidata türleri `records.mjs` içindeki kurallarla eşlenir; her partide `genre-map.tsv` ve `review.tsv` incelenir.
- Wikidata'ya istekler sırayla ve beklemeli yapılır; 429 gelirse `Retry-After`'a uyulur. Kesilen bir çekme önbellekten devam eder.
- Vikipedi metinleri kopyalanmaz (CC BY-SA). Afiş için lisans alınana kadar `poster_url` boş kalır.
