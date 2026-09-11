# Kristal Kule 360

Tam ekran 360° panorama görüntüleyici: fare/dokunmatik ile etrafa bakma, tekerlek ile
yakınlaştırma, işaretler (hotspot) ve tarayıcı içinde işaret düzenleme modu.
Astro statik çıktı, tek WebGL2 canvas, kademeli (progressive) panorama yükleme.
Paylaşımlı Linux hostingde çalışır; Node.js gerekmez.

## Komutlar

```
npm install        # bağımlılıklar + decoder/font kopyalama
npm run pano       # source-panos/*.jpg  ->  public/assets/pano/<id>/  (katmanlar + manifest)
npm run dev        # http://localhost:4322
npm run build      # dist/ üretir (+ .br/.gz sıkıştırılmış kopyalar)
npm run analyze    # paket boyut raporu
```

## İşaret (hotspot) ekleme

1. Siteyi `?edit` ile açın: `http://localhost:4322/?edit` (veya canlı sitede `/?edit`).
2. Panoramada işaretlemek istediğiniz noktaya tıklayın, ad ve isteğe bağlı açıklama girin.
3. **Kaydet** düğmesine basın. İşaretler doğrudan `assets/pano/kristal-kule/hotspots.json`
   dosyasına yazılır:
   - Geliştirmede (`npm run dev`) Vite eklentisi dosyayı diske yazar, şifre sorulmaz.
   - Canlı sitede `api/save-hotspots.php` çalışır ve bir kez şifre sorar (sekme kapanana kadar hatırlar).
   **Kopyala** / **İndir** yedek yollar olarak durur.

### Canlı sitede Kaydet için kurulum

- `public/api/save-hotspots.php` içindeki `PASSWORD` değerini değiştirin, sonra `npm run build` alıp yükleyin.
- Sunucuda `assets/pano/kristal-kule/` klasörü PHP tarafından yazılabilir olmalı (genelde 755/644 yeter; olmazsa 775/664).
- Şifre değiştirilmeden Kaydet çalışmaz (betik bilerek reddeder).
- CDN kullanıyorsanız PHP yalnızca hosting'deki kopyayı günceller; CDN'deki `hotspots.json` dosyasını ayrıca yenileyin.

Düzenleme modundaki değişiklikler tarayıcının localStorage'ında tutulur; **Dosyaya dön**
düğmesi sunucudaki JSON'a geri döner. Bir işaretin yerini değiştirmek için silip yeniden ekleyin.

JSON biçimi:

```json
[
  { "id": "kuleler", "yaw": 43, "pitch": -12, "label": "Konut kuleleri", "icon": "konut", "text": "Açıklama (isteğe bağlı)" }
]
```

`icon` değerleri: `genel`, `konut`, `hastane`, `okul`, `avm`, `ulasim`, `park`, `cami`, `spor`, `deniz`, `otopark`.
Yeni ikon eklemek için `src/scripts/icons.ts` dosyasına bir SVG yolu ekleyin; düzenleme modunda otomatik görünür.

`yaw`: derece, 0 = panorama merkezi, pozitif = sağ. `pitch`: derece, 0 = ufuk, pozitif = yukarı.
İsteğe bağlı `view: { yaw, pitch, fov }` alanı, işarete tıklanınca kameranın gideceği açıyı belirler.

## Ayarlar

`src/data/site.ts`: başlık, açıklama, başlangıç açısı (`initialView`), kendiliğinden dönme hızı (`autoRotate`).

## Panorama değiştirme

Yeni 2:1 equirectangular JPEG'i `source-panos/` klasörüne koyup `npm run pano` çalıştırın.
Betik 1024/2048/4096/8192 px WebP katmanları, bulanık ön izleme ve `manifest.json` üretir.
Görüntüleyici önce küçük ön izlemeyi, sonra orta ve yüksek çözünürlüğü sırayla yumuşak geçişle yükler.
`toktx` (KTX-Software) kuruluysa GPU sıkıştırmalı `.ktx2` kopyalar da üretilir ve otomatik tercih edilir.

## Yayınlama

Derleme klasörden bağımsızdır: `dist/` içeriğini kök dizine, `/360/` ya da `/360-test/` gibi
herhangi bir alt klasöre koyabilirsiniz; tüm yollar `index.html`'e göre çözülür, yeniden derleme gerekmez.

`npm run build` sonrası `dist/` içeriğini hostinge yükleyin. `.htaccess` MIME türlerini, önbelleği ve
sunucu taraflı sıkıştırmayı ayarlar. Önceden sıkıştırılmış `.br/.gz` kopyalar üretilmez (bazı hostlar
bunları yanlış MIME türüyle sunup modül betiklerini bozuyor); isterseniz `npm run build:compressed`. Büyük dosyaları CDN'e taşımak için `.env` içinde `PUBLIC_ASSET_BASE` tanımlayın
(ör. Cloudflare R2 adresi) ve `public/assets` klasörünü aynı yollarla oraya yükleyin.

## URL parametreleri

- `?edit`  işaret düzenleme modu
- `?debug` performans göstergesi (fps, piksel oranı, draw call, aktif doku katmanı)

## Klasör yapısı

```
public/assets/pano/kristal-kule/   manifest.json, hotspots.json, 1024..8192.webp, og.jpg
scripts/build-pano.py              panorama katman üretimi
src/data/site.ts                   ayarlar
src/scripts/main.ts                başlangıç + arayüz
src/scripts/editor.ts              ?edit modu
src/scripts/viewer/                PanoramaViewer, PanoSphere, Hotspots, Gyro
src/scripts/three/                 RendererManager, CameraController, TextureManager, SceneManager, AssetLoader
src/scripts/core/                  render döngüsü, cihaz kalite profili, performans izleme
```
