$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$assetDir = Join-Path $PSScriptRoot 'video-assets'
New-Item -ItemType Directory -Path $assetDir -Force | Out-Null
$W = 1080; $H = 1920
$colors = @{
  bg = [System.Drawing.ColorTranslator]::FromHtml('#F5F7F3')
  ink = [System.Drawing.ColorTranslator]::FromHtml('#173A31')
  green = [System.Drawing.ColorTranslator]::FromHtml('#24634E')
  deep = [System.Drawing.ColorTranslator]::FromHtml('#174A3A')
  sage = [System.Drawing.ColorTranslator]::FromHtml('#E7EFE8')
  muted = [System.Drawing.ColorTranslator]::FromHtml('#73847A')
  line = [System.Drawing.ColorTranslator]::FromHtml('#E1E8E1')
  white = [System.Drawing.Color]::White
  gold = [System.Drawing.ColorTranslator]::FromHtml('#D9E4A9')
}

function New-Font([float]$size, [bool]$bold = $false) {
  $style = if ($bold) { [System.Drawing.FontStyle]::Bold } else { [System.Drawing.FontStyle]::Regular }
  return [System.Drawing.Font]::new('Segoe UI', $size, $style, [System.Drawing.GraphicsUnit]::Pixel)
}
function Fill-RoundRect($g, [float]$x, [float]$y, [float]$w, [float]$h, [float]$r, $color) {
  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $d = $r * 2
  $path.AddArc($x, $y, $d, $d, 180, 90)
  $path.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $path.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $path.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  $brush = [System.Drawing.SolidBrush]::new($color)
  $g.FillPath($brush, $path)
  $brush.Dispose(); $path.Dispose()
}
function Stroke-RoundRect($g, [float]$x, [float]$y, [float]$w, [float]$h, [float]$r, $color, [float]$width = 2) {
  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $d = $r * 2
  $path.AddArc($x, $y, $d, $d, 180, 90); $path.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $path.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90); $path.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $path.CloseFigure(); $pen = [System.Drawing.Pen]::new($color, $width); $g.DrawPath($pen, $path); $pen.Dispose(); $path.Dispose()
}
function Draw-Text($g, [string]$text, [float]$x, [float]$y, [float]$size, $color, [bool]$bold = $false) {
  $font = New-Font $size $bold; $brush = [System.Drawing.SolidBrush]::new($color)
  $g.DrawString($text, $font, $brush, $x, $y); $font.Dispose(); $brush.Dispose()
}
function Draw-TextRight($g, [string]$text, [float]$right, [float]$y, [float]$size, $color, [bool]$bold = $false) {
  $font = New-Font $size $bold; $brush = [System.Drawing.SolidBrush]::new($color); $measure = $g.MeasureString($text, $font)
  $g.DrawString($text, $font, $brush, $right - $measure.Width, $y); $font.Dispose(); $brush.Dispose()
}
function Draw-Wrap($g, [string]$text, [float]$x, [float]$y, [float]$maxWidth, [float]$size, $color, [bool]$bold = $false, [float]$lineGap = 1.38) {
  $font = New-Font $size $bold; $brush = [System.Drawing.SolidBrush]::new($color); $words = $text.Split(' '); $row = ''; $line = 0
  foreach ($word in $words) {
    $candidate = if ($row) { "$row $word" } else { $word }
    if ($row -and $g.MeasureString($candidate, $font).Width -gt $maxWidth) {
      $g.DrawString($row, $font, $brush, $x, $y + ($line * $size * $lineGap)); $row = $word; $line++
    } else { $row = $candidate }
  }
  if ($row) { $g.DrawString($row, $font, $brush, $x, $y + ($line * $size * $lineGap)) }
  $font.Dispose(); $brush.Dispose()
}
function Draw-Pill($g, [string]$label, [float]$x, [float]$y, [float]$w, [bool]$selected = $false) {
  $fill = if ($selected) { $colors.green } else { $colors.white }; $fg = if ($selected) { $colors.white } else { $colors.deep }
  Fill-RoundRect $g $x $y $w 64 30 $fill; if (-not $selected) { Stroke-RoundRect $g $x $y $w 64 30 $colors.line 2 }
  $font = New-Font 22 $true; $brush = [System.Drawing.SolidBrush]::new($fg); $measure = $g.MeasureString($label, $font); $g.DrawString($label, $font, $brush, $x + (($w - $measure.Width) / 2), $y + 18); $font.Dispose(); $brush.Dispose()
}
function Draw-Button($g, [string]$label, [float]$x, [float]$y, [float]$w, [bool]$outline = $false) {
  $fill = if ($outline) { $colors.white } else { $colors.green }; $fg = if ($outline) { $colors.deep } else { $colors.white }
  Fill-RoundRect $g $x $y $w 74 18 $fill; if ($outline) { Stroke-RoundRect $g $x $y $w 74 18 $colors.green 2 }
  $font = New-Font 23 $true; $brush = [System.Drawing.SolidBrush]::new($fg); $measure = $g.MeasureString($label, $font); $g.DrawString($label, $font, $brush, $x + (($w - $measure.Width) / 2), $y + 22); $font.Dispose(); $brush.Dispose()
}
function Draw-Base([int]$scene, [string]$section, [string]$title, [string]$subtitle, [string]$caption) {
  $bmp = [System.Drawing.Bitmap]::new($W, $H, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp); $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias; $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $g.Clear($colors.bg)
  Fill-RoundRect $g 72 66 82 82 24 $colors.deep
  $pen = [System.Drawing.Pen]::new($colors.gold, 9); $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round; $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $g.DrawLines($pen, [System.Drawing.PointF[]]@([System.Drawing.PointF]::new(94,91), [System.Drawing.PointF]::new(112,129), [System.Drawing.PointF]::new(133,90))); $pen.Dispose()
  Draw-Text $g 'MeetInc' 178 87 40 $colors.ink $true
  Fill-RoundRect $g 820 78 188 52 24 $colors.sage; Draw-Text $g 'A BETTER WAY TO MEET' 843 96 15 $colors.deep $true
  Fill-RoundRect $g 76 187 14 14 7 $colors.gold; Draw-Text $g "MEETINC  ·  $section" 103 180 18 $colors.muted $true
  $lineIndex = 0; foreach ($line in $title.Split("`n")) { Draw-Text $g $line 72 (284 + ($lineIndex * 82)) 67 $colors.ink $true; $lineIndex++ }
  Draw-Wrap $g $subtitle 75 470 910 28 $colors.muted $false 1.42
  Fill-RoundRect $g 72 1588 936 174 28 $colors.deep; Draw-Text $g $caption 110 1641 24 $colors.white $true
  Draw-TextRight $g (('{0:D2} / 07' -f ($scene + 1))) 976 1700 17 ([System.Drawing.ColorTranslator]::FromHtml('#D9E7DA')) $true
  Fill-RoundRect $g 72 1820 936 8 4 $colors.line; Fill-RoundRect $g 72 1820 (936 * (($scene + 1) / 7.0)) 8 4 $colors.gold
  return @{ Bitmap = $bmp; Graphics = $g }
}
function Draw-Card($g, [float]$x, [float]$y, [float]$w, [float]$h, [float]$radius = 26) { Fill-RoundRect $g $x $y $w $h $radius $colors.white; Stroke-RoundRect $g $x $y $w $h $radius $colors.line 2 }
function Save-Scene($scene, $name) { $scene.Graphics.Dispose(); $path = Join-Path $assetDir $name; $scene.Bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png); $scene.Bitmap.Dispose() }

