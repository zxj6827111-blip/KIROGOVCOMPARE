# 批量触发旧报告的一致性校验
# 用法: .\scripts\batch-trigger-checks.ps1

Write-Host "=== 批量触发旧报告一致性校验 ===" -ForegroundColor Cyan
Write-Host ""

# 获取所有报告
Write-Host "正在获取报告列表..." -ForegroundColor Yellow
$response = curl "http://localhost:8787/api/reports" | ConvertFrom-Json

if (-not $response.data) {
    Write-Host "❌ 无法获取报告列表" -ForegroundColor Red
    exit 1
}

$reports = $response.data
Write-Host "✓ 找到 $($reports.Count) 个报告" -ForegroundColor Green
Write-Host ""

# 统计
$total = 0
$succeeded = 0
$alreadyQueued = 0
$failed = 0

foreach ($report in $reports) {
    $reportId = $report.report_id
    $unitName = $report.unit_name
    $year = $report.year
    
    Write-Host "[$reportId] $unitName ($year 年)" -NoNewline
    
    try {
        $result = curl -Method POST "http://localhost:8787/api/reports/$reportId/checks/run" | ConvertFrom-Json
        $total++
        
        if ($result.message -eq "checks_job_enqueued") {
            Write-Host " ✓ 已入队 (Job #$($result.job_id))" -ForegroundColor Green
            $succeeded++
        } elseif ($result.message -eq "checks_job_already_queued") {
            Write-Host " ⏸ 已在队列中" -ForegroundColor Yellow
            $alreadyQueued++
        } else {
            Write-Host " ⚠ 未知状态: $($result.message)" -ForegroundColor Yellow
        }
    } catch {
        Write-Host " ❌ 失败: $($_.Exception.Message)" -ForegroundColor Red
        $failed++
    }
    
    # 避免请求过快
    Start-Sleep -Milliseconds 200
}

Write-Host ""
Write-Host "=== 处理完成 ===" -ForegroundColor Cyan
Write-Host "总计: $total"
Write-Host "  ✓ 成功入队: $succeeded" -ForegroundColor Green
Write-Host "  ⏸ 已在队列: $alreadyQueued" -ForegroundColor Yellow
Write-Host "  ❌ 失败: $failed" -ForegroundColor Red
Write-Host ""
Write-Host "提示: 校验任务在后台运行，预计 $($succeeded * 5) 秒后完成全部处理" -ForegroundColor Cyan
Write-Host "可使用以下命令查看进度:" -ForegroundColor Cyan
Write-Host "  curl http://localhost:8787/api/reports | ConvertFrom-Json | Select-Object -ExpandProperty data | Where-Object { `$_.latest_job.status -eq 'running' }" -ForegroundColor Gray
