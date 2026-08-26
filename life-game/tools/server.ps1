# =============================================================
#  LIFE GAME - ローカルサーバ
#  Windows 標準の PowerShell だけで動く静的ファイルサーバ。
#  追加インストール不要。127.0.0.1 のみで待ち受けるため外部からは接続できない。
# =============================================================
param(
    [int]$Port = 8971,
    [string]$Root = ""
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrEmpty($Root)) {
    $Root = Split-Path -Parent $PSScriptRoot
}
$Root = (Resolve-Path $Root).Path

$mime = @{
    ".html" = "text/html; charset=utf-8"
    ".htm"  = "text/html; charset=utf-8"
    ".css"  = "text/css; charset=utf-8"
    ".js"   = "text/javascript; charset=utf-8"
    ".json" = "application/json; charset=utf-8"
    ".svg"  = "image/svg+xml"
    ".png"  = "image/png"
    ".jpg"  = "image/jpeg"
    ".jpeg" = "image/jpeg"
    ".gif"  = "image/gif"
    ".ico"  = "image/x-icon"
    ".woff" = "font/woff"
    ".woff2"= "font/woff2"
    ".txt"  = "text/plain; charset=utf-8"
    ".md"   = "text/plain; charset=utf-8"
}

function Test-PortInUse([int]$p) {
    try {
        $c = New-Object System.Net.Sockets.TcpClient
        $c.Connect("127.0.0.1", $p)
        $c.Close()
        return $true
    } catch {
        return $false
    }
}

$url = "http://127.0.0.1:$Port/"

# すでに起動済みならブラウザを開くだけで終了する
if (Test-PortInUse $Port) {
    Write-Host ""
    Write-Host "  LIFE GAME はすでに起動しています。ブラウザを開きます。" -ForegroundColor Yellow
    Start-Process $url
    Start-Sleep -Seconds 1
    exit 0
}

$ip = [System.Net.IPAddress]::Parse("127.0.0.1")
$listener = New-Object System.Net.Sockets.TcpListener($ip, $Port)

try {
    $listener.Start()
} catch {
    Write-Host ""
    Write-Host "  ポート $Port を開けませんでした: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "  別のポートで試す場合: powershell -File server.ps1 -Port 8972" -ForegroundColor Red
    Write-Host ""
    Read-Host "  Enter キーで終了"
    exit 1
}

Write-Host ""
Write-Host "  ============================================" -ForegroundColor DarkGreen
Write-Host "   LIFE GAME // TACTICAL OPS" -ForegroundColor Green
Write-Host "  ============================================" -ForegroundColor DarkGreen
Write-Host "   URL   : $url"
Write-Host "   フォルダ: $Root"
Write-Host ""
Write-Host "   このウィンドウを閉じるとアプリは停止します。" -ForegroundColor Yellow
Write-Host ""

Start-Process $url

# ---- リクエスト1件を処理する ----
function Send-Response($stream, [int]$code, [string]$status, [string]$contentType, [byte[]]$body) {
    if ($null -eq $body) { $body = New-Object byte[] 0 }
    $head  = "HTTP/1.1 $code $status`r`n"
    $head += "Content-Type: $contentType`r`n"
    $head += "Content-Length: $($body.Length)`r`n"
    $head += "Cache-Control: no-store`r`n"
    $head += "Connection: close`r`n`r`n"
    $hb = [System.Text.Encoding]::ASCII.GetBytes($head)
    $stream.Write($hb, 0, $hb.Length)
    if ($body.Length -gt 0) { $stream.Write($body, 0, $body.Length) }
    $stream.Flush()
}

