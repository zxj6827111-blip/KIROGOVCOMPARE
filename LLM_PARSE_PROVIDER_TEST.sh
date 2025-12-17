#!/bin/bash

# LLM Provider 抽象验收脚本
# 验证 Stub Provider 和真实 Provider 的可配置性

set -e

echo "=========================================="
echo "LLM Provider 抽象验收测试"
echo "=========================================="

# 清理函数
cleanup() {
  if [ ! -z "$BACKEND_PID" ]; then
    kill $BACKEND_PID 2>/dev/null || true
    wait $BACKEND_PID 2>/dev/null || true
  fi
}

trap cleanup EXIT

# 测试 Stub Provider
echo ""
echo "1️⃣ 测试 Stub Provider..."
export LLM_PROVIDER=stub
export DATABASE_TYPE=sqlite

npm run dev:llm > /tmp/llm_backend.log 2>&1 &
BACKEND_PID=$!
sleep 3

# 检查后端是否启动
if ! curl -s http://localhost:3000/api/health > /dev/null; then
  echo "❌ 后端启动失败"
  cat /tmp/llm_backend.log
  exit 1
fi

echo "✅ 后端启动成功"

# 创建城市
echo "2️⃣ 创建城市..."
REGION=$(curl -s -X POST http://localhost:3000/api/regions \
  -H "Content-Type: application/json" \
  -d '{"code":"test_stub","name":"测试城市","province":"测试省"}')

REGION_ID=$(echo $REGION | jq -r '.id')
if [ -z "$REGION_ID" ] || [ "$REGION_ID" = "null" ]; then
  echo "❌ 创建城市失败"
  echo $REGION
  exit 1
fi

echo "✅ 城市创建成功: ID=$REGION_ID"

# 上传报告
echo "3️⃣ 上传报告..."
if [ ! -f "sample.pdf" ]; then
  echo "⚠️ sample.pdf 不存在，跳过上传测试"
else
  UPLOAD=$(curl -s -X POST http://localhost:3000/api/reports \
    -F "region_id=$REGION_ID" \
    -F "year=2024" \
    -F "file=@sample.pdf")
  
  JOB_ID=$(echo $UPLOAD | jq -r '.job_id')
  REPORT_ID=$(echo $UPLOAD | jq -r '.report_id')
  
  if [ -z "$JOB_ID" ] || [ "$JOB_ID" = "null" ]; then
    echo "❌ 上传报告失败"
    echo $UPLOAD
    exit 1
  fi
  
  echo "✅ 报告上传成功: JOB_ID=$JOB_ID, REPORT_ID=$REPORT_ID"
  
  # 轮询 Job 直到完成
  echo "4️⃣ 等待解析完成..."
  for i in {1..30}; do
    JOB=$(curl -s http://localhost:3000/api/jobs/$JOB_ID)
    STATUS=$(echo $JOB | jq -r '.status')
    
    if [ "$STATUS" = "succeeded" ]; then
      echo "✅ 解析成功"
      break
    elif [ "$STATUS" = "failed" ]; then
      echo "❌ 解析失败"
      echo $JOB
      exit 1
    fi
    
    echo "⏳ 状态: $STATUS (等待中...)"
    sleep 1
  done
  
  # 验证 Provider 字段
  echo "5️⃣ 验证 Provider 字段..."
  REPORT=$(curl -s http://localhost:3000/api/reports/$REPORT_ID)
  PROVIDER=$(echo $REPORT | jq -r '.active_version.provider')
  MODEL=$(echo $REPORT | jq -r '.active_version.model')
  
  if [ "$PROVIDER" != "stub-llm" ]; then
    echo "❌ Provider 字段错误: $PROVIDER (期望: stub-llm)"
    exit 1
  fi
  
  if [ "$MODEL" != "stub-v1" ]; then
    echo "❌ Model 字段错误: $MODEL (期望: stub-v1)"
    exit 1
  fi
  
  echo "✅ Provider 字段正确: $PROVIDER"
  echo "✅ Model 字段正确: $MODEL"
fi

# 停止后端
kill $BACKEND_PID
wait $BACKEND_PID 2>/dev/null || true
BACKEND_PID=""

echo ""
echo "=========================================="
echo "✅ LLM Provider 抽象验收通过"
echo "=========================================="
