# Juicy Booster v0.4.0

**xobe development**

Juicy Booster adalah optimizer sistem berbasis Node.js untuk Windows. Aplikasinya berjalan sebagai server lokal kecil dan menampilkan dasbor web (HTML + CSS + JS, tema monochrome hitam-putih) di browser. Proyek ini **zero dependency**: seluruh kode hanya memakai modul bawaan Node.js, tanpa paket npm di runtime.

Fungsi utamanya: memantau hardware secara live, membersihkan file sampah, mengelola proses latar belakang, dan mengganti mode daya Windows, semuanya dari satu halaman.

> Setiap aksi dijalankan secara nyata dan dilaporkan apa adanya (berhasil, gagal, atau dilewati). Aplikasi tidak memalsukan angka "RAM dibebaskan" atau "ruang dihemat". Kalau suatu aksi butuh hak Administrator dan tidak tersedia, hasilnya dicatat sebagai gagal atau dilewati.

---

## Unduh dan Jalankan (Pengguna Biasa)

Tidak perlu install Node.js, Git, atau compile apa pun. Aplikasi sudah dikompilasi otomatis menjadi satu file `.exe` (Node.js Single Executable Application) lewat GitHub Actions.

1. Buka halaman **Releases** di repositori ini.
2. Unduh `juicy-booster.exe` dari rilis terbaru.
3. Letakkan di folder mana saja, lalu klik dua kali.
4. Jendela konsol akan terbuka dan browser otomatis menuju `http://localhost:3003`.
5. Untuk berhenti, **tutup jendela konsol** (atau tekan `Ctrl+C`).

Untuk fitur yang butuh izin lebih (ganti power plan, bersihkan Recycle Bin, baca suhu CPU, trim RAM semua proses), klik kanan `juicy-booster.exe` lalu pilih **Run as administrator**. Tab **Diagnostik** menampilkan apakah aplikasi sedang berjalan dengan hak admin.

> Windows SmartScreen atau antivirus bisa memperingatkan karena exe ini tidak ditandatangani digital (unsigned). Itu umum untuk aplikasi open source buatan sendiri. Kodenya terbuka dan bisa kamu periksa sebelum menjalankan.

---

## Fitur

Dasbor punya tujuh tab: **Proses Latar**, **Bersihkan Junk**, **Mode Performa**, **Startup**, **Sistem**, **Diagnostik**, dan **Riwayat**.

### 1. Tombol Boost (optimasi penuh)

Satu klik menjalankan enam tahap berurutan, dan tiap tahap melaporkan statusnya sendiri:

| Tahap | Yang sebenarnya dilakukan |
|---|---|
| Bersihkan file temp | Menghapus isi folder temp yang lebih tua dari 1 jam |
| Bersihkan cache browser | Mengosongkan cache Chrome, Edge, dan Firefox |
| Flush DNS cache | `ipconfig /flushdns` |
| Bebaskan RAM | Memanggil `EmptyWorkingSet` (Psapi) ke semua proses yang bisa diakses, sehingga working set dipindah ke pagefile |
| Optimasi network stack | Hanya **membaca** status TCP (`netsh int tcp show global`). Tuning agresif sengaja dilewati karena butuh admin dan reboot |
| Priority boost | Menaikkan prioritas proses ke `AboveNormal` (proses `High`/`RealTime` tidak disentuh, proses terproteksi dilewati otomatis oleh Windows) |

