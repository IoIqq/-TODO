# AI Provider 使用指南

本项目支持多种 AI 供应商，可以轻松切换不同的 AI 服务。

---

## 🎯 支持的供应商

### 1. OpenAI（默认）
- 官方 OpenAI API
- 最稳定，功能最全
- 需要付费 API Key

### 2. Ollama（本地免费）
- 完全本地运行
- 无需 API Key
- 支持多种开源模型

### 3. LM Studio（本地免费）
- 本地运行
- 图形界面友好
- 支持多种模型

### 4. 其他 OpenAI 兼容接口
- Azure OpenAI
- 国内大模型（通义千问、文心一言等）
- 自建 API 服务

---

## 📝 配置方法

### 方式 1：使用 OpenAI

```env
AI_PROVIDER=openai
OPENAI_API_BASE_URL=https://api.openai.com/v1
OPENAI_API_KEY=sk-xxx
OPENAI_MODEL=gpt-4o-mini
```

**优点：**
- ✅ 稳定可靠
- ✅ 功能完整
- ✅ 响应快速

**缺点：**
- ❌ 需要付费
- ❌ 需要网络

---

### 方式 2：使用 Ollama（推荐本地使用）

**1. 安装 Ollama**
```bash
# Windows/Mac/Linux
# 访问 https://ollama.ai/ 下载安装
```

**2. 下载模型**
```bash
ollama pull llama2
# 或其他模型: qwen, mistral, codellama 等
```

**3. 配置**
```env
AI_PROVIDER=openai
OPENAI_API_BASE_URL=http://localhost:11434/v1
OPENAI_API_KEY=  # 留空
OPENAI_MODEL=llama2
```

**优点：**
- ✅ 完全免费
- ✅ 本地运行，隐私安全
- ✅ 无需网络

**缺点：**
- ❌ 需要较好的硬件
- ❌ 首次下载模型较大

---

### 方式 3：使用 LM Studio

**1. 安装 LM Studio**
```
访问 https://lmstudio.ai/ 下载安装
```

**2. 下载模型**
- 在 LM Studio 中搜索并下载模型
- 启动本地服务器

**3. 配置**
```env
AI_PROVIDER=openai
OPENAI_API_BASE_URL=http://localhost:1234/v1
OPENAI_API_KEY=  # 留空
OPENAI_MODEL=local-model
```

**优点：**
- ✅ 图形界面友好
- ✅ 本地运行
- ✅ 模型管理方便

---

### 方式 4：使用其他兼容接口

**Azure OpenAI：**
```env
AI_PROVIDER=openai
OPENAI_API_BASE_URL=https://your-resource.openai.azure.com/openai/deployments/your-deployment
OPENAI_API_KEY=your-azure-key
OPENAI_MODEL=gpt-4
```

**国内大模型（示例）：**
```env
AI_PROVIDER=openai
OPENAI_API_BASE_URL=https://api.example.com/v1
OPENAI_API_KEY=your-key
OPENAI_MODEL=qwen-turbo
```

---

## 🔧 功能对比

| 功能 | OpenAI | Ollama | LM Studio | 其他 |
|------|--------|--------|-----------|------|
| 文本解析 | ✅ | ✅ | ✅ | ✅ |
| 图片识别 | ✅ | ⚠️ | ⚠️ | ⚠️ |
| 智能优化 | ✅ | ✅ | ✅ | ✅ |
| 成本 | 付费 | 免费 | 免费 | 视情况 |
| 网络要求 | 需要 | 不需要 | 不需要 | 视情况 |
| 隐私 | 云端 | 本地 | 本地 | 视情况 |

⚠️ 图片识别需要支持 Vision 的模型

---

## 💡 推荐配置

### 个人使用（本地）
```env
# 使用 Ollama，完全免费
AI_PROVIDER=openai
OPENAI_API_BASE_URL=http://localhost:11434/v1
OPENAI_MODEL=llama2
ENABLE_AI_PARSE=true
ENABLE_IMAGE_RECOGNITION=false  # Ollama 不支持
```

### 团队使用（云端）
```env
# 使用 OpenAI，稳定可靠
AI_PROVIDER=openai
OPENAI_API_BASE_URL=https://api.openai.com/v1
OPENAI_API_KEY=sk-xxx
OPENAI_MODEL=gpt-4o-mini
ENABLE_AI_PARSE=true
ENABLE_IMAGE_RECOGNITION=true
```

### 企业使用（私有部署）
```env
# 使用自建 API 或 Azure
AI_PROVIDER=openai
OPENAI_API_BASE_URL=https://your-api.com/v1
OPENAI_API_KEY=your-key
OPENAI_MODEL=your-model
```

---

## 🚀 快速开始

### 1. 选择供应商
根据需求选择合适的 AI 供应商

### 2. 修改配置
编辑 `.env` 文件，填写对应配置

### 3. 重启服务
```bash
# 停止服务
双击"停止服务.bat"

# 启动服务
双击"一键启动.bat"
```

### 4. 测试
发送消息给机器人，测试 AI 功能是否正常

---

## 🔍 故障排查

### 问题 1：AI 功能不工作

**检查：**
1. 确认 `ENABLE_AI_PARSE=true`
2. 确认 API 配置正确
3. 查看服务日志

### 问题 2：Ollama 连接失败

**解决：**
1. 确认 Ollama 服务已启动
2. 检查端口是否正确（默认 11434）
3. 尝试访问 `http://localhost:11434/v1/models`

### 问题 3：模型响应慢

**优化：**
1. 使用更小的模型
2. 增加硬件资源
3. 切换到云端 API

---

## 📊 性能对比

### OpenAI
- **响应时间：** 1-3 秒
- **准确率：** ⭐⭐⭐⭐⭐
- **成本：** $$$

### Ollama (llama2)
- **响应时间：** 3-10 秒（取决于硬件）
- **准确率：** ⭐⭐⭐⭐
- **成本：** 免费

### LM Studio
- **响应时间：** 3-10 秒（取决于硬件）
- **准确率：** ⭐⭐⭐⭐
- **成本：** 免费

---

## 🎯 最佳实践

### 1. 开发环境
使用 Ollama 本地测试，节省成本

### 2. 生产环境
使用 OpenAI 或企业 API，保证稳定性

### 3. 混合使用
- 文本解析：使用本地模型
- 图片识别：使用 OpenAI

### 4. 成本优化
- 关闭不需要的 AI 功能
- 使用更便宜的模型
- 缓存常见结果

---

## 📞 技术支持

如有问题：
1. 查看日志：服务窗口
2. 检查配置：`.env` 文件
3. 参考文档：`README.md`、`AI_FEATURES.md`

---

## 🔮 未来计划

- [ ] 支持 Azure OpenAI Provider
- [ ] 支持 Claude Provider
- [ ] 支持国内大模型 Provider
- [ ] 支持模型自动切换
- [ ] 支持响应缓存

---

**祝使用愉快！** 🎉
