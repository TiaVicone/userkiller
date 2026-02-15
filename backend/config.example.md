# 配置文件示例

请复制此文件为 `config.json` 并填入您的API密钥。

```json
{
  "deepseek_api_key": "sk-xxxxxxxxxxxxxxxx",
  "deepseek_base_url": "https://api.deepseek.com",
  "qianwen_api_key": "sk-xxxxxxxxxxxxxxxx",
  "qianwen_base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
  "max_iterations": 5,
  "workspace_root": "./workspaces"
}
```

## 配置说明

### deepseek_api_key
- **必填**
- DeepSeek API密钥
- 获取地址：https://platform.deepseek.com/

### deepseek_base_url
- **必填**
- DeepSeek API基础URL
- 默认值：`https://api.deepseek.com`

### qianwen_api_key
- **可选**
- 千问OCR API密钥（用于图片和PDF文字识别）
- 获取地址：https://dashscope.aliyun.com/
- 如果不配置，图片文件将无法进行OCR识别

### qianwen_base_url
- **可选**
- 千问API基础URL（使用OpenAI兼容接口）
- 默认值：`https://dashscope.aliyuncs.com/compatible-mode/v1`
- 其他地域：
  - 新加坡：`https://dashscope-intl.aliyuncs.com/compatible-mode/v1`
  - 弗吉尼亚：`https://dashscope-us.aliyuncs.com/compatible-mode/v1`
  - 北京：`https://dashscope.aliyuncs.com/compatible-mode/v1`

### max_iterations
- **必填**
- Coder和验收员之间的最大迭代次数
- 推荐值：5
- 范围：1-10

### workspace_root
- **必填**
- 工作区根目录路径
- 默认值：`./workspaces`
- 可以使用相对路径或绝对路径

## 千问OCR模型说明

本系统使用千问最新的OCR专用模型：`qwen-vl-ocr-2025-11-20`

特点：
- 高精度文字识别
- 支持多种语言
- 自动处理模糊和强光遮挡
- 保持原有格式和结构
