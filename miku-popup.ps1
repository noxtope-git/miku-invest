# miku-popup.ps1 - Aviso al iniciar sesion: pantalla de Miku Invest 24/7.
# Muestra una ventana de Windows con la imagen de Hatsune Miku (dando like,
# de Pinterest) y un enlace a la web que corre 24/7 en la nube.
# Se lanza desde "Inicio" con -WindowStyle Hidden (sin ventana de consola).

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$URL = "http://146.181.59.82:4000"
$imgPath = Join-Path $PSScriptRoot "miku-like.jpg"
$AUTO_CLOSE_SEC = 45

# ---- Controles ----
$form = New-Object System.Windows.Forms.Form
$form.Text = "Miku Invest ~ 24/7"
$form.ClientSize = New-Object System.Drawing.Size(520, 700)
$form.StartPosition = "CenterScreen"
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.BackColor = [System.Drawing.Color]::FromArgb(18, 26, 32)

# Imagen de Miku
$pb = New-Object System.Windows.Forms.PictureBox
$pb.SizeMode = "Zoom"
$pb.BackColor = [System.Drawing.Color]::FromArgb(18, 26, 32)
$pb.Location = New-Object System.Drawing.Point(20, 16)
$pb.Size = New-Object System.Drawing.Size(480, 360)
if (Test-Path $imgPath) {
  $pb.Image = [System.Drawing.Image]::FromFile($imgPath)
}
$form.Controls.Add($pb)

# Titulo
$lblTitle = New-Object System.Windows.Forms.Label
$lblTitle.Text = "Miku esta en linea todo el dia 24/7"
$lblTitle.Font = New-Object System.Drawing.Font("Segoe UI", 16, [System.Drawing.FontStyle]::Bold)
$lblTitle.ForeColor = [System.Drawing.Color]::FromArgb(120, 224, 216)
$lblTitle.BackColor = [System.Drawing.Color]::FromArgb(18, 26, 32)
$lblTitle.TextAlign = "MiddleCenter"
$lblTitle.Location = New-Object System.Drawing.Point(20, 384)
$lblTitle.Size = New-Object System.Drawing.Size(480, 40)
$form.Controls.Add($lblTitle)

$lblSub = New-Object System.Windows.Forms.Label
$lblSub.Text = "Tu inversion corre en la nube sin apagarse.Panel directamente aqui:"
$lblSub.Font = New-Object System.Drawing.Font("Segoe UI", 11)
$lblSub.ForeColor = [System.Drawing.Color]::FromArgb(200, 210, 215)
$lblSub.BackColor = [System.Drawing.Color]::FromArgb(18, 26, 32)
$lblSub.TextAlign = "MiddleCenter"
$lblSub.Location = New-Object System.Drawing.Point(20, 428)
$lblSub.Size = New-Object System.Drawing.Size(480, 30)
$form.Controls.Add($lblSub)

# Enlace clickeable
$link = New-Object System.Windows.Forms.LinkLabel
$link.Text = $url
$link.Font = New-Object System.Drawing.Font("Consolas", 12, [System.Drawing.FontStyle]::Bold)
$link.LinkColor = [System.Drawing.Color]::Cyan
$link.ActiveLinkColor = [System.Drawing.Color]::LightCyan
$link.BackColor = [System.Drawing.Color]::FromArgb(18, 26, 32)
$link.TextAlign = "MiddleCenter"
$link.Location = New-Object System.Drawing.Point(20, 462)
$link.Size = New-Object System.Drawing.Size(480, 30)
$link.LinkArea = New-Object System.Windows.Forms.LinkArea(0, $url.Length)
$link.Add_LinkClicked({ param($s, $e) [System.Diagnostics.Process]::Start($url) })
$form.Controls.Add($link)

# Boton principal: abrir
$btnOpen = New-Object System.Windows.Forms.Button
$btnOpen.Text = "Abrir pagina 24/7"
$btnOpen.Font = New-Object System.Drawing.Font("Segoe UI", 11, [System.Drawing.FontStyle]::Bold)
$btnOpen.FlatStyle = "Flat"
$btnOpen.BackColor = [System.Drawing.Color]::FromArgb(31, 165, 160)
$btnOpen.ForeColor = [System.Drawing.Color]::White
$btnOpen.Size = New-Object System.Drawing.Size(220, 44)
$btnOpen.Location = New-Object System.Drawing.Point(40, 520)
$btnOpen.Add_Click({ [System.Diagnostics.Process]::Start($url); $form.Close() })
$form.Controls.Add($btnOpen)

# Boton cerrar
$btnClose = New-Object System.Windows.Forms.Button
$btnClose.Text = "Cerrar"
$btnClose.Font = New-Object System.Drawing.Font("Segoe UI", 11)
$btnClose.Flat = "Flat"
$btnClose.BackColor = [System.Drawing.Color]::FromArgb(50, 60, 68)
$btnClose.ForeColor = [System.Drawing.Color]::White
$btnClose.Size = New-Object System.Drawing.Size(120, 44)
$btnClose.Location = New-Object System.Drawing.Point(270, 520)
$btnClose.Add_Click({ $form.Close() })
$form.Controls.Add($btnClose)

# Pie con fuente
$lblFoot = New-Object System.Windows.Forms.Label
$lblFoot.Text = "Imagen: Hatsune Miku (Pinterest)"
$lblFoot.Font = New-Object System.Drawing.Font("Segoe UI", 9)
$lblFoot.ForeColor = [System.Drawing.Color]::FromArgb(120, 140, 150)
$lblFoot.BackColor = [System.Drawing.Color]::FromArgb(18, 26, 32)
$lblFoot.TextAlign = "MiddleCenter"
$lblFoot.Location = New-Object System.Drawing.Point(20, 600)
$lblFoot.Size = New-Object System.Drawing.Size(480, 22)
$form.Controls.Add($lblFoot)

# Countdown y cierre automatico
$lblCount = New-Object System.Windows.Forms.Label
$lblCount.Text = "Se cerrara en $AUTO_CLOSE_SEC s"
$lblCount.Font = New-Object System.Drawing.Font("Segoe UI", 9)
$lblCount.ForeColor = [System.Drawing.Color]::FromArgb(140, 160, 170)
$lblCount.BackColor = [System.Drawing.Color]::FromArgb(18, 26, 32)
$lblCount.TextAlign = "MiddleCenter"
$lblCount.Location = New-Object System.Drawing.Point(20, 624)
$lblCount.Size = New-Object System.Drawing.Size(480, 22)
$form.Controls.Add($lblCount)

$remaining = $AUTO_CLOSE_SEC
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 1000
$timer.Add_Tick({
  $remaining--
  if ($remaining -le 0) { $timer.Stop(); $form.Close() }
  else { $lblCount.Text = "Se cerrara en $remaining s" }
})

$form.Add_Shown({
  $form.Activate()
  $timer.Start()
})
[void]$form.ShowDialog()
$timer.Stop()