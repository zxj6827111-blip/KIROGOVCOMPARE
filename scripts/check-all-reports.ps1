# 查看所有报告的一致性校验状态
# 用法: .\scripts\check-all-reports.ps1

param(
    [switch]$OnlyWithIssues  # 只显示有问题的报告
)

Write-Host "=== 报告一致性校验状态总览 ===" -ForegroundColor Cyan
Write-Host ""

# 获取所有报告
$response = curl "http://localhost:8787/api/reports" | ConvertFrom-Json

if (-not $response.data) {
    Write-Host "❌ 无法获取报告列表" -ForegroundColor Red
    exit 1
}

$reports = $response.data
Write-Host "共找到 $($reports.Count) 个报告`n" -ForegroundColor Gray

# 统计
$totalReports = 0
$hasChecks = 0
$hasIssues = 0
$totalFail = 0
$totalUncertain = 0

foreach ($report in $reports) {
    $reportId = $report.report_id
    $totalReports++
    
    try {
        $checkResult = curl "http://localhost:8787/api/reports/$reportId/checks" | ConvertFrom-Json
        
        if ($checkResult.latest_run) {
            $hasChecks++
            $summary = $checkResult.latest_run.summary
            $fail = $summary.fail
            $uncertain = $summary.uncertain
            $issueCount = $fail + $uncertain
            
            $totalFail += $fail
            $totalUncertain += $uncertain
            
            if ($issueCount -gt 0) {
                $hasIssues++
            }
            
            # 如果设置了 OnlyWithIssues 参数，只显示有问题的
            if ($OnlyWithIssues -and $issueCount -eq 0) {
                continue
            }
            
            # 显示报告信息
            $statusIcon = if ($issueCount -eq 0) { "✓" } else { "❌" }
            $color = if ($issueCount -eq 0) { "Green" } else { "Red" }
            
            Write-Host "[$reportId] " -NoNewline
            Write-Host "$statusIcon " -NoNewline -ForegroundColor $color
            Write-Host "$($report.unit_name) ($($report.year) 年)" -NoNewline
            
            if ($issueCount -gt 0) {
                Write-Host " - " -NoNewline
                if ($fail -gt 0) {
                    Write-Host "$fail 个失败" -NoNewline -ForegroundColor Red
                }
                if ($uncertain -gt 0) {
                    if ($fail -gt 0) { Write-Host ", " -NoNewline }
                    Write-Host "$uncertain 个不确定" -NoNewline -ForegroundColor Yellow
                }
            } else {
                Write-Host " - 无问题" -NoNewline -ForegroundColor Green
            }
            
            Write-Host ""
            
        } else {
            # 未运行过校验
            if (-not $OnlyWithIssues) {
                Write-Host "[$reportId] ⏸ $($report.unit_name) ($($report.year) 年) - 未校验" -ForegroundColor Gray
            }
        }
    } catch {
        Write-Host "[$reportId] ⚠ 查询失败: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "=== 统计汇总 ===" -ForegroundColor Cyan
Write-Host "总报告数: $totalReports"
Write-Host "已校验: $hasChecks"
Write-Host "有问题: $hasIssues" -ForegroundColor $(if ($hasIssues -gt 0) { "Red" } else { "Green" })
Write-Host "  - 失败项: $totalFail" -ForegroundColor Red
Write-Host "  - 不确定: $totalUncertain" -ForegroundColor Yellow
Write-Host "未校验: $($totalReports - $hasChecks)" -ForegroundColor Gray
Write-Host ""

if ($totalReports - $hasChecks -gt 0) {
    Write-Host "💡 提示: 运行以下命令为所有报告触发校验:" -ForegroundColor Cyan
    Write-Host "  .\scripts\batch-trigger-checks.ps1" -ForegroundColor Gray
}
