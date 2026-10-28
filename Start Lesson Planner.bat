@echo off
title Lesson Planner
cd /d "%~dp0"
echo Starting Lesson Planner... your browser will open in a moment.
echo Keep this window open while you use the planner. Close it when you're done.
node server.js
pause
