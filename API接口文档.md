# AI 自动化办公助手 API 文档

本文档描述 AI 自动化办公助手的 REST API 接口。所有接口均返回 JSON 格式数据。

**基础路径**：`/api`  
**默认端口**：`5001`  
**完整地址示例**：`http://localhost:5001/api`

---

## 目录

1. [会话管理](#1-会话管理)
2. [文件管理](#2-文件管理)
3. [消息管理](#3-消息管理)
4. [工作流执行](#4-工作流执行)
5. [模板管理](#5-模板管理)
6. [错误码说明](#6-错误码说明)

---

## 1. 会话管理

### 1.1 获取会话列表

**GET** `/api/sessions`

获取所有会话的列表。

#### 请求

无需参数。

#### 响应

**成功 200：**

```json
{
  "sessions": [
    {
      "id": "uuid-string",
      "name": "会话名称",
      "folder_name": "session_20260213_143022",
      "created_at": "2026-02-13T14:30:22.000Z",
      "workspace_path": "/path/to/workspace",
      "output_path": "/path/to/output",
      "messages": [],
      "name_generated": true
    }
  ]
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 会话唯一标识符（UUID） |
| `name` | string | 会话名称 |
| `folder_name` | string | 会话文件夹名称 |
| `created_at` | string | 创建时间（ISO 8601） |
| `workspace_path` | string | 工作区路径 |
| `output_path` | string | 输出区路径 |
| `messages` | array | 消息历史 |
| `name_generated` | boolean | 会话名称是否已生成 |

---

### 1.2 创建新会话

**POST** `/api/sessions`

创建一个新的会话。

#### 请求

| 方式 | 说明 |
|------|------|
| **Content-Type** | `application/json` |
| **Body** | JSON 对象 |

**Body 参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `user_input` | string | 否 | 用户输入（用于生成会话名称） |

**示例：**

```json
{
  "user_input": "批量处理员工信息表"
}
```

#### 响应

**成功 200：**

```json
{
  "session_id": "uuid-string",
  "session_name": "新建会话",
  "workspace_path": "/path/to/workspace",
  "output_path": "/path/to/output"
}
```

**错误 500：**

```json
{
  "error": "创建会话失败的原因"
}
```

---

### 1.3 删除会话

**DELETE** `/api/sessions/:session_id`

删除指定的会话及其所有文件。

#### 请求

| 方式 | 说明 |
|------|------|
| **Path** | `session_id`：会话 ID |

#### 响应

**成功 200：**

```json
{
  "success": true
}
```

---

## 2. 文件管理

### 2.1 获取会话文件列表

**GET** `/api/sessions/:session_id/files`

获取指定会话的工作区和输出区文件列表。

#### 请求

| 方式 | 说明 |
|------|------|
| **Path** | `session_id`：会话 ID |

#### 响应

**成功 200：**

```json
{
  "workspace": [
    {
      "filename": "员工信息.xlsx",
      "filepath": "员工信息.xlsx",
      "size": 12345,
      "modified": "2026-02-13T14:30:22.000Z"
    }
  ],
  "output": [
    {
      "filename": "处理结果.xlsx",
      "filepath": "处理结果.xlsx",
      "size": 23456,
      "modified": "2026-02-13T14:35:22.000Z"
    }
  ]
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `filename` | string | 文件名 |
| `filepath` | string | 相对路径 |
| `size` | number | 文件大小（字节） |
| `modified` | string | 修改时间（ISO 8601） |

---

### 2.2 上传文件

**POST** `/api/sessions/:session_id/upload`

上传文件到会话的工作区。

#### 请求

| 方式 | 说明 |
|------|------|
| **Content-Type** | `multipart/form-data` |
| **Path** | `session_id`：会话 ID |
| **Body** | FormData |

**FormData 参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `file` | File | 是 | 要上传的文件 |

**支持的文件类型：**
- Excel: `.xlsx`, `.xls`
- CSV: `.csv`
- Word: `.docx`, `.doc`
- PDF: `.pdf`
- 图片: `.png`, `.jpg`, `.jpeg`, `.gif`
- 文本: `.txt`

#### 响应

**成功 200：**

```json
{
  "success": true,
  "filename": "员工信息.xlsx"
}
```

**错误 400：**

```json
{
  "error": "会话不存在"
}
```

```json
{
  "error": "不支持的文件类型: .exe"
}
```

---

### 2.3 删除文件

**DELETE** `/api/sessions/:session_id/files/:filepath`

删除指定的文件。

#### 请求

| 方式 | 说明 |
|------|------|
| **Path** | `session_id`：会话 ID<br>`filepath`：文件路径（URL 编码） |

#### 响应

**成功 200：**

```json
{
  "success": true
}
```

---

### 2.4 下载文件

**GET** `/api/sessions/:session_id/files/:filepath`

下载指定的文件。

#### 请求

| 方式 | 说明 |
|------|------|
| **Path** | `session_id`：会话 ID<br>`filepath`：文件路径（如 `workspace/file.xlsx` 或 `output/result.xlsx`） |

#### 响应

**成功 200：**

返回文件二进制流，浏览器会自动下载。

**错误 404：**

```json
{
  "error": "文件不存在"
}
```

---

### 2.5 打开文件

**POST** `/api/sessions/:session_id/open/:filepath`

获取文件的绝对路径，用于在系统中打开文件（Electron 环境）。

#### 请求

| 方式 | 说明 |
|------|------|
| **Path** | `session_id`：会话 ID<br>`filepath`：文件路径（如 `workspace/file.xlsx`） |

#### 响应

**成功 200：**

```json
{
  "success": true,
  "file_path": "/absolute/path/to/file.xlsx"
}
```

**错误 404：**

```json
{
  "success": false,
  "error": "文件不存在"
}
```

---

## 3. 消息管理

### 3.1 获取消息历史

**GET** `/api/sessions/:session_id/messages`

获取指定会话的消息历史。

#### 请求

| 方式 | 说明 |
|------|------|
| **Path** | `session_id`：会话 ID |

#### 响应

**成功 200：**

```json
{
  "messages": [
    {
      "role": "user",
      "content": "批量填写员工信息表",
      "timestamp": "2026-02-13T14:30:22.000Z"
    },
    {
      "role": "assistant",
      "content": "任务已完成",
      "timestamp": "2026-02-13T14:35:22.000Z",
      "workflow_steps": [],
      "logs": [],
      "success": true
    }
  ]
}
```

**消息字段说明：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `role` | string | `user` 或 `assistant` |
| `content` | string | 消息内容 |
| `timestamp` | string | 时间戳（ISO 8601） |
| `workflow_steps` | array | 工作流步骤（仅 assistant） |
| `logs` | array | 执行日志（仅 assistant） |
| `success` | boolean | 是否成功（仅 assistant） |
| `generated_code` | string | 生成的代码（仅 assistant） |
| `task_description` | string | 任务描述（仅 assistant） |

---

### 3.2 添加消息

**POST** `/api/sessions/:session_id/messages`

向会话添加一条消息。

#### 请求

| 方式 | 说明 |
|------|------|
| **Content-Type** | `application/json` |
| **Path** | `session_id`：会话 ID |
| **Body** | JSON 对象 |

**Body 参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `message` | object | 是 | 消息对象 |

**message 对象：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `role` | string | 是 | `user` 或 `assistant` |
| `content` | string | 是 | 消息内容 |
| `timestamp` | string | 是 | 时间戳（ISO 8601） |

**示例：**

```json
{
  "message": {
    "role": "user",
    "content": "批量填写员工信息表",
    "timestamp": "2026-02-13T14:30:22.000Z"
  }
}
```

#### 响应

**成功 200：**

```json
{
  "success": true
}
```

---

### 3.3 清空消息历史

**DELETE** `/api/sessions/:session_id/messages`

清空指定会话的所有消息。

#### 请求

| 方式 | 说明 |
|------|------|
| **Path** | `session_id`：会话 ID |

#### 响应

**成功 200：**

```json
{
  "success": true
}
```

---

## 4. 工作流执行

### 4.1 提交工作流任务

**POST** `/api/sessions/:session_id/execute`

提交一个工作流任务到后台执行。

#### 请求

| 方式 | 说明 |
|------|------|
| **Content-Type** | `application/json` |
| **Path** | `session_id`：会话 ID |
| **Body** | JSON 对象 |

**Body 参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `user_input` | string | 是 | 用户需求描述 |

**示例：**

```json
{
  "user_input": "将员工信息表中的数据按部门分类，生成各部门的统计报表"
}
```

#### 响应

**成功 200：**

```json
{
  "success": true,
  "status": "executing",
  "message": "任务已提交，正在后台执行..."
}
```

**错误 400：**

```json
{
  "success": false,
  "error": "该会话正在执行中，请等待完成后再试"
}
```

---

### 4.2 查询执行状态

**GET** `/api/sessions/:session_id/status`

查询工作流的执行状态。

#### 请求

| 方式 | 说明 |
|------|------|
| **Path** | `session_id`：会话 ID |

#### 响应

**执行中：**

```json
{
  "status": "executing",
  "result": null,
  "error": null
}
```

**执行完成：**

```json
{
  "status": "completed",
  "result": {
    "success": true,
    "message": "任务执行成功",
    "workflow_steps": [
      {
        "module": "PM",
        "status": "completed",
        "output": "需求分析完成"
      },
      {
        "module": "Planner",
        "status": "completed",
        "output": "技术方案制定完成"
      },
      {
        "module": "Coder",
        "status": "completed",
        "output": "代码生成完成",
        "code": "#!/usr/bin/env python3\n..."
      },
      {
        "module": "Reviewer",
        "status": "completed",
        "output": "验收通过"
      }
    ],
    "logs": [
      {
        "step": "PM",
        "content": "分析用户需求...",
        "status": "info",
        "timestamp": "2026-02-13T14:30:22.000Z"
      }
    ],
    "generated_code": "#!/usr/bin/env python3\n...",
    "task_description": "数据分类统计",
    "session_name_updated": true,
    "session_name": "员工数据分类统计"
  },
  "error": null
}
```

**执行失败：**

```json
{
  "status": "error",
  "result": null,
  "error": "执行失败的原因"
}
```

**空闲状态：**

```json
{
  "status": "idle",
  "result": null,
  "error": null
}
```

**状态说明：**

| 状态 | 说明 |
|------|------|
| `idle` | 空闲，没有任务在执行 |
| `executing` | 正在执行中 |
| `completed` | 执行完成 |
| `error` | 执行出错 |

---

## 5. 模板管理

### 5.1 获取模板列表

**GET** `/api/templates`

获取所有可用的模板。

#### 请求

无需参数。

#### 响应

**成功 200：**

```json
{
  "templates": [
    {
      "id": "template-uuid",
      "task_description": "员工信息批量填写",
      "code": "#!/usr/bin/env python3\n...",
      "file_info": [
        {
          "name": "员工信息模板.xlsx",
          "size": 12345,
          "extension": ".xlsx"
        }
      ],
      "output_files": [
        {
          "name": "填写结果.xlsx",
          "size": 23456
        }
      ],
      "usage_count": 5,
      "last_used": "2026-02-13T14:30:22.000Z",
      "created_at": "2026-02-10T10:00:00.000Z"
    }
  ]
}
```

---

### 5.2 获取模板详情

**GET** `/api/templates/:template_id`

获取指定模板的详细信息。

#### 请求

| 方式 | 说明 |
|------|------|
| **Path** | `template_id`：模板 ID |

#### 响应

**成功 200：**

```json
{
  "id": "template-uuid",
  "task_description": "员工信息批量填写",
  "code": "#!/usr/bin/env python3\n...",
  "file_info": [],
  "output_files": [],
  "usage_count": 5,
  "last_used": "2026-02-13T14:30:22.000Z",
  "created_at": "2026-02-10T10:00:00.000Z"
}
```

**错误 404：**

```json
{
  "error": "模板不存在"
}
```

---

### 5.3 删除模板

**DELETE** `/api/templates/:template_id`

删除指定的模板。

#### 请求

| 方式 | 说明 |
|------|------|
| **Path** | `template_id`：模板 ID |

#### 响应

**成功 200：**

```json
{
  "success": true
}
```

---

### 5.4 保存为模板

**POST** `/api/sessions/:session_id/save-template`

将成功执行的任务保存为模板。

#### 请求

| 方式 | 说明 |
|------|------|
| **Content-Type** | `application/json` |
| **Path** | `session_id`：会话 ID |
| **Body** | JSON 对象 |

**Body 参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `task_description` | string | 是 | 任务描述 |
| `code` | string | 是 | 生成的代码 |
| `file_info` | array | 是 | 输入文件信息 |
| `output_files` | array | 是 | 输出文件信息 |

**示例：**

```json
{
  "task_description": "员工信息批量填写",
  "code": "#!/usr/bin/env python3\n...",
  "file_info": [
    {
      "filename": "员工信息模板.xlsx",
      "size": 12345
    }
  ],
  "output_files": [
    {
      "filename": "填写结果.xlsx",
      "size": 23456
    }
  ]
}
```

#### 响应

**成功 200：**

```json
{
  "success": true,
  "template_id": "template-uuid",
  "message": "模板保存成功"
}
```

**错误 500：**

```json
{
  "success": false,
  "error": "保存失败的原因"
}
```

---

### 5.5 执行模板

**POST** `/api/templates/:template_id/execute`

使用模板执行任务。

#### 请求

| 方式 | 说明 |
|------|------|
| **Content-Type** | `application/json` |
| **Path** | `template_id`：模板 ID |
| **Body** | JSON 对象 |

**Body 参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `session_id` | string | 是 | 会话 ID |

**示例：**

```json
{
  "session_id": "session-uuid"
}
```

#### 响应

**成功 200：**

```json
{
  "success": true,
  "output": "执行输出",
  "message": "模板执行成功",
  "session_name_updated": true,
  "session_name": "员工信息批量填写"
}
```

**错误 404：**

```json
{
  "success": false,
  "error": "模板不存在"
}
```

**错误 400：**

```json
{
  "success": false,
  "error": "当前会话没有上传文件，请先上传文件"
}
```

```json
{
  "success": false,
  "error": "文件不兼容: 文件类型不匹配",
  "details": {
    "compatible": false,
    "reason": "文件类型不匹配"
  }
}
```

---

### 5.6 添加模板标签

**POST** `/api/templates/:template_id/tags`

为模板添加标签。

#### 请求

| 方式 | 说明 |
|------|------|
| **Content-Type** | `application/json` |
| **Path** | `template_id`：模板 ID |
| **Body** | JSON 对象 |

**Body 参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `tags` | array | 是 | 标签数组 |

**示例：**

```json
{
  "tags": ["数据处理", "Excel", "批量操作"]
}
```

#### 响应

**成功 200：**

```json
{
  "success": true
}
```

---

### 5.7 检查相似模板

**POST** `/api/sessions/:session_id/check-similar`

检查是否有相似的可复用模板。

#### 请求

| 方式 | 说明 |
|------|------|
| **Content-Type** | `application/json` |
| **Path** | `session_id`：会话 ID |
| **Body** | JSON 对象 |

**Body 参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `user_input` | string | 是 | 用户需求描述 |

**示例：**

```json
{
  "user_input": "批量填写员工信息"
}
```

#### 响应

**成功 200：**

```json
{
  "success": true,
  "has_similar": true,
  "similar_templates": [
    {
      "id": "template-uuid",
      "task_description": "员工信息批量填写",
      "similarity": 0.85,
      "usage_count": 5
    }
  ]
}
```

---

## 6. 错误码说明

### HTTP 状态码

| 状态码 | 说明 |
|--------|------|
| 200 | 请求成功 |
| 400 | 请求参数错误 |
| 404 | 资源不存在 |
| 500 | 服务器内部错误 |

### 错误响应格式

所有错误响应均为以下格式：

```json
{
  "error": "错误描述信息"
}
```

或包含更多详情：

```json
{
  "success": false,
  "error": "错误描述信息",
  "details": {
    "field": "具体错误字段",
    "reason": "详细原因"
  }
}
```

---

## 7. 使用示例

### 完整工作流示例

以下是一个完整的使用流程示例：

```javascript
// 1. 创建会话
const createResponse = await fetch('http://localhost:5001/api/sessions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ user_input: '批量处理员工信息' })
});
const { session_id } = await createResponse.json();

// 2. 上传文件
const formData = new FormData();
formData.append('file', fileInput.files[0]);
await fetch(`http://localhost:5001/api/sessions/${session_id}/upload`, {
  method: 'POST',
  body: formData
});

// 3. 提交任务
await fetch(`http://localhost:5001/api/sessions/${session_id}/execute`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ 
    user_input: '将员工信息按部门分类统计' 
  })
});

// 4. 轮询状态
const checkStatus = async () => {
  const response = await fetch(
    `http://localhost:5001/api/sessions/${session_id}/status`
  );
  const { status, result } = await response.json();
  
  if (status === 'completed') {
    console.log('任务完成:', result);
    return true;
  } else if (status === 'error') {
    console.error('任务失败:', result);
    return true;
  }
  return false;
};

const interval = setInterval(async () => {
  const done = await checkStatus();
  if (done) clearInterval(interval);
}, 1000);

// 5. 下载结果文件
// 在浏览器中直接访问：
// http://localhost:5001/api/sessions/${session_id}/files/output/result.xlsx
```

---

## 8. 注意事项

1. **文件上传限制**：
   - 支持的文件类型有限，详见 [2.2 上传文件](#22-上传文件)
   - 建议单个文件不超过 50MB

2. **并发执行**：
   - 同一会话同时只能执行一个任务
   - 不同会话可以并发执行（最多 10 个）

3. **轮询频率**：
   - 建议每秒轮询一次执行状态
   - 避免过于频繁的请求

4. **会话管理**：
   - 会话数据存储在本地文件系统
   - 删除会话会同时删除所有相关文件

5. **模板兼容性**：
   - 执行模板前需确保上传的文件类型与模板要求一致
   - 系统会自动检查文件兼容性

---

## 9. 技术支持

如有问题或建议，请参考：
- 项目文档：`README.md`
- 启动步骤：`启动步骤.md`
- 配置说明：`backend/config.example.md`

---

**版本**：v1.0.0  
**更新时间**：2026-02-13

