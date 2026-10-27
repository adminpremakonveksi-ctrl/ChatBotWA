@echo off
rem Klik dua kali untuk mengambil versi terbaru dari GitHub. Bot dihentikan dan tidak
rem dinyalakan lagi: setelah selesai, tutup jendela ini lalu klik Mulai ChatBot Prema.
rem Tautan WhatsApp, riwayat chat (data) dan gambar unggahan (media) tidak tersentuh.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\launcher.ps1" -Action update
