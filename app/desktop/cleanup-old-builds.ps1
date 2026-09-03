# FlowMind 旧版本构建清理脚本
# 用途：删除 out-1.1.0, out-1.1.1, out-1.1.2 目录
# 使用前请确保所有 FlowMind 和 Electron 进程已关闭

Write-Host "FlowMind 旧版本构建清理工具" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan
Write-Host ""

# 检查并停止相关进程
Write-Host "1. 检查运行中的进程..." -ForegroundColor Yellow
$processes = Get-Process | Where-Object {
    $_.ProcessName -like "*FlowMind*" -or
    $_.ProcessName -like "*electron*" -or
    ($_.Path -and $_.Path -like "*ima-feishu*")
}

if ($processes) {
    Write-Host "   发现 $($processes.Count) 个相关进程" -ForegroundColor Red
    foreach ($proc in $processes) {
        Write-Host "   - $($proc.ProcessName) (PID: $($proc.Id))" -ForegroundColor Red
    }

    $response = Read-Host "   是否强制停止这些进程？(y/n)"
    if ($response -eq 'y') {
        $processes | Stop-Process -Force
        Write-Host "   已停止所有进程" -ForegroundColor Green
        Start-Sleep -Seconds 2
    } else {
        Write-Host "   请手动关闭这些进程后重新运行此脚本" -ForegroundColor Yellow
        exit 1
    }
} else {
    Write-Host "   未发现运行中的进程" -ForegroundColor Green
}

Write-Host ""
Write-Host "2. 删除旧版本目录..." -ForegroundColor Yellow

$oldDirs = @("out-1.1.0", "out-1.1.1", "out-1.1.2")
$totalSize = 0
$successCount = 0

foreach ($dir in $oldDirs) {
    if (Test-Path $dir) {
        try {
            $size = (Get-ChildItem $dir -Recurse -Force -ErrorAction SilentlyContinue |
                     Measure-Object -Property Length -Sum).Sum
            $sizeMB = [math]::Round($size / 1MB, 2)
            $totalSize += $sizeMB

            Write-Host "   删除 $dir ($sizeMB MB)..." -NoNewline
            Remove-Item $dir -Recurse -Force -ErrorAction Stop
            Write-Host " ✓" -ForegroundColor Green
            $successCount++
        } catch {
            Write-Host " ✗" -ForegroundColor Red
            Write-Host "     错误: $($_.Exception.Message)" -ForegroundColor Red
        }
    } else {
        Write-Host "   $dir 不存在，跳过" -ForegroundColor Gray
    }
}

Write-Host ""
Write-Host "================================" -ForegroundColor Cyan
Write-Host "清理完成！" -ForegroundColor Cyan
Write-Host "  成功删除: $successCount / $($oldDirs.Count) 个目录" -ForegroundColor Green
Write-Host "  释放空间: $totalSize MB" -ForegroundColor Green
Write-Host ""

# 显示剩余目录
Write-Host "3. 当前构建目录：" -ForegroundColor Yellow
Get-ChildItem -Directory -Filter "out-*" | ForEach-Object {
    $size = (Get-ChildItem $_.FullName -Recurse -Force -ErrorAction SilentlyContinue |
             Measure-Object -Property Length -Sum).Sum
    $sizeMB = [math]::Round($size / 1MB, 2)
    Write-Host "   $($_.Name) - $sizeMB MB" -ForegroundColor Cyan
}

Write-Host ""
Write-Host "按任意键退出..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