while ($true) {
    $client = $null
    try {
        $client = $listener.AcceptTcpClient()
        $stream = $client.GetStream()
        $stream.ReadTimeout = 5000

        # ---- ヘッダを読む（ヘッダ終端 CRLFCRLF まで、複数回に分けて届くこともある） ----
        $headerBuf = New-Object System.IO.MemoryStream
        $chunk = New-Object byte[] 8192
        $headerStr = ""
        $headerEnd = -1
        while ($headerEnd -lt 0) {
            $read = $stream.Read($chunk, 0, $chunk.Length)
            if ($read -le 0) { break }
            $headerBuf.Write($chunk, 0, $read)
            $headerStr = [System.Text.Encoding]::ASCII.GetString($headerBuf.ToArray())
            $headerEnd = $headerStr.IndexOf("`r`n`r`n")
            if ($headerBuf.Length -gt 65536) { break }
        }
        if ($headerEnd -lt 0) { $client.Close(); continue }

        $headerPart = $headerStr.Substring(0, $headerEnd)
        $lines = $headerPart -split "`r`n"
        $firstLine = $lines[0]
        $parts = $firstLine -split " "
        $method = $parts[0]
        $rawPath = if ($parts.Length -ge 2) { $parts[1] } else { "/" }

        # Content-Length（POSTのボディ用）
        $contentLength = 0
        foreach ($line in $lines) {
            if ($line -match '^Content-Length:\s*(\d+)') { $contentLength = [int]$Matches[1] }
        }

        # ヘッダ読み込み時に一緒に届いていたボディ分＋足りない分を読む
        $allHeaderBytes = $headerBuf.ToArray()
        $bodyStart = $headerEnd + 4
        $bodyBuf = New-Object System.IO.MemoryStream
        $already = $allHeaderBytes.Length - $bodyStart
        if ($already -gt 0) { $bodyBuf.Write($allHeaderBytes, $bodyStart, $already) }
        while ($bodyBuf.Length -lt $contentLength) {
            $need = $contentLength - $bodyBuf.Length
            $bchunk = New-Object byte[] ([Math]::Min($need, 8192))
            $r2 = $stream.Read($bchunk, 0, $bchunk.Length)
            if ($r2 -le 0) { break }
            $bodyBuf.Write($bchunk, 0, $r2)
        }
        $bodyBytes = $bodyBuf.ToArray()

        # クエリを落として URL デコード
        $path = ($rawPath -split "\?")[0]
        $path = [System.Uri]::UnescapeDataString($path)

        # ---- API: data/state.json の読み書き（127.0.0.1 のみ待受なので外部到達不可） ----
        if ($path -eq "/api/state") {
            $statePath = Join-Path $Root "data\state.json"
            if ($method -eq "GET") {
                if (Test-Path -LiteralPath $statePath -PathType Leaf) {
                    Send-Response $stream 200 "OK" "application/json; charset=utf-8" ([System.IO.File]::ReadAllBytes($statePath))
                } else {
                    Send-Response $stream 404 "Not Found" "application/json; charset=utf-8" ([System.Text.Encoding]::UTF8.GetBytes("null"))
                }
            } elseif ($method -eq "POST") {
                try {
                    $text = [System.Text.Encoding]::UTF8.GetString($bodyBytes)
                    $null = $text | ConvertFrom-Json -ErrorAction Stop   # 壊れたJSONで正データを潰さないための検査
                    $dataDir = Join-Path $Root "data"
                    if (-not (Test-Path -LiteralPath $dataDir)) { New-Item -ItemType Directory -Path $dataDir | Out-Null }
                    $tmpPath = "$statePath.tmp"
                    [System.IO.File]::WriteAllBytes($tmpPath, $bodyBytes)
                    Move-Item -LiteralPath $tmpPath -Destination $statePath -Force
                    Send-Response $stream 200 "OK" "application/json; charset=utf-8" ([System.Text.Encoding]::UTF8.GetBytes('{"ok":true}'))
                } catch {
                    Send-Response $stream 400 "Bad Request" "application/json; charset=utf-8" ([System.Text.Encoding]::UTF8.GetBytes('{"ok":false}'))
                }
            } else {
                Send-Response $stream 405 "Method Not Allowed" "text/plain; charset=utf-8" ([System.Text.Encoding]::UTF8.GetBytes("405"))
            }
            $client.Close(); continue
        }

        if ($method -ne "GET" -and $method -ne "HEAD") {
            Send-Response $stream 405 "Method Not Allowed" "text/plain; charset=utf-8" ([System.Text.Encoding]::UTF8.GetBytes("405"))
            $client.Close(); continue
        }

        if ($path -eq "/") { $path = "/index.html" }
        $rel = $path.TrimStart("/").Replace("/", "\")
        if ([string]::IsNullOrEmpty($rel)) { $rel = "index.html" }

        $full = [System.IO.Path]::GetFullPath((Join-Path $Root $rel))

        # ルート外へのアクセスを拒否（区切り文字まで含めて判定する）
        $rootGuard = $Root.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
        if (-not ($full + [System.IO.Path]::DirectorySeparatorChar).StartsWith($rootGuard, [System.StringComparison]::OrdinalIgnoreCase)) {
            Send-Response $stream 403 "Forbidden" "text/plain; charset=utf-8" ([System.Text.Encoding]::UTF8.GetBytes("403"))
            $client.Close(); continue
        }

        if (Test-Path -LiteralPath $full -PathType Container) {
            $full = Join-Path $full "index.html"
        }

        if (Test-Path -LiteralPath $full -PathType Leaf) {
            $ext = [System.IO.Path]::GetExtension($full).ToLower()
            $ct = $mime[$ext]
            if (-not $ct) { $ct = "application/octet-stream" }
            $bytes = [System.IO.File]::ReadAllBytes($full)
            if ($method -eq "HEAD") {
                Send-Response $stream 200 "OK" $ct (New-Object byte[] 0)
            } else {
                Send-Response $stream 200 "OK" $ct $bytes
            }
        } else {
            $msg = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found: $path")
            Send-Response $stream 404 "Not Found" "text/plain; charset=utf-8" $msg
        }
    } catch {
        # 1件のリクエストで落ちてもサーバは止めない
    } finally {
        if ($client) { try { $client.Close() } catch {} }
    }
}