Tombol **Reset ke Default** mengembalikan power plan ke Seimbang dan mereset status di dalam aplikasi. Lihat bagian [Batasan](#batasan-yang-perlu-diketahui) untuk apa saja yang *tidak* bisa dibatalkan.

### 2. Bersihkan Junk (per kategori)

| Kategori | Perilaku |
|---|---|
| `temp` | Folder temp pengguna. Hanya file yang lebih tua dari **1 jam**. File milik Juicy sendiri (`juicy*`) dilewati |
| `cache` | Cache Chrome, Edge, dan Firefox (lokasi cache di `AppData\Local`, bukan profil pengguna) |
| `recycle` | `Clear-RecycleBin` |
| `logs` | Di Windows **dilewati** (lihat Batasan). Di Linux memakai `journalctl --vacuum-time=1d` |
| `dns` | Flush DNS cache |
| `thumbs` | File `thumbcache*` milik Windows Explorer |

Mekanisme penghapusan (`safeRemove`) dirancang defensif:

- **Symlink**: hanya link-nya yang dihapus, target aslinya tidak ikut terhapus.
- **Cek usia file** (khusus temp): file yang baru dimodifikasi tidak dihapus.
- File yang terkunci atau sedang dipakai dilewati dan dilaporkan, bukan dipaksa.
- Folder dihapus isi-per-isi, jadi satu file yang gagal tidak menggagalkan seluruh operasi.

### 3. Process Manager

Menampilkan daftar proses yang berjalan dan memungkinkan menghentikannya.

- **Validasi PID ketat**: hanya integer positif 1 sampai 8 digit yang diterima. Ini mencegah shell injection.
- **Kill hanya lewat PID**: parameter `name` dari request diabaikan.
- **Tanpa shell**: perintah dijalankan sebagai argumen array (`taskkill /PID <n> /F /T`), bukan string yang digabung ke shell.
- **Proteksi proses kritikal**: nama proses dicek ulang dari sistem (bukan dari input pengguna) sebelum kill. Daftar terproteksi mencakup `svchost`, `lsass`, `explorer`, `csrss`, `winlogon`, `wininit`, `services`, `dwm`, `smss`, `msmpeng` (Windows Defender), `spoolsv`, dan sejenisnya.

### 4. Monitor Sistem Real-Time

Dasbor memperbarui metrik setiap **2 detik**:

- CPU: persentase pemakaian, model, jumlah core, dan suhu (lewat `wmic`/ACPI, **best effort**, sering butuh admin atau kosong di beberapa laptop)
- RAM dan swap
- Kapasitas disk
- Lalu lintas jaringan
- GPU: lewat `nvidia-smi` bila ada kartu NVIDIA. Tanpa `nvidia-smi`, nama GPU dibaca dari Windows tetapi pemakaiannya ditampilkan **N/A**, bukan angka karangan
- Uptime dan info OS

### 5. Mode Performa

| Mode | Windows | Linux |
|---|---|---|
| Seimbang | `powercfg /setactive SCHEME_BALANCED` | Default OS |
| Performa Tinggi | `SCHEME_MIN` (High Performance) | CPU governor `performance` |
| Game Mode | Mengaktifkan flag registry `AutoGameModeEnabled` di `HKCU\Software\Microsoft\GameBar` | Tidak ada tindakan khusus |
| Hemat Baterai | `SCHEME_MAX` (Power Saver) | CPU governor `powersave` |

### 6. Tab Informasi

- **Startup**: daftar item autostart (registry `Run` milik HKCU/HKLM dan folder Startup). Tab ini hanya **membaca**, tidak mengubah apa pun.
- **Sistem**: info OS, produsen dan model perangkat, daftar drive, baterai, antarmuka jaringan, dan 40 service yang sedang berjalan (read-only).
- **Diagnostik**: pengecekan akses shell, hak admin, dan folder temp yang bisa ditulis.
- **Riwayat**: log semua aksi (boost, clean, ganti mode, reset) selama sesi berjalan.

---

## Keamanan

Server ini bisa menghapus file dan menghentikan proses, jadi akses ke API-nya dibatasi berlapis:

- **Loopback only**: server di-bind ke `127.0.0.1`. Selain itu ada pengecekan `remoteAddress` kedua yang menolak koneksi dari alamat non-lokal (defense in depth).
- **Token per sesi (anti-CSRF)**: token acak 48 karakter hex dibuat setiap aplikasi dijalankan dan disuntikkan ke `index.html`. Semua request `POST` (kill, boost, clean, mode, reset, dsb.) wajib membawa header `X-Juicy-Token` yang cocok. Perbandingan token memakai `crypto.timingSafeEqual`.
- **CORS same-origin**: tidak ada wildcard `*`.
- **Anti path traversal** pada file statis.
- **Body request dibatasi** maksimal ±1 MB.

Soal data pribadi: aplikasi hanya menyentuh folder temp, folder cache browser, Recycle Bin, dan cache thumbnail. Aplikasi tidak membaca dokumen, foto, atau profil browser (password, bookmark) milikmu, dan **tidak mengirim data apa pun ke internet**: semua komunikasi hanya terjadi antara browser dan `127.0.0.1`.

---

## Batasan yang Perlu Diketahui

Biar tidak ada kejutan:

- **Log Windows tidak dibersihkan.** Kategori `logs` di Windows sengaja dilewati (menghapus Event Log dianggap terlalu agresif dan butuh keputusan manual). Kategori ini baru benar-benar bekerja di Linux.
- **Reset tidak membatalkan priority boost.** Prioritas proses yang sudah dinaikkan ke `AboveNormal` kembali normal sendiri setelah proses direstart atau PC dihidupkan ulang. Reset juga tidak bisa menjalankan ulang proses yang sudah di-kill.
- **Trim RAM bersifat sementara.** Windows akan memuat ulang halaman memori yang dibutuhkan, jadi efeknya terasa paling jelas tepat setelah dijalankan. Ini bukan "tambahan RAM" permanen.
- **Cache browser tidak dicek usianya.** Semua isi folder cache dihapus. Browser akan membangunnya lagi, jadi situs bisa terasa sedikit lebih lambat dibuka pertama kali setelah dibersihkan.
- **Game Mode hanya mengaktifkan flag Windows Game Mode**, bukan tuning khusus yang dibuat aplikasi ini.
- **Port tetap `3003`.** Kalau port itu sedang dipakai aplikasi lain, Juicy Booster tidak bisa jalan.
- **Platform utama adalah Windows 10/11.** Kode punya fallback untuk Linux dan macOS, tapi tidak semua fitur tersedia di sana dan belum menjadi target resmi.

---

## Untuk Developer

Syarat: **Node.js 20.12 atau lebih baru** (dibutuhkan modul `node:sea`).

```bash
git clone https://github.com/gagadeb11116677/juicy-booster.git
cd juicy-booster
node index.js
```

Dasbor terbuka di `http://localhost:3003`. Variabel lingkungan `JUICY_NO_OPEN=1` mematikan pembukaan browser otomatis.

### Struktur proyek

```
index.js            Server HTTP, routing API, token auth, file statis
lib/optimizer.js    Boost, clean junk, mode performa, reset, riwayat
lib/processes.js    Daftar proses, validasi PID, proteksi, kill
lib/sysinfo.js      Metrik real-time (CPU, RAM, disk, jaringan, GPU, suhu)
lib/system.js       Info sistem, drive, startup, service, baterai
public/             Dasbor (index.html, style.css, app.js, logo.png)
sea-config.json     Konfigurasi Node SEA (daftar asset yang dibundel ke exe)
.github/workflows/  Build otomatis dan publish ke Releases
start.bat           Launcher Windows untuk menjalankan dari source
```

### Endpoint API

| Method | Path | Token | Fungsi |
|---|---|---|---|
| GET | `/api/health` | tidak | Status dan versi |
| GET | `/api/metrics` | tidak | Metrik real-time |
| GET | `/api/state`, `/api/history` | tidak | State aplikasi dan riwayat |
| GET | `/api/processes` | tidak | Daftar proses |
| GET | `/api/system`, `/drives`, `/startup`, `/services`, `/battery`, `/network`, `/diagnostics` | tidak | Informasi sistem (read-only) |
| POST | `/api/processes/kill` | **ya** | Hentikan proses (body: `{pid}`) |
| POST | `/api/boost` | **ya** | Jalankan boost penuh |
| POST | `/api/clean` | **ya** | Bersihkan kategori (body: `{category}`) |
| POST | `/api/mode` | **ya** | Ganti mode (`balanced`, `performance`, `game`, `saver`) |
| POST | `/api/reset` | **ya** | Reset ke default |
| POST | `/api/download-folder` | **ya** | Simpan preferensi folder download |

### Build `.exe` sendiri

Exe dibuat dengan Node SEA. SEA hanya mendukung CommonJS, sedangkan proyek ini memakai ES Modules, jadi kode di-bundle dulu dengan esbuild:

```bash
npx esbuild index.js --bundle --platform=node --format=cjs --define:import.meta.url='"file:///sea"' --outfile=dist/bundle.cjs
node --experimental-sea-config sea-config.json
node -e "require('fs').copyFileSync(process.execPath, 'juicy-booster.exe')"
npx postject juicy-booster.exe NODE_SEA_BLOB sea-prep.blob --sentinel-fuse NODE_SEA_FUSE_fce680d4447228a7dcca36ce7d02d789
```

Di dalam exe, file `public/` dibaca dari asset yang tertanam (`sea.getAsset`), bukan dari disk.

### Rilis otomatis

Push tag berawalan `v` untuk memicu GitHub Actions. Workflow akan membangun exe di `windows-latest` dan mengunggahnya ke halaman Releases:

```bash
git tag v0.4
git push origin v0.4
```

Workflow juga bisa dijalankan manual lewat tab **Actions** (tombol *Run workflow*), tetapi langkah upload ke Releases hanya jalan jika dipicu oleh tag.

---

## Lisensi

Dikembangkan oleh **xobe development** dan dirilis di bawah **Lisensi MIT**: bebas dipakai, disalin, dimodifikasi, dan didistribusikan ulang untuk keperluan pribadi maupun komersial.