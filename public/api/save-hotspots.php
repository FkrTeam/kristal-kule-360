<?php
/**
 * Kristal Kule 360 - hotspots.json kaydetme ucu (canlı sunucu için).
 *
 * Düzenleme modundaki "Kaydet" düğmesi buraya POST eder ve
 *   ../assets/pano/<sahne>/hotspots.json
 * dosyasını günceller. Yalnızca aşağıdaki şifreyi bilen kaydedebilir.
 *
 * KURULUM
 *   1. PASSWORD değerini değiştirin (uzun ve tahmin edilemez bir şey).
 *   2. Sunucuda assets/pano/<sahne>/ klasörünün PHP tarafından yazılabilir olduğundan
 *      emin olun (genelde klasör izni 755 ve dosya 644 yeterlidir; değilse 775 / 664).
 */

const PASSWORD = '2Q7QWdi2fq6*';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

/** mbstring olmayan sunucularda da çalışsın. */
function cut(string $s, int $max): string {
    return function_exists('mb_substr') ? mb_substr($s, 0, $max) : substr($s, 0, $max);
}

function fail(int $code, string $error): void {
    http_response_code($code);
    echo json_encode(['ok' => false, 'error' => $error]);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') fail(405, 'POST bekleniyor');
if (PASSWORD === 'degistir-beni') fail(500, 'save-hotspots.php içindeki PASSWORD henüz değiştirilmemiş');

$raw = file_get_contents('php://input');
if ($raw === false || strlen($raw) > 512 * 1024) fail(400, 'Gövde okunamadı veya çok büyük');

$payload = json_decode($raw, true);
if (!is_array($payload)) fail(400, 'Geçersiz JSON');

// Şifre: X-KK360-Key başlığı ya da gövdedeki {"key": ...} (bazı sunucular özel başlıkları düşürür).
$key = (string)($_SERVER['HTTP_X_KK360_KEY'] ?? '');
if ($key === '' && isset($payload['key'])) $key = (string)$payload['key'];
if ($key === '') fail(401, 'Şifre sunucuya ulaşmadı');
if (!hash_equals(PASSWORD, $key)) fail(401, 'Şifre hatalı (save-hotspots.php içindeki PASSWORD ile aynı olmalı)');

// Gövde ya doğrudan işaret dizisi ya da {"key": ..., "hotspots": [...]}.
$data = isset($payload['hotspots']) ? $payload['hotspots'] : $payload;
if (!is_array($data) || (isset($payload['hotspots']) && !is_array($payload['hotspots']))) fail(400, 'İşaret listesi bekleniyor');

$scene = preg_replace('/[^a-z0-9_-]/i', '', $_GET['scene'] ?? '');
if ($scene === '') fail(400, 'scene eksik');

$dir = realpath(__DIR__ . '/../assets/pano/' . $scene);
if ($dir === false || !is_dir($dir)) fail(404, 'Sahne klasörü yok: ' . $scene);

$clean = [];
foreach ($data as $h) {
    if (!is_array($h) || !isset($h['id'], $h['label'], $h['yaw'], $h['pitch'])) fail(400, 'Eksik alan');
    $item = [
        'id'    => preg_replace('/[^a-z0-9_-]/i', '', (string)$h['id']),
        'yaw'   => round((float)$h['yaw'], 2),
        'pitch' => round((float)$h['pitch'], 2),
        'label' => cut(strip_tags((string)$h['label']), 120),
    ];
    if (!empty($h['icon'])) $item['icon'] = preg_replace('/[^a-z0-9_-]/i', '', (string)$h['icon']);
    if (!empty($h['color'])) $item['color'] = substr(preg_replace('/[^#a-z0-9(),.%\s-]/i', '', (string)$h['color']), 0, 32);
    if (!empty($h['text'])) $item['text'] = cut(strip_tags((string)$h['text']), 2000);
    if (isset($h['view']) && is_array($h['view'])) {
        $v = [];
        foreach (['yaw', 'pitch', 'fov'] as $k) if (isset($h['view'][$k])) $v[$k] = round((float)$h['view'][$k], 2);
        if ($v) $item['view'] = $v;
    }
    $clean[] = $item;
}

$json = json_encode($clean, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
$path = $dir . '/hotspots.json';
$tmp  = $path . '.tmp';
if (file_put_contents($tmp, $json . "\n", LOCK_EX) === false || !rename($tmp, $path)) {
    @unlink($tmp);
    fail(500, 'Dosya yazılamadı; klasör izinlerini kontrol edin');
}

echo json_encode(['ok' => true, 'count' => count($clean)]);
