from openai import OpenAI
from pathlib import Path
import json

class PlannerModule:
    """规划师模块 - 制定技术方案（优化版）"""
    
    def __init__(self, config):
        self.config = config
        self.client = OpenAI(
            api_key=config['deepseek_api_key'],
            base_url=config['deepseek_base_url']
        )
    
    def plan(self, user_input, pm_analysis, file_data):
        """
        制定详细的技术方案
        
        Args:
            user_input: 用户输入
            pm_analysis: PM模块的分析结果
            file_data: 文件数据（从PM模块传递，包含文件树和内容预览）
        """
        
        # 从PM模块获取文件信息，避免重复读取
        file_tree = file_data.get('file_tree', '工作区为空')
        content_previews = file_data.get('content_previews', '工作区暂无文件')
        
        # 构建提示词（聚焦技术方案）
        prompt = f"""你是一个专业的技术规划师，负责将产品需求转化为可执行的技术方案。

【用户需求】
{user_input}

【产品经理分析】
用户目标: {pm_analysis.get('user_goal', '')}
期望效果: {json.dumps(pm_analysis.get('expected_effect', {}), ensure_ascii=False, indent=2)}
成功标准: {json.dumps(pm_analysis.get('success_criteria', []), ensure_ascii=False, indent=2)}
目标文件: {json.dumps(pm_analysis.get('target_files', []), ensure_ascii=False, indent=2)}

【工作区文件树】
{file_tree}

【文件内容预览】
{content_previews}

【核心任务】
基于PM的需求分析和文件内容，制定精准的技术实现方案：

1. **确认文件**：确认需要处理的文件（必须实际存在）

2. **技术选型**：
   - 选择合适的Python库（openpyxl/pandas/python-docx等）
   - 设计数据提取和转换逻辑
   - 规划输出格式和样式

3. **实现步骤**：
   - 将任务分解为清晰的功能模块
   - 每个模块包含具体的处理步骤
   - 确保步骤能够达到用户期望的效果

【输出格式】
必须严格按照以下JSON格式输出：

```json
{{
    "required_files": [
        {{
            "filename": "实际文件名",
            "path": "相对路径",
            "purpose": "用途说明",
            "data_structure": "数据结构描述（基于实际内容）",
            "key_fields": ["关键字段1", "关键字段2"]
        }}
    ],
    "technical_approach": {{
        "libraries": ["openpyxl", "pandas"],
        "method": "技术方法描述（2-3句话，说明如何达到用户期望的效果）",
        "data_flow": "数据流：从哪个文件的哪些字段 → 如何处理 → 输出到哪里的什么格式"
    }},
    "implementation_steps": [
        {{
            "step": 1,
            "name": "步骤名称",
            "description": "具体做什么",
            "input": "输入数据（具体字段）",
            "process": "处理逻辑",
            "output": "输出结果"
        }}
    ],
    "output_specification": {{
        "filename": "输出文件名.xlsx",
        "format": "Excel/Word/PDF",
        "structure": "文件结构描述（工作表、列、格式等）",
        "content_details": "内容细节（包含哪些数据、如何组织）",
        "styling": "样式要求（如有）"
    }}
}}
```

【注意事项】
- 必须基于实际文件内容制定方案
- required_files的data_structure和key_fields要基于实际读取的内容
- technical_approach要说明如何达到用户期望的效果
- implementation_steps要具体可执行
- output_specification要详细描述输出的结构和内容
- 只输出JSON，不要添加任何解释文字
"""
        
        try:
            response = self.client.chat.completions.create(
                model="deepseek-chat",
                messages=[
                    {
                        "role": "system",
                        "content": "你是一个专业的技术规划师。你必须严格按照JSON格式输出，不输出任何其他内容。"
                    },
                    {
                        "role": "user",
                        "content": prompt
                    }
                ],
                temperature=0.2,
                max_tokens=2500
            )
            
            result_text = response.choices[0].message.content.strip()
            
            # 提取JSON
            result_json = self._extract_json(result_text)
            
            # 验证和规范化
            if 'required_files' not in result_json:
                result_json['required_files'] = []
            if 'technical_approach' not in result_json:
                result_json['technical_approach'] = {}
            if 'implementation_steps' not in result_json:
                result_json['implementation_steps'] = []
            if 'output_specification' not in result_json:
                result_json['output_specification'] = {}
            
            # 提取文件路径列表（规范化格式）
            file_paths = []
            if isinstance(result_json['required_files'], list):
                for item in result_json['required_files']:
                    if isinstance(item, dict):
                        path = item.get('path', item.get('filename', ''))
                    else:
                        path = str(item)
                    
                    # 规范化路径：移除 workspace/ 前缀
                    path = path.replace('workspace/', '').replace('workspace\\', '')
                    if path:
                        file_paths.append(path)
            
            return {
                'success': True,
                'plan': result_json,
                'required_files': file_paths,
                'raw_output': result_text
            }
            
        except Exception as e:
            return {
                'success': False,
                'error': str(e),
                'plan': {
                    "required_files": [],
                    "technical_approach": {"libraries": ["openpyxl"], "method": "使用Python处理"},
                    "implementation_steps": [],
                    "output_specification": {"filename": "result.xlsx", "format": "Excel"},
                    "error": f"规划失败: {str(e)}"
                },
                'required_files': []
            }
    
    def _extract_json(self, text):
        """提取JSON内容"""
        try:
            return json.loads(text)
        except:
            if "```json" in text:
                text = text.split("```json")[1].split("```")[0].strip()
            elif "```" in text:
                text = text.split("```")[1].split("```")[0].strip()
            return json.loads(text)
