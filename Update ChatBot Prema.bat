@echo off
rem Klik dua kali untuk mengambil versi terbaru dari GitHub lalu menyalakan ulang bot.
rem Tautan WhatsApp, riwayat chat (data) dan gambar unggahan (media) tidak tersentuh.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\launcher.ps1" -Action update
