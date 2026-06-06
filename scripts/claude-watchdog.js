#!/usr/bin/env node
/**
 * Claude Code usage-limit watchdog
 *
 * Run this the moment Claude Code shows "You've reached your usage limit".
 * Counts down in the terminal, beeps, and optionally relaunches `claude`.
 *
 * Usage:
 *   node scripts/claude-watchdog.js              # wait 15 min (default)
 *   node scripts/claude-watchdog.js 47           # wait 47 min
 *   node scripts/claude-watchdog.js 300 --relaunch  # wait 5h then relaunch
 *
 * Or via npm shortcut (add to package.json scripts):
 *   npm run watchdog          → 15-minute wait
 *   npm run watchdog -- 47   → 47-minute wait
 */

'use strict';

const { execSync, spawn } = require('child_process');
const readline = require('readline');

// ── args ──────────────────────────────────────────────────────────────────

const args        = process.argv.slice(2);
const waitMinutes = parseInt(args.find(a => /^\d+$/.test(a)) ?? '15', 10);
const autoRelaunch = args.includes('--relaunch');
const totalMs     = waitMinutes * 60 * 1000;
const deadline    = new Date(Date.now() + totalMs);

// ── helpers ───────────────────────────────────────────────────────────────

function bar(pct, width = 40) {
  const filled = Math.floor(width * pct / 100);
  return '[' + '█'.repeat(filled) + '░'.repeat(width - filled) + `] ${pct}%`;
}

function fmt(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2,'0')}m ${String(sec).padStart(2,'0')}s`;
  return `${String(m).padStart(2,'0')}m ${String(sec).padStart(2,'0')}s`;
}

function clearLine() {
  process.stdout.write('\r\x1b[K');
}

function beep(n = 3) {
  for (let i = 0; i < n; i++) {
    setTimeout(() => process.stdout.write('\x07'), i * 350);
  }
}

function systemNotify(title, message) {
  try {
    if (process.platform === 'win32') {
      // PowerShell toast
      const ps = `
        [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime] | Out-Null
        $t = [Windows.UI.Notifications.ToastTemplateType]::ToastText02
        $x = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent($t)
        $n = $x.GetElementsByTagName('text')
        $n[0].AppendChild($x.CreateTextNode('${title.replace(/'/g,"''")}')) | Out-Null
        $n[1].AppendChild($x.CreateTextNode('${message.replace(/'/g,"''")}')) | Out-Null
        $toast = [Windows.UI.Notifications.ToastNotification]::new($x)
        [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Claude Watchdog').Show($toast)
      `.trim();
      execSync(`powershell -NoProfile -Command "${ps.replace(/"/g,'\\"')}"`, { stdio: 'ignore' });
    } else if (process.platform === 'darwin') {
      execSync(`osascript -e 'display notification "${message}" with title "${title}"'`, { stdio: 'ignore' });
    } else {
      // Linux — try notify-send
      execSync(`notify-send "${title}" "${message}"`, { stdio: 'ignore' });
    }
  } catch { /* notifications are best-effort */ }
}

// ── setup ─────────────────────────────────────────────────────────────────

readline.emitKeypressEvents(process.stdin);
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.on('keypress', (_, key) => {
  if (key && (key.name === 'q' || (key.ctrl && key.name === 'c'))) {
    console.log('\n\n  Cancelled.\n');
    process.exit(1);
  }
});

console.log('\n');
console.log('  ╔══════════════════════════════════════════════╗');
console.log('  ║       Claude Code — Usage Limit Watchdog     ║');
console.log('  ╚══════════════════════════════════════════════╝');
console.log('');
console.log(`  Wait time    : ${waitMinutes} minutes`);
console.log(`  Ready at     : ${deadline.toLocaleTimeString()}`);
console.log(`  Auto-relaunch: ${autoRelaunch ? 'yes — will run claude after wait' : 'no'}`);
console.log('');
console.log('  Press Q or Ctrl+C to cancel.\n');

// ── countdown ─────────────────────────────────────────────────────────────

const TICK = 5000; // update every 5 seconds
const startedAt = Date.now();

const timer = setInterval(() => {
  const now       = Date.now();
  const elapsed   = now - startedAt;
  const remaining = deadline - now;

  if (remaining <= 0) {
    clearInterval(timer);
    done();
    return;
  }

  const pct = Math.min(100, Math.floor(elapsed / totalMs * 100));
  clearLine();
  process.stdout.write(
    `  ${bar(pct)}  elapsed: ${fmt(elapsed)}  remaining: ${fmt(remaining)}`
  );
}, TICK);

// Trigger immediately
(function tick() {
  const now       = Date.now();
  const elapsed   = now - startedAt;
  const remaining = deadline - now;
  const pct       = Math.min(100, Math.floor(elapsed / totalMs * 100));
  clearLine();
  process.stdout.write(
    `  ${bar(pct)}  elapsed: ${fmt(elapsed)}  remaining: ${fmt(remaining)}`
  );
})();

// ── done ──────────────────────────────────────────────────────────────────

function done() {
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  clearLine();
  console.log('\n');
  console.log('  ✅  Wait complete — Claude should be available again!');
  console.log('');

  beep(3);
  systemNotify('Claude Code — Ready!', 'Usage limit window has passed. You can resume your session.');

  if (autoRelaunch) {
    console.log('  Relaunching claude ...\n');
    const child = spawn('claude', [], { stdio: 'inherit', shell: true });
    child.on('exit', code => process.exit(code ?? 0));
  } else {
    process.exit(0);
  }
}
