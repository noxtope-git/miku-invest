$env:DOCKER = 'C:\Program Files\Docker\Docker\resources\bin'
Start-Sleep -Seconds 45
Set-Location 'C:\Users\USUARIO\Desktop\gamma4'
& $env:DOCKER\docker.exe compose up -d
