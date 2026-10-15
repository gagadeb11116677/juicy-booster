
# Juicy Booster (v0.4.0)

Juicy Booster adalah aplikasi berbasis Node.js yang dirancang untuk melakukan optimasi sistem, manajemen proses latar belakang, dan pembersihan sampah sistem guna meningkatkan performa PC Windows Anda.

## Fitur Utama

- **System Optimizer:** Mengoptimalkan alokasi RAM, flush DNS, dan prioritas proses dalam satu klik BOOST.
- **Process Manager:** Memantau dan mematikan aplikasi latar belakang yang tidak berguna. PID tervalidasi, anti shell injection.
- **Junk Cleaner:** Membersihkan file temp, cache browser, recycle bin, log, cache DNS, dan thumbnail.
- **Performance Mode:** Seimbang, Performa Tinggi, Game Mode, Hemat Baterai.
- **Sysinfo Monitor:** Menampilkan informasi hardware secara real-time melalui Web Dashboard (CPU, RAM, disk, GPU, suhu, jaringan).
- **Startup Manager:** Melihat program yang berjalan otomatis saat Windows boot.
- **Diagnostics:** Cek kemampuan tiap subsistem dengan fallback aman.
- **Reset to Default:** Kembalikan semua perubahan ke kondisi awal. Aman untuk user awam.
- **History Log:** Log semua aksi optimasi yang sudah dilakukan.

## Download & Install (Untuk Pengguna)

Anda tidak perlu menginstal Node.js atau melakukan compile sendiri. File `.exe` siap pakai sudah disediakan:

1. Pergi ke halaman **[Releases](https://github.com/gagadeb11116677/juicy-booster/releases)**.
2. Unduh file `juicy-booster.exe` versi terbaru.
3. Pindahkan file tersebut ke folder yang Anda inginkan.
4. Klik dua kali pada `juicy-booster.exe` untuk menjalankan.
5. Browser akan terbuka otomatis ke dashboard Juicy Booster.

## Menjalankan Mode Development (Untuk Developer)

Jika Anda ingin mengubah kode atau mengembangkan aplikasi ini:

1. Clone repository ini:
   ```bash
   git clone https://github.com/gagadeb11116677/juicy-booster.git
   ```
2. Masuk ke folder projek:
   ```bash
   cd juicy-booster
   ```
3. Jalankan aplikasi (butuh [Node.js](https://nodejs.org) terinstall):
   ```bash
   node index.js
   ```
   atau pakai Bun:
   ```bash
   bun run index.js
   ```
4. Buka `http://localhost:3003` di browser.

## Build ke EXE

### Pakai pkg (disarankan)
```bash
npm install -g pkg
pkg . --targets node20-win-x64 --output juicy-booster.exe
```

### Pakai Node SEA (Node 22+)
```bash
node --experimental-sea-config sea-config.json
copy node.exe juicy-booster.exe
npx postject juicy-booster.exe NODE_SEA_BLOB juicy-sea-prep.blob --sentinel NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
```

## Keamanan

- Server bind ke `127.0.0.1` (loopback only), tidak terekspos ke jaringan.
- Semua aksi POST butuh token auth per-session (anti CSRF).
- Kill proses hanya menerima PID integer tervalidasi (anti shell injection).
- Proses sistem dilindungi (System, svchost, lsass, explorer, dll).
- `cleanTemp` memeriksa usia file dan menangani symlink dengan aman.
- GPU menampilkan N/A jika tidak ada sumber real, tidak ada angka palsu.
- Tidak menyentuh file user.

## Struktur Folder

```
juicy-booster/
  index.js              Server HTTP (port 3003, loopback)
  start.bat             Launcher Windows
  sea-config.json       Config build exe
  package.json
  README.md
  lib/
    sysinfo.js          Baca metrik sistem (CPU, RAM, GPU, dll)
    processes.js        List & kill proses (aman)
    optimizer.js        Boost, clean, mode, reset, history
    system.js           Startup, services, battery, drives
  public/
    index.html          UI
    style.css           Styling (black & white)
    app.js              Frontend logic
    logo.png            Logo
```

## Version History

### v0.4.0 (current)
- UI redesign black & white (hapus gradient, monochrome)
- README sesuai format GitHub
- Update label versi

### v0.3.0
- UI lebih simple dan bersih
- README lengkap dengan version history & credits

### v0.2.0
- Keamanan kritis: bind 127.0.0.1, token auth, CORS same-origin
- GPU: hapus Math.random, tampilkan N/A tanpa sumber real
- Kill process: validasi PID integer, anti shell injection
- BOOST real: setiap tahap laporkan status nyata
- cleanTemp safe: cek usia file, handle symlink

### v0.1.0
- Rilis awal
- Boost, dashboard, proses, junk cleaner, mode, startup, sistem, reset, riwayat

## Credits

- **Developer:** xobe development
- **Repository:** https://github.com/gagadeb11116677/juicy-booster
- **Teknologi:** Node.js, HTML, CSS, vanilla JavaScript
- **Dependencies:** Zero (Node.js built-in modules only)
- **Fonts:** Inter & JetBrains Mono (Google Fonts)

## License

MIT License

---

Juicy Booster v0.4 — by xobe development
=======
# juicy-booster
>>>>>>> 42f848acfb09e7da5e25041a073d1a77ef49a151
