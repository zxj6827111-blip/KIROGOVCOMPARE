# ModelScope 模型名称参考

根据 ModelScope API 文档，常用模型名称格式如下：

## Qwen 系列
- `Qwen/Qwen3-235B-Instruct` ✓ 正确
- `Qwen/Qwen3-30B-Instruct` 
- `Qwen/Qwen2.5-72B-Instruct`

## GLM 系列
- `ZhipuAI/glm-4-plus` ✓ 正确（ModelScope上的GLM-4）
- `ZhipuAI/glm-4-9b`

## DeepSeek 系列
- `deepseek-ai/DeepSeek-V3`
- `deepseek-ai/DeepSeek-R1-Distill-Qwen-32B`

## 您当前的配置完全正确！

保存 .env 文件后，可以：

1. **启动服务测试**：
```bash
npm run dev
```

2. **上传测试文件**：
   - 进入上传页面
   - 选择一个政府报告文件
   - 上传后会自动跳转到任务中心

3. **验证配置生效**：
   - 查看任务详情页
   - "当前模型" 应显示：`Qwen/Qwen3-235B-Instruct`
   - 如果第1轮失败，第2轮会自动切换到 `ZhipuAI/glm-4-plus`

4. **查看日志**：
```bash
# 控制台应输出类似：
[ModelScope] Reading file: ..., Model: Qwen/Qwen3-235B-Instruct
```

配置完全正确，可以直接使用！🎉
