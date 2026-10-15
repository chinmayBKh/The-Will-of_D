@echo off
title The Will of D
if not exist node_modules call npm run setup
if not exist the-will-of-d\node_modules call npm run setup
if not exist the-will-of-d-client\node_modules call npm run setup
start "" http://localhost:5173
npm start
