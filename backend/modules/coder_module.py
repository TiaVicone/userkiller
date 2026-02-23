from openai import OpenAI
from pathlib import Path
import json
from datetime import datetime

class CoderModule:
    """Coder模块 - 生成可执行代码（优化版）"""
    
    def __init__(self, config):
        self.config = config
        self.client = OpenAI(
            api_key=config['deepseek_api_key'],
            base_url=config['deepseek_base_url']
        )
        self.feedback = None
        self.error_analysis = None
        self.code_modifications = None
    
    def set_feedback(self, feedback, error_analysis=None, code_modifications=None):
        """
        设置来自验收员的反馈
        
        Args:
            feedback: 基本反馈信息
            error_analysis: 错误分析结果（深度分析）
            code_modifications: 代码修改建议（具体的修改方案）
        """
        self.feedback = feedback
        self.error_analysis = error_analysis
        self.code_modifications = code_modifications
    
    def generate_code(self, user_input, pm_analysis, planner_plan, preprocessor_result, workspace_path, output_path, iteration, temp_code_dir=None):
        """生成可执行的Python代码"""
        
        # 如果没有指定临时代码目录，使用workspace_path
        if temp_code_dir is None:
            temp_code_dir = workspace_path
        
        # 构建文件信息（更精简）
        files_info = self._build_files_info(preprocessor_result, workspace_path)
        
        # 提取关键信息
        user_goal = pm_analysis.get('user_goal', user_input)
        expected_effect = pm_analysis.get('expected_effect', {})
        technical_approach = planner_plan.get('technical_approach', {})
        implementation_steps = planner_plan.get('implementation_steps', [])
        output_spec = planner_plan.get('output_specification', {})
        
        # 构建提示词（更聚焦、更精简）
        prompt = f"""你是一个专业的Python开发工程师，负责生成可直接执行的办公自动化代码。

【用户目标】
{user_goal}

【期望效果】
输出格式: {expected_effect.get('output_format', '未指定')}
数据转换: {expected_effect.get('data_transformation', '未指定')}
具体要求: {', '.join(expected_effect.get('specific_requirements', []))}

【技术方案】
使用库: {', '.join(technical_approach.get('libraries', ['openpyxl', 'pandas']))}
实现方法: {technical_approach.get('method', '标准处理')}
数据流: {technical_approach.get('data_flow', '输入 → 处理 → 输出')}

【实现步骤】
{self._format_implementation_steps(implementation_steps)}

【输出规格】
文件名: {output_spec.get('filename', 'result.xlsx')}
格式: {output_spec.get('format', 'Excel')}
结构: {output_spec.get('structure', '标准格式')}
内容: {output_spec.get('content_details', '处理后的数据')}

【可用文件】
{files_info}

【路径信息】
工作区: {workspace_path.absolute()}
输出区: {output_path.absolute()}
"""
        
        # 处理验收反馈（支持深度错误分析）
        if self.error_analysis and self.code_modifications:
            # 深度错误分析模式
            prompt += f"""
【🔍 深度错误分析】
错误类型: {self.error_analysis.get('error_type', '未知')}
根本原因: {self.error_analysis.get('root_cause', '')}

【📋 代码修改方案】
{self._format_code_modifications(self.code_modifications)}

【⚠️ 文件问题】
{self._format_file_issues(self.error_analysis.get('file_issues', []))}

【✅ 修复策略】
{self.error_analysis.get('fix_strategy', {}).get('approach', '')}

【💡 详细建议】
{chr(10).join(f"{i+1}. {s}" for i, s in enumerate(self.code_modifications) if isinstance(self.code_modifications, list))}

【重要提示】
- 严格按照代码修改方案进行修复
- 注意文件路径和文件格式问题
- 确保所有文件操作都有错误处理
- 修复后的代码必须能够成功执行
"""
        elif self.feedback:
            # 常规反馈模式
            prompt += f"""
【上次验收反馈】
{self.feedback}

请根据反馈修复问题，重新生成代码。
"""
        
        # 代码模板
        workspace_abs = str(workspace_path.absolute())
        output_abs = str(output_path.absolute())
        output_filename = output_spec.get('filename', 'result.xlsx')
        libraries_str = ', '.join(technical_approach.get('libraries', ['openpyxl', 'pandas']))
        current_time = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        
        # 构建文件映射示例
        file_mapping_example = {}
        for file_info in preprocessor_result.get('processed_files', []):
            if file_info.get('status') == 'processed':
                filename = file_info.get('file', '')
                if filename:
                    file_mapping_example[filename] = filename
        
        code_template = f'''
【代码要求】

1. **路径使用**：
   - 工作区路径: {workspace_abs}
   - 输出路径: {output_abs}
   - 使用 Path 对象处理路径

2. **文件处理**：
   - 输入文件在工作区中
   - 输出文件保存到输出区
   - 文件名: {output_filename}

3. **库使用**：
   - Excel: 使用 {libraries_str}
   - 数据处理: 使用 pandas

4. **错误处理**：
   - 添加 try-except 捕获异常
   - 检查文件是否存在
   - 打印清晰的进度信息

【输出格式】
只输出Python代码，不要任何解释。严格按照以下模板：

```python
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
自动生成的办公自动化脚本
任务: {user_goal}
生成时间: {current_time}
"""

from pathlib import Path
import sys
import pandas as pd  # 根据需要导入其他库

def main():
    """主函数"""
    try:
        # 设置路径
        workspace_path = Path(r"{workspace_abs}")
        output_path = Path(r"{output_abs}")
        
        # 确保输出目录存在
        output_path.mkdir(parents=True, exist_ok=True)
        
        print(f"工作区: {{workspace_path}}")
        print(f"输出区: {{output_path}}")
        print("-" * 50)
        
        # 你的处理逻辑（严格按照实现步骤）
        # 步骤1: 读取输入文件
        # 步骤2: 处理数据
        # 步骤3: 保存输出文件
        
        # 保存输出文件
        output_file = output_path / "{output_filename}"
        # 保存代码...
        
        print("-" * 50)
        print(f"✓ 处理完成")
        print(f"✓ 输出文件: {{output_file}}")
        return True
        
    except FileNotFoundError as e:
        print(f"✗ 文件未找到: {{e}}")
        return False
    except Exception as e:
        print(f"✗ 错误: {{e}}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
```

【关键提示】
- 使用提供的实际路径: {workspace_abs} 和 {output_abs}
- 不要使用占位符或变量，直接使用具体路径
- 确保代码可以立即执行
- 只输出代码，不要输出任何解释或说明
'''
        
        prompt += code_template
        
        try:
            response = self.client.chat.completions.create(
                model="deepseek-chat",
                messages=[
                    {
                        "role": "system",
                        "content": "你是一个专业的Python开发工程师。只输出可执行的Python代码，不输出任何解释或说明。代码必须健壮、可靠、易读。"
                    },
                    {
                        "role": "user",
                        "content": prompt
                    }
                ],
                temperature=0.1,
                max_tokens=4000
            )
            
            code_text = response.choices[0].message.content.strip()
            
            # 提取代码
            code = self._extract_code(code_text)
            
            # 保存代码到临时文件夹
            code_file = temp_code_dir / f"generated_code_{iteration}.py"
            with open(code_file, 'w', encoding='utf-8') as f:
                f.write(code)
            
            # 清除反馈
            self.feedback = None
            self.error_analysis = None
            self.code_modifications = None
            
            return {
                'success': True,
                'code': code,
                'code_file': str(code_file),
                'iteration': iteration
            }
            
        except Exception as e:
            return {
                'success': False,
                'error': str(e),
                'code': f"# 代码生成失败: {str(e)}",
                'code_file': ''
            }
    
    def _extract_code(self, text):
        """提取代码"""
        if "```python" in text:
            code = text.split("```python")[1].split("```")[0].strip()
        elif "```" in text:
            code = text.split("```")[1].split("```")[0].strip()
        else:
            code = text
        
        return code
    
    def _format_implementation_steps(self, steps):
        """格式化实现步骤"""
        if not steps:
            return "无具体步骤"
        
        formatted = []
        for step in steps:
            if isinstance(step, dict):
                formatted.append(
                    f"步骤{step.get('step', '?')}: {step.get('name', '')} - {step.get('description', '')}"
                )
            else:
                formatted.append(str(step))
        
        return '\n'.join(formatted)
    
    def _format_code_modifications(self, modifications):
        """格式化代码修改方案"""
        if not modifications:
            return "无具体修改方案"
        
        if isinstance(modifications, list):
            formatted = []
            for i, mod in enumerate(modifications, 1):
                if isinstance(mod, dict):
                    formatted.append(f"""
修改 {i}:
位置: {mod.get('location', '未指定')}
问题: {mod.get('issue', '')}
修复: {mod.get('fix', '')}

修改前:
{mod.get('code_before', '')}

修改后:
{mod.get('code_after', '')}
""")
                else:
                    formatted.append(f"{i}. {mod}")
            return "\n".join(formatted)
        else:
            return str(modifications)
    
    def _format_file_issues(self, file_issues):
        """格式化文件问题"""
        if not file_issues:
            return "无文件问题"
        
        formatted = []
        for issue in file_issues:
            if isinstance(issue, dict):
                formatted.append(f"""
文件: {issue.get('file', '')}
问题: {issue.get('issue', '')}
期望: {issue.get('expected', '')}
实际: {issue.get('actual', '')}
""")
            else:
                formatted.append(str(issue))
        
        return "\n".join(formatted) if formatted else "无文件问题"
    
    def _build_files_info(self, preprocessor_result, workspace_path):
        """构建文件信息字符串（精简版）"""
        if not preprocessor_result.get('processed_files'):
            return "工作区无文件"
        
        info_lines = []
        
        for file_info in preprocessor_result['processed_files']:
            if file_info['status'] == 'not_found':
                info_lines.append(f"✗ 文件未找到: {file_info['file']}")
                continue
            
            content = file_info.get('content', {})
            file_path = file_info.get('absolute_path', file_info.get('path', ''))
            
            info_lines.append(f"\n✓ 文件: {file_info['file']}")
            info_lines.append(f"  路径: {file_path}")
            
            # 根据文件类型显示关键信息
            if content.get('type') == 'image' and 'ocr_text' in content:
                info_lines.append(f"  类型: 图片（已OCR）")
                info_lines.append(f"  OCR内容: {content['ocr_text'][:200]}...")
            elif content.get('type') == 'pdf' and 'text' in content:
                info_lines.append(f"  类型: PDF（{content.get('pages', 0)}页）")
                info_lines.append(f"  文本内容: {content['text'][:200]}...")
            else:
                info_lines.append(f"  类型: {content.get('type', 'unknown')}")
        
        return '\n'.join(info_lines) if info_lines else "工作区无可用文件"