$s = Draw-Base 0 'WELCOME' "Good things happen`nwhen you meet." 'Find a business. Share what you need. Plan a time.' 'A more personal way to arrange your next appointment.'
Fill-RoundRect $s.Graphics 80 690 920 500 36 $colors.deep; Fill-RoundRect $s.Graphics 132 750 94 94 26 ([System.Drawing.ColorTranslator]::FromHtml('#286A52'))
$pen = [System.Drawing.Pen]::new($colors.gold, 10); $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round; $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round; $s.Graphics.DrawLines($pen, [System.Drawing.PointF[]]@([System.Drawing.PointF]::new(158,778),[System.Drawing.PointF]::new(176,820),[System.Drawing.PointF]::new(201,776))); $pen.Dispose()
Draw-Text $s.Graphics 'MeetInc' 265 770 65 $colors.white $true; Draw-Wrap $s.Graphics 'Thoughtful appointments begin with a clear conversation.' 140 895 780 30 ([System.Drawing.ColorTranslator]::FromHtml('#DCE9DE')) $false
Draw-Pill $s.Graphics 'Business' 142 1050 210 $false; Draw-Pill $s.Graphics 'Customer' 372 1050 228 $true; Draw-Button $s.Graphics 'Explore MeetInc  →' 142 1220 500
Save-Scene $s 'scene-01.png'

