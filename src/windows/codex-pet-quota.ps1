Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class NativeMouse {
  [DllImport("kernel32.dll")]
  public static extern IntPtr GetConsoleWindow();
  [DllImport("user32.dll")]
  public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")]
  public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")]
  public static extern bool GetCursorPos(out POINT lpPoint);
  [DllImport("user32.dll")]
  public static extern short GetAsyncKeyState(int vKey);
  public struct POINT { public int X; public int Y; }
}
"@

$ErrorActionPreference = "SilentlyContinue"
[NativeMouse]::SetProcessDPIAware() | Out-Null
$devMode = $args -contains "--dev"
$showOnStart = $args -contains "--show"
if (-not $devMode) {
  $console = [NativeMouse]::GetConsoleWindow()
  if ($console -ne [IntPtr]::Zero) { [NativeMouse]::ShowWindow($console, 0) | Out-Null }
}

$codexHome = Join-Path $env:USERPROFILE ".codex"
$statePath = Join-Path $codexHome ".codex-global-state.json"
$authPath = Join-Path $codexHome "auth.json"
$appHome = Join-Path $env:USERPROFILE ".codex-pet-quota"
$pidPath = Join-Path $appHome "app.pid"
New-Item -ItemType Directory -Force -Path $appHome | Out-Null
[IO.File]::WriteAllText($pidPath, [Diagnostics.Process]::GetCurrentProcess().Id.ToString())

$script:quota = $null
$script:lastQuotaFetch = [DateTime]::MinValue
$script:isHovering = $false
$script:lastHoverShow = [DateTime]::MinValue
$script:lastWarningKey = $null
$script:lastWarningAt = [DateTime]::MinValue
$script:wasDown = $false
$script:downX = 0
$script:downY = 0
$script:maxMove = 0

function Get-PetBounds {
  try {
    $state = Get-Content $statePath -Raw -Encoding UTF8 | ConvertFrom-Json
    $atom = $state.'electron-persisted-atom-state'
    $overlay = $atom.'electron-avatar-overlay-bounds'
    if (-not $overlay) { $overlay = $state.'electron-avatar-overlay-bounds' }
    if (-not $overlay -or -not $overlay.mascot) { return $null }

    [pscustomobject]@{
      X = [int](($overlay.x -as [double]) + ($overlay.mascot.left -as [double]))
      Y = [int](($overlay.y -as [double]) + ($overlay.mascot.top -as [double]))
      Width = [int]$overlay.mascot.width
      Height = [int]$overlay.mascot.height
    }
  } catch {
    $null
  }
}

function Test-PointInBounds($point, $bounds) {
  if (-not $point -or -not $bounds) { return $false }
  return $point.X -ge $bounds.X -and $point.X -le ($bounds.X + $bounds.Width) -and $point.Y -ge $bounds.Y -and $point.Y -le ($bounds.Y + $bounds.Height)
}

function Convert-ResetTime($value) {
  if (-not $value) { return "?" }
  try {
    $seconds = [int64]$value
    $dt = [DateTimeOffset]::FromUnixTimeSeconds($seconds).ToLocalTime()
    return "{0}.{1} {2:00}:{3:00}" -f $dt.Month, $dt.Day, $dt.Hour, $dt.Minute
  } catch {
    return "?"
  }
}

function Get-RemainingText($window) {
  if (-not $window) { return "?" }
  if ($null -ne $window.remaining_percent) { return "$([math]::Round([double]$window.remaining_percent))%" }
  if ($null -ne $window.used_percent) { return "$([math]::Max(0, [math]::Round(100 - [double]$window.used_percent)))%" }
  return "?"
}

function Fetch-Quota {
  try {
    $auth = Get-Content $authPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $token = $auth.tokens.access_token
    if (-not $token) { throw "No access token" }
    $headers = @{
      Authorization = "Bearer $token"
      Accept = "application/json"
      "User-Agent" = "codex-pet-quota"
    }
    $usage = Invoke-RestMethod -UseBasicParsing -Uri "https://chatgpt.com/backend-api/wham/usage" -Headers $headers -Method Get -TimeoutSec 20
    $primary = $usage.rate_limit.primary_window
    $secondary = $usage.rate_limit.secondary_window
    $script:quota = [pscustomobject]@{
      Five = Get-RemainingText $primary
      FiveReset = Convert-ResetTime $primary.reset_at
      Week = Get-RemainingText $secondary
      WeekReset = Convert-ResetTime $secondary.reset_at
    }
    $script:lastQuotaFetch = [DateTime]::Now
    return $script:quota
  } catch {
    if ($script:quota) { return $script:quota }
    return [pscustomobject]@{ Five = "?"; FiveReset = "?"; Week = "?"; WeekReset = "?" }
  }
}

