# 执行流程问题分析报告

## 问题现象

用户输入指令后，前端只显示一步执行内容就结束，完全看不到后续的执行过程。

## 根本原因

**后端在工具执行后不再更新 `session.result`，导致前端轮询拿不到新的 workflowSteps 和 logs。**

---

## 完整执行流程追踪

### 1. 用户发送指令

```
POST /api/sessions/:id/execute
  ↓
启动异步任务 runQueryEngine()
  ↓
立即返回 { success: true }
```

### 2. 初始化阶段（第 349 行）

```typescript
await updateSessionStatus(request.sessionId, 'executing', {
  stopRequested: false,
  taskStage: currentStage,
  deliverablePlan,
  taskState,
})
```

**此时没有传 `result` 参数** → `session.result` 保持为 `undefined`

### 3. Agent 循环开始

#### 第 1 轮 - Decision（第 480 行）

```typescript
await updateSessionStatus(request.sessionId, 'executing', {
  stopRequested: false,
  taskStage: currentStage,
  deliverablePlan: refreshedDeliverablePlan,
  taskState,
  result: {
    success: false,
    stopReason: 'max_turns',
    message: assistantMessage,
    workflowSteps: workflowSteps.slice(-6),  // ✅ 包含 Decision 1
    logs: logs.slice(-8),                     // ✅ 包含决策日志
    generatedCode: undefined,
    taskDescription: request.userInput,
    contextRecords: [],
    toolCalls: [],
    taskStage: currentStage,
    deliverablePlan: refreshedDeliverablePlan,
    taskState,
  },
})
```

**此时前端轮询可以看到：**
- `progress.workflow_steps`: `["Decision 1"]`
- `progress.logs`: `["第 1 轮决策：observe_workspace"]`

前端解析后显示：
```
📂 扫描工作区文件
```

#### 第 1 轮 - 工具执行（第 551 行）

```typescript
// 执行 observe_workspace 工具
const result = await executeTool(...)

// 更新 workflowSteps 和 logs 数组
workflowSteps.push({
  module: `Agent Loop 1`,
  status: 'running',
  output: `动作：observe_workspace\n结果：已扫描 3 个文件`,
})

// ❌ 问题：这里只更新了 taskStage，没有传 result
await updateSessionStatus(request.sessionId, 'executing', {
  stopRequested: false,
  taskStage: currentStage,
  deliverablePlan: refreshedDeliverablePlan,
  taskState,
  // ❌ 缺少 result 参数！
})
```

**此时 `session.result` 仍然是上一次（Decision 阶段）的数据：**
- `session.result.workflowSteps`: `["Decision 1"]`  ← 没有 "Agent Loop 1"
- `session.result.logs`: 只有决策日志，没有执行日志

**前端轮询拿到的仍然是：**
```
progress.workflow_steps: ["Decision 1"]
progress.logs: ["第 1 轮决策：observe_workspace"]
```

前端界面**不会更新**，因为 `prevStepCount` 和 `prevLogCount` 没有变化。

#### 第 2 轮 - Decision

```typescript
// 又一次 Decision，会更新 result
await updateSessionStatus(request.sessionId, 'executing', {
  result: {
    workflowSteps: workflowSteps.slice(-6),  // 现在包含 ["Decision 1", "Agent Loop 1", "Decision 2"]
    logs: logs.slice(-8),
    ...
  },
})
```

**前端此时才能看到 "Agent Loop 1" 的内容，但已经晚了一个轮次。**

---

## 问题根源总结

### 当前代码的更新策略

| 时机 | 是否传 `result` | 前端能否看到新步骤 |
|---|---|---|
| **初始化** | ❌ 否 | 否（无数据） |
| **Decision 后** | ✅ 是 | 是（包含 Decision N） |
| **工具执行后** | ❌ 否 | **否（数据未更新）** |

### 数据流断裂点

```
Agent 循环内部：
  logs.push(...)           ← 内存中的数组更新了
  workflowSteps.push(...)  ← 内存中的数组更新了
    ↓
  updateSessionStatus(...) ← ❌ 但没有把新数组写入 session.result
    ↓
  saveSession(session)     ← 保存的 session.result 仍是旧数据
    ↓
前端轮询 GET /status
    ↓
  session.result.workflowSteps  ← 拿到的是旧数据
  session.result.logs           ← 拿到的是旧数据
```

### 为什么只看到一步？

1. **第 1 轮 Decision** → 前端看到 "📂 扫描工作区文件"（Decision 步骤）
2. **第 1 轮工具执行** → ❌ 前端看不到（result 未更新）
3. **第 2 轮 Decision** → 前端看到 "Agent Loop 1" 的内容，但此时已经在执行第 2 轮了
4. **第 2 轮工具执行** → ❌ 前端看不到
5. **第 3 轮 Decision** → 前端看到 "Agent Loop 2" 的内容
6. ...

**用户感知：只看到 Decision 步骤，看不到实际的工具执行步骤，且总是滞后一轮。**

---

## 为什么之前的性能优化加剧了这个问题