$s = Draw-Base 1 'DISCOVER' "Find the right`nhelp for you." 'Explore businesses by category and see what they offer.' 'Browse by the kind of help you need.'
Draw-Pill $s.Graphics 'Beauty & wellness' 72 605 445 $true; Draw-Pill $s.Graphics 'Home & property' 555 605 445; Draw-Pill $s.Graphics 'Professional services' 72 686 445; Draw-Pill $s.Graphics 'Food & catering' 555 686 445
Draw-Card $s.Graphics 72 790 936 650 30; Fill-RoundRect $s.Graphics 112 834 66 66 19 $colors.sage; Draw-Text $s.Graphics '✳' 129 845 34 $colors.deep $true
Draw-Text $s.Graphics 'Moss & Meadow Wellness' 202 839 29 $colors.ink $true; Draw-Text $s.Graphics 'Beauty & wellness  ·  Open weekdays' 202 884 20 $colors.muted
Draw-Wrap $s.Graphics 'Friendly skincare consultations and practical wellness support.' 112 952 825 25 $colors.muted
$pen = [System.Drawing.Pen]::new($colors.line,2); $s.Graphics.DrawLine($pen,112,1021,968,1021); $pen.Dispose()
Draw-Text $s.Graphics 'POPULAR SERVICE' 112 1066 17 $colors.muted $true; Draw-Text $s.Graphics 'Wellness consultation' 112 1115 27 $colors.ink $true; Draw-Text $s.Graphics 'From R350' 112 1160 22 $colors.deep $true; Draw-Button $s.Graphics 'View business  →' 112 1240 360
Save-Scene $s 'scene-02.png'

$s = Draw-Base 2 'CHOOSE A SERVICE' "Choose what you`nneed a hand with." 'Pick a service, then tell the business what to prepare.' 'Your request includes the service and what you need.'
Draw-Card $s.Graphics 72 625 936 675 30; Fill-RoundRect $s.Graphics 112 665 66 66 18 $colors.sage; Draw-Text $s.Graphics '✦' 132 675 30 $colors.deep $true
Draw-Text $s.Graphics 'Moss & Meadow Wellness' 202 669 26 $colors.ink $true; Draw-Text $s.Graphics '2 services available' 202 710 20 $colors.muted
Fill-RoundRect $s.Graphics 112 765 856 174 22 $colors.bg; Stroke-RoundRect $s.Graphics 112 765 856 174 22 $colors.line 2
Draw-Text $s.Graphics 'Wellness consultation' 145 799 25 $colors.ink $true; Draw-Wrap $s.Graphics '30-minute skincare and wellness advice' 145 846 590 21 $colors.muted; Draw-TextRight $s.Graphics 'R350' 928 820 28 $colors.deep $true
Fill-RoundRect $s.Graphics 112 962 856 174 22 $colors.bg; Stroke-RoundRect $s.Graphics 112 962 856 174 22 $colors.line 2
Draw-Text $s.Graphics 'Personal skincare plan' 145 996 25 $colors.ink $true; Draw-Wrap $s.Graphics 'A tailored routine with a follow-up appointment' 145 1043 590 21 $colors.muted; Draw-TextRight $s.Graphics 'R650' 928 1017 28 $colors.deep $true
Draw-Button $s.Graphics 'Choose a service  →' 112 1170 410
Save-Scene $s 'scene-03.png'