function Get-Percent($text) {
  if ($text -match "(\d+)") { return [int]$matches[1] }
  return $null
}

function Get-WarningKey($quota) {
  $parts = @()
  foreach ($pair in @(@("5h", (Get-Percent $quota.Five)), @("week", (Get-Percent $quota.Week)))) {
    $name = $pair[0]
    $value = $pair[1]
    if ($null -eq $value) { continue }
    if ($value -le 5) { $parts += "$name`:5" }
    elseif ($value -le 10) { $parts += "$name`:10" }
    elseif ($value -le 20) { $parts += "$name`:20" }
  }
  if ($parts.Count -eq 0) { return $null }
  return ($parts -join "|")
}

function Ensure-Quota {
  if (-not $script:quota -or ([DateTime]::Now - $script:lastQuotaFetch).TotalSeconds -gt 60) {
    return Fetch-Quota
  }
  return $script:quota
}

$window = New-Object Windows.Window
$window.Width = 230
$window.Height = 78
$window.WindowStyle = "None"
$window.AllowsTransparency = $true
$window.Background = [Windows.Media.Brushes]::Transparent
$window.Topmost = $true
$window.ShowInTaskbar = $false
$window.ResizeMode = "NoResize"

$grid = New-Object Windows.Controls.Grid
$grid.Margin = New-Object Windows.Thickness 0
$grid.RowDefinitions.Add((New-Object Windows.Controls.RowDefinition))
$grid.RowDefinitions.Add((New-Object Windows.Controls.RowDefinition))
foreach ($width in @(50, 62, 118)) {
  $col = New-Object Windows.Controls.ColumnDefinition
  $col.Width = New-Object Windows.GridLength $width
  $grid.ColumnDefinitions.Add($col)
}

function New-Text($text, $col, $row, $bold) {
  $tb = New-Object Windows.Controls.TextBlock
  $tb.Text = $text
  $tb.FontFamily = "Segoe UI"
  $tb.FontSize = 14
  $tb.FontWeight = if ($bold) { "Bold" } else { "SemiBold" }
  $tb.Foreground = New-Object Windows.Media.SolidColorBrush ([Windows.Media.Color]::FromRgb(219,229,239))
  $tb.HorizontalAlignment = "Center"
  $tb.VerticalAlignment = "Center"
  [Windows.Controls.Grid]::SetColumn($tb, $col)
  [Windows.Controls.Grid]::SetRow($tb, $row)
  $grid.Children.Add($tb) | Out-Null
  return $tb
}

$fiveLabel = New-Text "5h" 0 0 $false
$fiveValue = New-Text "..." 1 0 $true
$fiveReset = New-Text "..." 2 0 $false
$weekLabel = New-Text "Week" 0 1 $false
$weekValue = New-Text "..." 1 1 $true
$weekReset = New-Text "..." 2 1 $false
$window.Content = $grid

function Apply-Theme {
  $isLight = Test-QuotaBackgroundLight
  $color = if ($isLight) { [Windows.Media.Color]::FromRgb(67,82,104) } else { [Windows.Media.Color]::FromRgb(219,229,239) }
  $strong = if ($isLight) { [Windows.Media.Color]::FromRgb(17,24,39) } else { [Windows.Media.Color]::FromRgb(245,248,252) }
  foreach ($tb in @($fiveLabel,$fiveReset,$weekLabel,$weekReset)) { $tb.Foreground = New-Object Windows.Media.SolidColorBrush $color }
  foreach ($tb in @($fiveValue,$weekValue)) { $tb.Foreground = New-Object Windows.Media.SolidColorBrush $strong }
}

