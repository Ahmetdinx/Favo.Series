# Favo.Series

Favo Dizi: ortak Favo oturumu, kendi dizi kataloğu, izleme listeleri, yedi ölçütlü değerlendirme, öneriler, rozetler, izleyici kimliği ve aylık/yıllık izleme özeti. .NET 10 API + React/TypeScript/Vite. Favo.Movie'den türetildi; işlevleri ve tasarımı onunla aynıdır, renkleri gece mavisi/turkuazdır.

## Katalog

- Dizi künyeleri Favo'nun kendi Postgres veritabanındadır (`series` şeması). Kaynak Wikidata'dır (CC0); veri çevrimdışı araçlarla manifest → doğrulama → `--apply` akışıyla girer. Adımlar: `tools/catalog/README.md`.
- Özetleri Favo yazar (`summaries` komutu). Vikipedi metni kopyalanmaz. Afiş yoktur; ön yüz tipografik kapak çizer.
- Künyede yayın aralığı, sezon ve bölüm sayısı, bölüm süresi, kanal/platform, yaratıcılar, oyuncular, ülke ve tür bulunur.
- Dış kaynak puanı gösterilmez; puanlar Favo kullanıcılarınındır.

## Topluluk

- Hesap, kullanıcı adı, gizlilik ve takip ağı Favo hesap servisindedir (`/api/people`); Dizi yalnızca token'ı açık anahtarla doğrular.
- İzleyeceğim / izliyorum / izledim, ara verdim, yarım bıraktım ve yedi ölçütlü değerlendirme; ana sayfa, profil ("Dizi arşivim"), vitrin ("Hayatımın dizisi", "İz bırakanlar") ve özet sayfası Film ile aynıdır.

## Çalıştırma

Favo deposundaki `Start-Favo.ps1` Dizi API'sini (5140) başlatır ve ön yüzü `/dizi/` altında sunar: http://localhost:5175/dizi/
