@echo off
rem Klik dua kali untuk memulai ChatBot Prema dan membuka dashboard.
rem Klik pertama memasang semuanya; setelah itu bot menyala sendiri setiap PC hidup.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\launcher.ps1" -Action mulai
