# Emergency Planner API 使用文档

本文档描述 REST API 的请求/响应格式。所有接口均返回 JSON（除特别说明外）。  
基础路径：`/api/rest/v1`（如部署在 `https://example.com`，则完整基址为 `https://example.com/api/rest/v1`）。

---

## 认证说明

- **应用级接口**（组织、成员、任务等）：需先调用 `POST /api/rest/v1/auth/token` 获取 accessToken，之后在请求头中携带：  
  `Authorization: Bearer <accessToken>`
- **管理端接口**（`/api/rest/v1/admin/*`）：需已登录且为 **admin** 用户（使用 Session/Cookie 认证）。

---

## 1. 获取应用 Access Token

**POST** `/api/rest/v1/auth/token`

用于使用 clientId + clientSecret 换取 Bearer Token，供后续 REST 调用使用。

### 请求

| 方式 | 说明 |
|------|------|
| **Content-Type** | `application/json` |
| **Body** | JSON 对象 |

**Body 参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `clientId` | string | 是 | 应用 Client ID |
| `clientSecret` | string | 是 | 应用 Client Secret |

**示例：**

```json
{
  "clientId": "your-client-id",
  "clientSecret": "your-client-secret"
}
```

### 响应

**成功 200：**

```json
{
  "tokenType": "Bearer",
  "accessToken": "eyJ...",
  "expiresIn": 3600,
  "orgId": 1,
  "appId": "your-client-id",
  "scopes": ["read", "write"]
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `tokenType` | string | 固定 `"Bearer"` |
| `accessToken` | string | JWT，请求时放在 `Authorization: Bearer <accessToken>` |
| `expiresIn` | number | 过期时间（秒） |
| `orgId` | number | 组织 ID，Token 仅对该组织有效 |
| `appId` | string | 应用 clientId |
| `scopes` | string[] | 权限列表 |

**错误：**

- **400**：缺少参数  
  `{ "error": "clientId and clientSecret are required" }`
- **401**：凭证无效或应用未激活  
  `{ "error": "Invalid credentials" }`

---

## 2. 系统限流信息

**GET** `/api/rest/v1/system/limits`

无需认证，返回全局限流配置说明。

### 请求

无请求体，无必填参数。

### 响应

**成功 200：**

```json
{
  "globalRateLimit": {
    "max": 1200,
    "timeWindow": "1 minute"
  },
  "notes": "Per-route rate limits are configurable via Fastify route config."
}
```

---

## 3. 组织成员列表（需 Bearer Token）

**GET** `/api/rest/v1/orgs/:orgId/members`

### 请求

| 方式 | 说明 |
|------|------|
| **Header** | `Authorization: Bearer <accessToken>`（Token 的 orgId 必须等于 `orgId`） |
| **Path** | `orgId`：组织 ID（正整数） |

### 响应

**成功 200：**

```json
{
  "members": [
    {
      "id": 1,
      "organizationId": 1,
      "userId": 10,
      "role": "member",
      "createdAt": "2025-01-01T00:00:00.000Z"
    }
  ]
}
```

`members` 中每项字段：`id`（成员记录 ID）、`organizationId`、`userId`、`role`（`owner` | `admin` | `member`）、`createdAt`（ISO 8601）。

**错误：**

- **400**：`{ "error": "Invalid organization id" }`
- **401**：`{ "error": "Missing Bearer token" }` 或 `{ "error": "Invalid token" }`
- **403**：`{ "error": "Organization mismatch" }`

---

## 4. 获取任务列表（需 Bearer Token）

**GET** `/api/rest/v1/orgs/:orgId/tasks`

### 请求

| 方式 | 说明 |
|------|------|
| **Header** | `Authorization: Bearer <accessToken>` |
| **Path** | `orgId`：组织 ID |
| **Query** | 见下表 |

**Query 参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `userId` | number | 是 | 用户 ID（必须是该组织成员） |
| `startDate` | string | 否 | ISO 日期/时间，筛选起始时间 |
| `endDate` | string | 否 | ISO 日期/时间，筛选结束时间（与 startDate 成对使用） |
| `status` | string | 否 | 筛选状态：`pending` \| `in_progress` \| `completed` \| `cancelled` |

示例：`/api/rest/v1/orgs/1/tasks?userId=10&status=completed`

### 响应

**成功 200：**

```json
{
  "tasks": [
    {
      "id": 1,
      "userId": 10,
      "projectId": null,
      "title": "任务标题",
      "description": null,
      "startTime": "2025-02-01T09:00:00.000Z",
      "endTime": "2025-02-01T10:00:00.000Z",
      "weight": 5,
      "status": "pending",
      "isCompleted": false,
      "completionNotes": null,
      "completionPercentage": 0,
      "aiSuggestion": null,
      "category": null,
      "tagsJson": null,
      "deadline": null,
      "isUrgent": false,
      "parentTaskId": null,
      "sortOrder": 0,
      "createdAt": "2025-02-01T08:00:00.000Z",
      "updatedAt": "2025-02-01T08:00:00.000Z"
    }
  ]
}
```

时间字段均为 ISO 8601 字符串。`status` 枚举同上。

**错误：**

- **400**：`{ "error": "Invalid organization id" }` 或 `{ "error": "userId is required" }`
- **403**：`{ "error": "User not in organization" }`
- **401**：Token 缺失或无效

---

## 5. 批量创建任务（需 Bearer Token）

**POST** `/api/rest/v1/orgs/:orgId/tasks`

### 请求

| 方式 | 说明 |
|------|------|
| **Header** | `Authorization: Bearer <accessToken>` |
| **Content-Type** | `application/json` |
| **Path** | `orgId`：组织 ID |
| **Body** | JSON，见下表 |

**Body 参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `userId` | number | 是 | 用户 ID（须为该组织成员） |
| `tasks` | array | 是 | 任务对象数组，见下表 |

**tasks[] 单条：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `title` | string | 是 | 标题（非空） |
| `startTime` | string | 是 | ISO 日期时间 |
| `endTime` | string | 是 | ISO 日期时间 |
| `description` | string | 否 | 描述 |
| `weight` | number | 否 | 默认 5 |
| `isUrgent` | boolean | 否 | 默认 false |
| `category` | string | 否 | 分类 |
| `deadline` | string | 否 | ISO 日期时间 |
| `aiSuggestion` | string | 否 | AI 建议备注 |

**示例：**

```json
{
  "userId": 10,
  "tasks": [
    {
      "title": "开会",
      "startTime": "2025-02-06T14:00:00.000Z",
      "endTime": "2025-02-06T15:00:00.000Z",
      "description": "周会",
      "weight": 5,
      "isUrgent": false
    }
  ]
}
```

### 响应

**成功 200：**

返回实际创建成功的任务完整对象数组（与数据库一致，含 `id`、`createdAt`、`updatedAt` 等）：

```json
{
  "tasks": [
    {
      "id": 101,
      "userId": 10,
      "projectId": null,
      "title": "开会",
      "description": "周会",
      "startTime": "2025-02-06T14:00:00.000Z",
      "endTime": "2025-02-06T15:00:00.000Z",
      "weight": 5,
      "status": "pending",
      "isCompleted": false,
      "completionNotes": null,
      "completionPercentage": 0,
      "aiSuggestion": null,
      "category": null,
      "tagsJson": null,
      "deadline": null,
      "isUrgent": false,
      "parentTaskId": null,
      "sortOrder": 0,
      "createdAt": "2025-02-06T12:00:00.000Z",
      "updatedAt": "2025-02-06T12:00:00.000Z"
    }
  ]
}
```

单条中缺少 `title`/`startTime`/`endTime` 的会被跳过，不会报错，但不会出现在返回的 `tasks` 中。

**错误：**

- **400**：`{ "error": "userId is required" }` 或 `{ "error": "tasks array is required" }`
- **403**：`{ "error": "User not in organization" }`

---

## 6. 更新任务（需 Bearer Token）

**PATCH** `/api/rest/v1/orgs/:orgId/tasks/:id`

### 请求

| 方式 | 说明 |
|------|------|
| **Header** | `Authorization: Bearer <accessToken>` |
| **Content-Type** | `application/json` |
| **Path** | `orgId`：组织 ID；`id`：任务 ID |
| **Body** | JSON，仅需传要更新的字段 |

**Body 可选字段（均为可选）：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `userId` | number | 必填（用于校验归属），须为该组织成员且任务属于该用户 |
| `title` | string | 标题 |
| `description` | string | 描述 |
| `startTime` | string | ISO 日期时间 |
| `endTime` | string | ISO 日期时间 |
| `weight` | number | 权重 |
| `status` | string | `pending` \| `in_progress` \| `completed` \| `cancelled` |
| `isUrgent` | boolean | 是否紧急 |
| `isCompleted` | boolean | 是否已完成 |
| `completionNotes` | string | 完成备注 |
| `completionPercentage` | number | 完成百分比 |

**示例：**

```json
{
  "userId": 10,
  "status": "completed",
  "isCompleted": true,
  "completionNotes": "已完成"
}
```

### 响应

**成功 200：**

```json
{
  "task": {
    "id": 101,
    "userId": 10,
    "projectId": null,
    "title": "开会",
    "description": "周会",
    "startTime": "2025-02-06T14:00:00.000Z",
    "endTime": "2025-02-06T15:00:00.000Z",
    "weight": 5,
    "status": "completed",
    "isCompleted": true,
    "completionNotes": "已完成",
    "completionPercentage": 0,
    "aiSuggestion": null,
    "category": null,
    "tagsJson": null,
    "deadline": null,
    "isUrgent": false,
    "parentTaskId": null,
    "sortOrder": 0,
    "createdAt": "2025-02-06T12:00:00.000Z",
    "updatedAt": "2025-02-06T13:00:00.000Z"
  }
}
```

**错误：**

- **400**：`{ "error": "Invalid request" }` 或 `{ "error": "userId is required" }`
- **403**：`{ "error": "User not in organization" }`
- **404**：`{ "error": "Task not found" }`
- **500**：`{ "error": "Failed to update task" }`

---

## 7. 删除任务（需 Bearer Token）

**DELETE** `/api/rest/v1/orgs/:orgId/tasks/:id`

### 请求

| 方式 | 说明 |
|------|------|
| **Header** | `Authorization: Bearer <accessToken>` |
| **Path** | `orgId`：组织 ID；`id`：任务 ID |
| **Query** | `userId`（number，必填）：用于校验任务归属，须为该组织成员 |

示例：`DELETE /api/rest/v1/orgs/1/tasks/101?userId=10`

### 响应

**成功 200：**

```json
{
  "success": true
}
```

**错误：**

- **400**：`{ "error": "Invalid request" }` 或 `{ "error": "userId is required" }`
- **403**：`{ "error": "User not in organization" }`
- **404**：`{ "error": "Task not found" }`

---

## 8. 管理端：组织列表（需 Admin Session）

**GET** `/api/rest/v1/admin/orgs`

需已登录且用户角色为 **admin**（Cookie/Session）。

### 请求

无 Body，无必填 Query。

### 响应

**成功 200：**

```json
{
  "organizations": [
    {
      "id": 1,
      "name": "默认组织",
      "slug": "default",
      "isDefault": true,
      "createdAt": "2025-01-01T00:00:00.000Z",
      "updatedAt": "2025-01-01T00:00:00.000Z"
    }
  ]
}
```

**错误：** **401** `{ "error": "Unauthorized" }`；**403** `{ "error": "Admin role required" }`

---

## 9. 管理端：组织下应用列表（需 Admin Session）

**GET** `/api/rest/v1/admin/orgs/:orgId/apps`

### 请求

| 方式 | 说明 |
|------|------|
| **Path** | `orgId`：组织 ID |

### 响应

**成功 200：**

```json
{
  "apps": [
    {
      "id": 1,
      "name": "我的应用",
      "clientId": "abc123...",
      "isActive": true,
      "scopes": ["read", "write"],
      "lastUsedAt": "2025-02-06T10:00:00.000Z",
      "createdAt": "2025-01-01T00:00:00.000Z"
    }
  ]
}
```

**错误：** **400** `{ "error": "Invalid organization id" }`；**401/403** 同上。

---

## 10. 管理端：创建组织应用（需 Admin Session）

**POST** `/api/rest/v1/admin/orgs/:orgId/apps`

创建应用并返回 **clientSecret**（仅此一次，请妥善保存）。

### 请求

| 方式 | 说明 |
|------|------|
| **Content-Type** | `application/json` |
| **Path** | `orgId`：组织 ID |
| **Body** | 见下表 |

**Body：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | 是 | 应用名称 |
| `scopes` | string[] | 否 | 权限列表，如 `["read","write"]` |

**示例：**

```json
{
  "name": "我的集成",
  "scopes": ["read", "write"]
}
```

### 响应

**成功 200：**

```json
{
  "app": {
    "id": 1,
    "name": "我的集成",
    "clientId": "generated-client-id",
    "scopes": ["read", "write"]
  },
  "clientSecret": "generated-secret-only-once",
  "warning": "This secret is shown only once. Store it securely."
}
```

**错误：** **400** `{ "error": "name is required" }`；**401/403** 同上。

---

## 11. 管理端：轮换应用密钥（需 Admin Session）

**POST** `/api/rest/v1/admin/orgs/:orgId/apps/:appId/rotate-secret`

轮换指定应用的 clientSecret；新 secret 仅在本次响应中返回一次。

### 请求

| 方式 | 说明 |
|------|------|
| **Path** | `orgId`：组织 ID；`appId`：应用 **数据库主键 id**（非 clientId） |

无 Body。

### 响应

**成功 200：**

```json
{
  "appId": 1,
  "clientId": "existing-client-id",
  "clientSecret": "new-secret-only-once",
  "warning": "This secret is shown only once. Store it securely."
}
```

**错误：** **400** `{ "error": "Invalid request" }`；**404** `{ "error": "App not found" }`；**401/403** 同上。

---

## 12. OAuth 回调（浏览器重定向）

**GET** `/api/oauth/callback`

由 OAuth 提供商在登录成功后重定向到此地址，并携带 `code` 与 `state`。  
正常流程会设置 Session Cookie 并 **302 重定向到 `/`**。  
本接口不面向第三方 API 调用，仅用于 Web 登录流程。

**Query：** `code`（string）、`state`（string），均由 OAuth 提供方传入。

**错误响应：** **400** `{ "error": "code and state are required" }` 或 `{ "error": "openId missing from user info" }`；**500** `{ "error": "OAuth callback failed" }`。

---

## 通用说明

- **时间格式**：请求/响应中的日期时间均为 **ISO 8601** 字符串（如 `2025-02-06T14:00:00.000Z`）。
- **错误体**：错误时 HTTP 状态码为 4xx/5xx，Body 为 `{ "error": "错误信息" }`。
- **限流**：`/auth/token` 为 20 次/分钟；其余见 `GET /api/rest/v1/system/limits`。超过限流会返回 429（由 Fastify 处理）。

如需 tRPC 接口说明（如前端使用的 `auth.me`、`task.*`、`planner.*` 等），可另见 tRPC 路由与 schema 定义。
