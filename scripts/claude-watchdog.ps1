<#
.SYNOPSIS
  Claude Code usage-limit watchdog — waits out the rate-limit window, then
  notifies you and optionally relaunches Claude Code.

.DESCRIPTION
  Run this as soon as Claude Code shows "You've reached your usage limit".
  The script counts down visually, pops a Windows toast notification when
  the window has passed, and (optionally) relaunches 'claude' automatically.

.PARAMETER WaitMinutes
  How many minutes to wait before alerting. Default = 15.
  Override when Claude tells you "try again in X minutes".

.PARAMETER AutoRelaunch
  If set, the script runs 'claude' in the same terminal after the wait.

.PARAMETER CheckIntervalSeconds
  How often (in seconds) the countdown refreshes. Default = 30.

.EXAMPLE
  # Wait 15 minutes (default), then notify
  .\scripts\claude-watchdog.ps1

  # Claude said "try again in 47 minutes"
  .\scripts\claude-watchdog.ps1 -WaitMinutes 47

  # Wait 5 hours (full Pro reset window) and auto-relaunch
  .\scripts\claude-watchdog.ps1 -WaitMinutes 300 -AutoRelaunch

  # Quick retry test
  .\scripts\claude-watchdog.ps1 -WaitMinutes 1
#>

param(
    [int]   $WaitMinutes          = 15,
    [switch]$AutoRelaunch,
    [int]   $CheckIntervalSeconds = 30
)

# ── helpers ──────────────────────────────────────────────────────────────────

function Show-ToastNotification {
    param([string]$Title, [string]$Message)
    try {
        [Windows.UI.Notifications.ToastNotificationManager,
         Windows.UI.Notifications, ContentType=WindowsRuntime] | Out-Null
        [Windows.Data.Xml.Dom.XmlDocument,
         Windows.Data.Xml.Dom, ContentType=WindowsRuntime] | Out-Null

        $template = [Windows.UI.Notifications.ToastTemplateType]::ToastText02
        $xml      = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent($template)
        $nodes    = $xml.GetElementsByTagName("text")
        $nodes[0].AppendChild($xml.CreateTextNode($Title))   | Out-Null
        $nodes[1].AppendChild($xml.CreateTextNode($Message)) | Out-Null

        $toast    = [Windows.UI.Notifications.ToastNotification]::new($xml)
        $notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("Claude Code Watchdog")
        $notifier.Show($toast)
    } catch {
        # Fallback: just beep
        [console]::Beep(880, 400)
        [console]::Beep(1100, 600)
    }
}

function Write-Bar {
    param([int]$Pct, [int]$Width = 40)
    $filled = [math]::Floor($Width * $Pct / 100)
    $empty  = $Width - $filled
    $bar    = ("█" * $filled) + ("░" * $empty)
    return "[$bar] $Pct%"
}

function Format-TimeSpan {
    param([timespan]$ts)
    if ($ts.TotalHours -ge 1) {
        return "{0}h {1:D2}m {2:D2}s" -f [int]$ts.Hours, $ts.Minutes, $ts.Seconds
    }
    return "{0:D2}m {1:D2}s" -f $ts.Minutes, $ts.Seconds
}

# ── main ─────────────────────────────────────────────────────────────────────

$totalSeconds = $WaitMinutes * 60
$deadline     = (Get-Date).AddSeconds($totalSeconds)

Write-Host ""
Write-Host "  ╔══════════════════════════════════════════════╗" -ForegroundColor DarkCyan
Write-Host "  ║       Claude Code — Usage Limit Watchdog     ║" -ForegroundColor DarkCyan
Write-Host "  ╚══════════════════════════════════════════════╝" -ForegroundColor DarkCyan
Write-Host ""
Write-Host "  Wait time   : $WaitMinutes minutes" -ForegroundColor Cyan
Write-Host "  Ready at    : $($deadline.ToString('HH:mm:ss'))" -ForegroundColor Cyan
Write-Host "  Auto-relaunch: $(if($AutoRelaunch){'yes — will run claude after wait'}else{'no'})" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Press Ctrl+C to cancel." -ForegroundColor DarkGray
Write-Host ""

$startedAt = Get-Date

try {
    while ((Get-Date) -lt $deadline) {
        $now       = Get-Date
        $elapsed   = $now - $startedAt
        $remaining = $deadline - $now
        $pct       = [math]::Min(100, [math]::Floor($elapsed.TotalSeconds / $totalSeconds * 100))

        $bar       = Write-Bar -Pct $pct
        $remStr    = Format-TimeSpan -ts $remaining
        $elStr     = Format-TimeSpan -ts $elapsed

        # Overwrite the same two lines
        $pos = [System.Console]::CursorTop
        [System.Console]::SetCursorPosition(0, [math]::Max(0, $pos - 2))

        Write-Host ("  {0}" -f $bar) -ForegroundColor Yellow
        Write-Host ("  Elapsed: {0}  |  Remaining: {1}   " -f $elStr, $remStr) -ForegroundColor Gray

        Start-Sleep -Seconds $CheckIntervalSeconds
    }
} catch [System.OperationCanceledException] {
    Write-Host "`n  Cancelled." -ForegroundColor Red
    exit 1
}

# ── done ─────────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "  ✅  Wait complete — Claude should be available again!" -ForegroundColor Green
Write-Host ""

Show-ToastNotification `
    -Title   "Claude Code — Ready!" `
    -Message "Usage limit window has passed. You can resume your session."

# Extra audible alert (3 short beeps)
1..3 | ForEach-Object { [console]::Beep(1000, 200); Start-Sleep -Milliseconds 150 }

if ($AutoRelaunch) {
    Write-Host "  Relaunching claude ..." -ForegroundColor Cyan
    Write-Host ""
    claude
}
