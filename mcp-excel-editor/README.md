# MCP Excel Editor

Excel行级编辑工具的MCP服务器实现，用于解决Agent无法直接编辑Excel文件的问题。

## 功能特性

- **删除行**: 删除Excel文件中的指定行（支持最后一行、第一行或任意索引位置）
- **删除列**: 删除Excel文件中的指定列
- **插入行**: 在指定位置插入新行
- **更新单元格**: 修改特定单元格的值

## 安装

```bash
cd mcp-excel-editor
npm install
npm run build
```

## 配置

在 `backend/config.json` 中添加Excel编辑器MCP服务器：

```json
{
  "mcpServers": [
    {
      "id": "excel-editor",
      "command": "node",
      "args": ["../mcp-excel-editor/dist/index.js"],
      "cwd": "backend",
      "description": "Excel 编辑 MCP 服务，提供行级别的 Excel 编辑功能"
    }
  ]
}
```

## 使用示例

### 场景：删除Excel汇总表的总数行

原始问题：使用 `summarize_forwarding_spreadsheet` 生成的Excel文件包含总数行，用户要求删除最后一行。

**解决方案**：

```javascript
// 1. 生成Excel汇总表
await summarizeForwardingSpreadsheet({
  inputPath: 'workspace/source.xlsx',
  outputPath: 'output/result.xlsx'
});

// 2. 使用MCP工具删除最后一行
await callMcpTool(config, {
  serverId: 'excel-editor',
  toolName: 'excel_delete_row',
  argumentsPayload: {
    filePath: '/absolute/path/to/output/result.xlsx',
    rowPosition: 'last'
  }
});
```

### Agent工作流

在Agent的决策流程中，当检测到用户要求修改已生成的Excel文件时：

1. **识别修改意图**: 检测关键词如"删除"、"删掉"、"去掉"、"最后一行"
2. **获取文件路径**: 从上下文记录中找到最近生成的Excel文件
3. **调用MCP工具**: 使用 `excel_delete_row` 或其他相关工具
4. **验证结果**: 使用 `preview_spreadsheet` 预览修改后的文件

## API文档

### excel_delete_row

删除Excel文件中的一行。

**参数**:
- `filePath` (string, 必需): Excel文件的绝对路径
- `rowPosition` (string|number, 必需): 要删除的行位置
  - `"last"`: 删除最后一行
  - `"first"`: 删除第一行
  - 数字: 删除指定索引的行（从0开始）
- `sheetName` (string, 可选): 工作表名称，默认为第一个工作表

**返回**: 操作结果描述字符串

### excel_delete_column

删除Excel文件中的一列。

**参数**:
- `filePath` (string, 必需): Excel文件的绝对路径
- `columnIndex` (number, 必需): 要删除的列索引（从0开始）
- `sheetName` (string, 可选): 工作表名称

### excel_insert_row

在指定位置插入新行。

**参数**:
- `filePath` (string, 必需): Excel文件的绝对路径
- `rowIndex` (number, 必需): 插入位置索引（从0开始）
- `values` (array, 必需): 新行的值数组
- `sheetName` (string, 可选): 工作表名称

### excel_update_cell

更新指定单元格的值。

**参数**:
- `filePath` (string, 必需): Excel文件的绝对路径
- `rowIndex` (number, 必需): 行索引（从0开始）
- `columnIndex` (number, 必需): 列索引（从0开始）
- `value` (string|number, 必需): 新的单元格值
- `sheetName` (string, 可选): 工作表名称

## 注意事项

1. **索引从0开始**: 所有行和列索引都是从0开始计数
2. **绝对路径**: 必须使用绝对文件路径
3. **文件修改**: 操作会直接修改原文件，建议先备份
4. **工作表**: 如果不指定工作表名称，默认操作第一个工作表

## 故障排除

### 文件路径错误
确保使用绝对路径，可以通过 `path.resolve()` 或 `path.join()` 构建完整路径。

### 索引超出范围
在删除或更新前，先使用 `preview_spreadsheet` 确认文件结构和行/列数量。

### 工作表不存在
检查工作表名称是否正确，或省略该参数使用默认工作表。

## 开发

运行测试：

```bash
cd backend
node test-excel-edit-workflow.mjs
```

重新构建：

```bash
cd mcp-excel-editor
npm run build
```

## 许可证

MIT
