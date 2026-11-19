@echo off
python -m pip install frida frida-tools --disable-pip-version-check > %TEMP%\pip.log 2>&1
echo pip_exit=%ERRORLEVEL%>> %TEMP%\pip.log
python -c "import frida;print(\