$s = Draw-Base 3 'BOOKING' "Suggest a time`nthat works for you." 'Choose your preferred time, add a backup, or suggest another.' 'The business can confirm or discuss another time.'
Draw-Card $s.Graphics 72 610 936 815 30; Draw-Text $s.Graphics 'Request an appointment' 112 652 26 $colors.ink $true; Draw-Text $s.Graphics 'Wellness consultation  ·  R350' 112 698 21 $colors.muted
Fill-RoundRect $s.Graphics 112 747 856 160 20 $colors.bg; Draw-Text $s.Graphics 'PREFERRED DATE' 145 777 16 $colors.muted $true; Draw-Text $s.Graphics 'Monday, 23 November' 145 820 25 $colors.ink $true
Draw-Text $s.Graphics 'AVAILABLE TIMES' 112 942 16 $colors.muted $true; Draw-Pill $s.Graphics '9:30' 112 969 145; Draw-Pill $s.Graphics '10:00' 277 969 145 $true; Draw-Pill $s.Graphics '10:30' 442 969 145; Draw-Pill $s.Graphics '11:00' 607 969 145
Fill-RoundRect $s.Graphics 112 1068 856 106 20 $colors.sage; Draw-Text $s.Graphics 'BACKUP' 145 1092 16 $colors.deep $true; Draw-Text $s.Graphics 'Tuesday  ·  2:00 PM' 145 1124 23 $colors.ink $true
Draw-Text $s.Graphics 'SUGGEST ANOTHER TIME' 112 1210 16 $colors.muted $true; Fill-RoundRect $s.Graphics 112 1238 856 70 15 $colors.white; Stroke-RoundRect $s.Graphics 112 1238 856 70 15 $colors.line 2; Draw-Text $s.Graphics '11:00 would work better for me' 140 1258 20 $colors.ink
Draw-Button $s.Graphics 'Send appointment request  →' 112 1330 510
Save-Scene $s 'scene-04.png'

$s = Draw-Base 4 'BUSINESS VIEW' "The business is`nready for your visit." 'Your order, assistance request and preferred times arrive together.' 'Everyone knows what to expect before you meet.'
Draw-Card $s.Graphics 72 610 936 815 30; Draw-Text $s.Graphics 'New appointment request' 112 651 26 $colors.ink $true
Fill-RoundRect $s.Graphics 112 708 856 652 24 $colors.bg; Fill-RoundRect $s.Graphics 145 745 64 64 18 $colors.sage; Draw-Text $s.Graphics 'JD' 158 758 25 $colors.deep $true; Draw-Text $s.Graphics 'Jamie Demo' 230 746 24 $colors.ink $true; Draw-Text $s.Graphics 'Just now · New customer request' 230 784 18 $colors.muted
$pen = [System.Drawing.Pen]::new($colors.line,2); $s.Graphics.DrawLine($pen,145,832,935,832); $pen.Dispose()
Draw-Text $s.Graphics 'FIRST ORDER' 145 860 15 $colors.muted $true; Draw-Text $s.Graphics 'Wellness consultation' 145 890 23 $colors.ink $true
Draw-Text $s.Graphics 'ASSISTANCE' 145 940 15 $colors.muted $true; Draw-Text $s.Graphics 'Advice or consultation' 145 970 22 $colors.ink
Draw-Text $s.Graphics 'PREFERRED' 145 1020 15 $colors.muted $true; Draw-Text $s.Graphics 'Mon  ·  10:00 AM' 145 1050 21 $colors.ink
Draw-Text $s.Graphics 'BACKUP + ALTERNATE' 145 1100 15 $colors.muted $true; Draw-Text $s.Graphics 'Tue  ·  2:00 PM  ·  Suggests 11:00 AM' 145 1130 20 $colors.ink
Draw-Button $s.Graphics 'Confirm time' 145 1200 300; Draw-Button $s.Graphics 'Accept alternate' 480 1200 360 $true
Save-Scene $s 'scene-05.png'