function Test-QuotaBackgroundLight {
  try {
    $pet = Get-PetBounds
    if (-not $pet) { return $false }
    $x = [Math]::Max(0, [int]($pet.X + $pet.Width / 2))
    $y = [Math]::Max(0, [int]($pet.Y + $pet.Height + 22))
    $bmp = New-Object Drawing.Bitmap 1, 1
    $g = [Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($x, $y, 0, 0, (New-Object Drawing.Size 1, 1))
    $pixel = $bmp.GetPixel(0, 0)
    $g.Dispose()
    $bmp.Dispose()
    $luma = (0.2126 * $pixel.R) + (0.7152 * $pixel.G) + (0.0722 * $pixel.B)
    return $luma -gt 150
  } catch {
    return $false
  }
}

function Position-Window {
  $pet = Get-PetBounds
  if (-not $pet) {
    [IO.File]::WriteAllText((Join-Path $appHome "last-position.json"), '{"error":"no pet bounds"}')
    return
  }
  $width = [Math]::Max(190, [Math]::Min(300, $pet.Width * 2.75))
  $height = [Math]::Max(64, [Math]::Min(96, $pet.Height * 0.86))
  $window.Width = $width
  $window.Height = $height
  $left = $pet.X + $pet.Width / 2 - $width / 2
  $top = $pet.Y + $pet.Height + 2 - $height * 0.18
  $screenLeft = [Windows.SystemParameters]::VirtualScreenLeft
  $screenTop = [Windows.SystemParameters]::VirtualScreenTop
  $screenRight = $screenLeft + [Windows.SystemParameters]::VirtualScreenWidth
  $screenBottom = $screenTop + [Windows.SystemParameters]::VirtualScreenHeight
  $window.Left = [Math]::Max($screenLeft, [Math]::Min($left, $screenRight - $width))
  $window.Top = [Math]::Max($screenTop, [Math]::Min($top, $screenBottom - $height))
}

function Update-Texts($quota) {
  $fiveValue.Text = $quota.Five
  $fiveReset.Text = $quota.FiveReset
  $weekValue.Text = $quota.Week
  $weekReset.Text = $quota.WeekReset
}

function Show-Quota([bool]$animate) {
  Apply-Theme
  Position-Window
  Update-Texts (Ensure-Quota)
  if (-not $window.IsVisible) { $window.Show() } else { $window.Activate() | Out-Null }
  if ($animate) {
    $scale = New-Object Windows.Media.ScaleTransform 0.75, 0.75
    $grid.RenderTransformOrigin = New-Object Windows.Point 0.5, 0
    $grid.RenderTransform = $scale
    $anim = New-Object Windows.Media.Animation.DoubleAnimation
    $anim.From = 1.28
    $anim.To = 1
    $anim.Duration = [Windows.Duration]::new([TimeSpan]::FromMilliseconds(420))
    $anim.EasingFunction = New-Object Windows.Media.Animation.BackEase
    $scale.BeginAnimation([Windows.Media.ScaleTransform]::ScaleXProperty, $anim)
    $scale.BeginAnimation([Windows.Media.ScaleTransform]::ScaleYProperty, $anim)
  }
  $hideTimer.Stop()
  $hideTimer.Start()
}

$hideTimer = New-Object Windows.Threading.DispatcherTimer
$hideTimer.Interval = [TimeSpan]::FromSeconds(7)
$hideTimer.Add_Tick({
  $hideTimer.Stop()
  $window.Hide()
})

$quotaTimer = New-Object Windows.Threading.DispatcherTimer
$quotaTimer.Interval = [TimeSpan]::FromSeconds(60)
$quotaTimer.Add_Tick({
  $q = Fetch-Quota
  $key = Get-WarningKey $q
  if ($key -and ($key -ne $script:lastWarningKey -or ([DateTime]::Now - $script:lastWarningAt).TotalMinutes -gt 30)) {
    $script:lastWarningKey = $key
    $script:lastWarningAt = [DateTime]::Now
    Show-Quota $true
  }
})
$quotaTimer.Start()
Fetch-Quota | Out-Null

$mouseTimer = New-Object Windows.Threading.DispatcherTimer
$mouseTimer.Interval = [TimeSpan]::FromMilliseconds(120)
$mouseTimer.Add_Tick({
  $point = New-Object NativeMouse+POINT
  [NativeMouse]::GetCursorPos([ref]$point) | Out-Null
  $isDown = ([NativeMouse]::GetAsyncKeyState(0x01) -band 0x8000) -ne 0
  $pet = Get-PetBounds
  $hover = Test-PointInBounds $point $pet

  if ($isDown -and -not $script:wasDown) {
    $script:downX = $point.X
    $script:downY = $point.Y
    $script:maxMove = 0
  }
  if ($isDown -and $script:wasDown) {
    $script:maxMove = [Math]::Max($script:maxMove, [Math]::Max([Math]::Abs($point.X - $script:downX), [Math]::Abs($point.Y - $script:downY)))
    if ($script:maxMove -gt 8 -and (Test-PointInBounds ([pscustomobject]@{ X = $script:downX; Y = $script:downY }) $pet)) {
      $window.Hide()
    }
  }
  if (-not $isDown -and $script:wasDown) {
    $started = Test-PointInBounds ([pscustomobject]@{ X = $script:downX; Y = $script:downY }) $pet
    if ($started -and $hover -and $script:maxMove -le 8) { Show-Quota $false }
  }
  if ($hover -and -not $script:isHovering -and ([DateTime]::Now - $script:lastHoverShow).TotalSeconds -gt 7) {
    $script:lastHoverShow = [DateTime]::Now
    Show-Quota $false
  }
  $script:isHovering = $hover
  $script:wasDown = $isDown
})
$mouseTimer.Start()

$window.Hide()
if ($showOnStart) {
  $window.Dispatcher.BeginInvoke([Action]{ Show-Quota $false }) | Out-Null
}
[Windows.Threading.Dispatcher]::Run()
