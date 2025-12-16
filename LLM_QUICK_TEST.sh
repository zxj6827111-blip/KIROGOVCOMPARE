#!/bin/bash

# LLM 解析与入库系统 - 快速测试脚本
# 用法: bash LLM_QUICK_TEST.sh

echo "🚀 LLM 解析与入库系统 - 快速测试"
echo "=================================="
echo ""

# 颜色定义
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 测试计数
PASSED=0
FAILED=0

# 测试函数
test_api() {
    local name=$1
    local method=$2
    local url=$3
    local data=$4
    
    echo -n "测试: $name ... "
    
    if [ "$method" = "GET" ]; then
        response=$(curl -s "$url")
    else
        response=$(curl -s -X "$method" "$url" -H "Content-Type: application/json" -d "$data")
    fi
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ 通过${NC}"
        echo "  响应: $response"
        ((PASSED++))
    else
        echo -e "${RED}❌ 失败${NC}"
        ((FAILED++))
    fi
    echo ""
}

# 1. 健康检查
echo -e "${YELLOW}1. 健康检查${NC}"
test_api "健康检查" "GET" "http://localhost:3000/api/health"

# 2. 根路由
echo -e "${YELLOW}2. 根路由${NC}"
test_api "根路由" "GET" "http://localhost:3000/"

# 3. 创建城市
echo -e "${YELLOW}3. 创建城市${NC}"
test_api "创建城市" "POST" "http://localhost:3000/api/regions" \
    '{"code":"huangpu","name":"黄浦区","province":"上海市"}'

# 4. 获取城市列表
echo -e "${YELLOW}4. 获取城市列表${NC}"
test_api "获取城市列表" "GET" "http://localhost:3000/api/regions"

# 5. 获取城市详情
echo -e "${YELLOW}5. 获取城市详情${NC}"
test_api "获取城市详情" "GET" "http://localhost:3000/api/regions/1"

# 6. 测试重复创建（应返回 409）
echo -e "${YELLOW}6. 测试重复创建（应返回 409）${NC}"
echo -n "测试: 重复创建城市 ... "
response=$(curl -s -X POST "http://localhost:3000/api/regions" \
    -H "Content-Type: application/json" \
    -d '{"code":"huangpu","name":"黄浦区2","province":"上海市"}')
if echo "$response" | grep -q "error"; then
    echo -e "${GREEN}✅ 通过${NC}"
    echo "  响应: $response"
    ((PASSED++))
else
    echo -e "${RED}❌ 失败${NC}"
    ((FAILED++))
fi
echo ""

# 总结
echo "=================================="
echo -e "测试结果: ${GREEN}✅ 通过: $PASSED${NC} | ${RED}❌ 失败: $FAILED${NC}"
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}🎉 所有测试通过！${NC}"
    exit 0
else
    echo -e "${RED}⚠️  有测试失败${NC}"
    exit 1
fi
