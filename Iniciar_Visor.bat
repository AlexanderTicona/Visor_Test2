@echo off
echo Iniciando Servidor Local para Visor TiQAL...
echo Por favor, no cierres esta ventana.
echo.
echo Presiona CTRL+C para detener el servidor.
echo.
cmd /c "npx http-server -p 8080"
pause