$s = Draw-Base 5 'CHAT' "Keep the details`nin one conversation." 'Message the business to work out the final details.' 'Stay in touch right in MeetInc.'
Draw-Card $s.Graphics 72 630 936 790 30; Draw-Text $s.Graphics 'Chat with the business' 112 673 27 $colors.ink $true
Fill-RoundRect $s.Graphics 250 735 700 160 28 $colors.sage; Draw-Wrap $s.Graphics "Hi, I'm looking for a skincare routine for sensitive skin." 285 778 615 24 $colors.ink; Draw-Text $s.Graphics 'Jamie  ·  9:46 AM' 285 862 17 $colors.muted
Fill-RoundRect $s.Graphics 112 930 700 170 28 $colors.deep; Draw-Wrap $s.Graphics 'Of course. I can offer 11:00 on Monday if that works for you.' 148 975 615 24 $colors.white; Draw-Text $s.Graphics 'Moss & Meadow  ·  9:48 AM' 148 1063 17 ([System.Drawing.ColorTranslator]::FromHtml('#D4E4D8'))
Fill-RoundRect $s.Graphics 250 1138 700 132 28 $colors.sage; Draw-Wrap $s.Graphics '11:00 works great, thank you!' 285 1178 615 24 $colors.ink; Draw-Text $s.Graphics 'Jamie  ·  9:49 AM' 285 1237 17 $colors.muted
Fill-RoundRect $s.Graphics 112 1300 820 66 18 $colors.bg; Stroke-RoundRect $s.Graphics 112 1300 820 66 18 $colors.line 2; Draw-Text $s.Graphics 'Write a message…' 145 1321 19 $colors.muted
Save-Scene $s 'scene-06.png'

$s = Draw-Base 6 'GET STARTED' "Make your next`nmeeting count." 'Find a business and get started with MeetInc.' 'Start with a business, an idea, and a time that works.'
Fill-RoundRect $s.Graphics 72 675 936 565 36 $colors.deep; Fill-RoundRect $s.Graphics 126 735 94 94 24 ([System.Drawing.ColorTranslator]::FromHtml('#286A52'))
$pen = [System.Drawing.Pen]::new($colors.gold,10); $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round; $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round; $s.Graphics.DrawLines($pen,[System.Drawing.PointF[]]@([System.Drawing.PointF]::new(152,763),[System.Drawing.PointF]::new(170,806),[System.Drawing.PointF]::new(194,762))); $pen.Dispose()
Draw-Text $s.Graphics 'MeetInc' 257 751 55 $colors.white $true; Draw-Text $s.Graphics 'Good things happen' 126 890 53 $colors.white $true; Draw-Text $s.Graphics 'when you meet.' 126 956 53 $colors.white $true
Draw-Wrap $s.Graphics 'Start with a business, an idea, and a time that works.' 126 1052 790 25 ([System.Drawing.ColorTranslator]::FromHtml('#DCE9DE'))
Draw-Button $s.Graphics 'Find your next appointment  →' 126 1150 610; Draw-Text $s.Graphics 'meetinc.web.app' 126 1300 24 $colors.deep $true
Save-Scene $s 'scene-07.png'

Write-Output "Rendered seven promo scenes to $assetDir"