### 优化前（有问题但不明显）

```typescript
// Decision 后
await updateSessionStatus(request.sessionId, 'executing', {
  result: {
    workflowSteps,  // 完整数组
    logs,           // 完整数组
    contextRecords, // 完整数组
    toolCalls,      // 完整数组
    ...
  },
})

// 工具执行后
await updateSessionStatus(request.sessionId, 'executing', {
  result: {
    workflowSteps,  // 完整数组（包含新步骤）
    logs,           // 完整数组（包含新日志）
    contextRecords,
    toolCalls,
    ...
  },
})
```

**虽然每次都传完整数组很浪费，但至少前端能看到最新数据。**

### 优化后（问题暴露）

```typescript
// Decision 后
await updateSessionStatus(request.sessionId, 'executing', {
  result: {
    workflowSteps: workflowSteps.slice(-6),  // 只传最近 6 条
    logs: logs.slice(-8),                     // 只传最近 8 条
    contextRecords: [],                       // 空数组
    toolCalls: [],                            // 空数组
    ...
  },
})

// 工具执行后
await updateSessionStatus(request.sessionId, 'executing', {
  // ❌ 完全不传 result
})
```

**为了减少序列化开销，工具执行后不再传 result，导致前端完全看不到新步骤。**

---

## 影响范围

### 前端表现

1. **Timeline 只显示 Decision 步骤**，看不到实际的工具执行（读文件、写文件、生成报告等）
2. **进度滞后一轮**，用户看到的永远是上一轮的内容
3. **"思考中..." 动画不出现**，因为最后一个步骤的 status 总是 'completed'（Decision 已完成）
4. **用户体验极差**，完全不知道 Agent 在做什么

### 后端日志

后端的 `logs` 和 `workflowSteps` 数组在内存中是完整的，最终完成时也会正确保存，但**执行过程中前端拿不到实时数据**。

---

## 修复方案（待实施）

### 方案 1：工具执行后也传 result（简单但低效）

```typescript
await updateSessionStatus(request.sessionId, 'executing', {
  stopRequested: false,
  taskStage: currentStage,
  deliverablePlan: refreshedDeliverablePlan,
  taskState,
  result: {
    success: false,
    stopReason: 'max_turns',
    message: assistantMessage,
    workflowSteps: workflowSteps.slice(-6),
    logs: logs.slice(-8),
    generatedCode: undefined,
    taskDescription: request.userInput,
    contextRecords: [],
    toolCalls: [],
    taskStage: currentStage,
    deliverablePlan: refreshedDeliverablePlan,
    taskState,
  },
})
```

**优点**：改动最小，立即生效  
**缺点**：每轮两次序列化（Decision + 工具执行），性能优化白做了

### 方案 2：增量更新 API（推荐）

新增一个轻量级的更新接口，只传增量数据：

```typescript
// 新增函数
async function appendExecutionProgress(
  sessionId: string,
  newSteps: WorkflowStep[],
  newLogs: ExecutionLog[]
) {
  const session = await getSession(sessionId)
  if (!session || !session.result) return
  
  session.result.workflowSteps = [...session.result.workflowSteps, ...newSteps].slice(-6)
  session.result.logs = [...session.result.logs, ...newLogs].slice(-8)
  
  await saveSession(session)
  emitExecutionStatus(session)
}

// 工具执行后调用
await appendExecutionProgress(request.sessionId, [newWorkflowStep], [newLog])
```

**优点**：只序列化增量数据，性能最优  
**缺点**：需要新增函数，改动稍大

### 方案 3：WebSocket 推送（最佳但改动大）

不再依赖轮询 + session.result，直接通过 WebSocket 推送每一步：

```typescript
// 工具执行后
ws.send({
  type: 'workflow_step',
  sessionId: request.sessionId,
  step: {
    module: `Agent Loop ${turn}`,
    status: 'running',
    output: `动作：${decision.tool}\n结果：${result.summary}`,
  },
})
```

**优点**：实时性最好，不依赖轮询，不需要频繁读写 session.json  
**缺点**：需要改造前后端通信层

---

## 建议

**立即修复**：采用方案 1，恢复工具执行后传 result，确保前端能看到完整执行过程。

**后续优化**：迁移到方案 3（WebSocket），彻底解决轮询 + 序列化的性能问题。

---

## 附录：相关代码位置

| 文件 | 行号 | 说明 |
|---|---|---|
| `backend/src/services/queryEngineService.ts` | 349 | 初始化时的 updateSessionStatus（无 result） |
| `backend/src/services/queryEngineService.ts` | 480 | Decision 后的 updateSessionStatus（有 result） |
| `backend/src/services/queryEngineService.ts` | 551 | 工具执行后的 updateSessionStatus（❌ 无 result） |
| `backend/src/services/sessionService.ts` | 155-180 | updateSessionStatus 函数实现 |
| `backend/src/index.ts` | 293-343 | GET /status 端点实现 |
| `frontend/src/App.tsx` | 370-410 | 前端轮询逻辑 |
