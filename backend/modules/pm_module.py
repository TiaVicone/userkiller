from openai import OpenAI
from pathlib import Path
import json
from .file_reader import FileReader

class PMModule:
    """产品经理模块 - 分析用户需求（精简版）"""
    
    def __init__(self, config):
        self.config = config
        self.client = OpenAI(
            api_key=config['deepseek_api_key'],
            base_url=config['deepseek_base_url']
        )
        self.file_reader = FileReader()
    
    def analyze(self, user_input, workspace_path):
        """分析用户需求（只做需求分析，不读取完整文件内容）"""
        
        # 只读取文件元数据，不读取完整内容
        file_data = self.file_reader.read_workspace_files(workspace_path, include_content=False)
        files_info = self._format_files_metadata(file_data['files'])
        file_tree = file_data['file_tree']
        
        # 构建提示词（精简版，聚焦需求理解）
        prompt = """你是一个专业的产品经理，负责理解用户的办公自动化需求。

【用户需求】
""" + user_input + """

【工作区文件树】
""" + file_tree + """

【工作区文件列表】
""" + files_info + """

【核心任务】
快速理解用户需求，明确目标和期望效果：

1. 意图理解：用户的核心目标是什么？想要达到什么效果？
2. 文件识别：需要处理哪些文件？
3. 效果定义：期望的输出格式、数据转换方式、具体要求
4. 成功标准：定义3-5个可验证的完成标准

【输出格式】
必须严格按照以下JSON格式输出，不要添加任何解释文字：

{
    "intent": "用户的核心目标",
    "user_goal": "用户想要达到的最终效果",
    "target_files": [
        {
            "filename": "文件名",
            "path": "相对路径",
            "role": "在任务中的作用"
        }
    ],
    "expected_effect": {
        "output_format": "期望的输出格式",
        "data_transformation": "数据如何转换",
        "presentation": "数据如何呈现",
        "specific_requirements": ["具体要求1", "具体要求2"]
    },
    "success_criteria": [
        "可验证的标准1",
        "可验证的标准2",
        "可验证的标准3"
    ],
    "clarifications": [
        {
            "ambiguity": "模糊点",
            "assumption": "合理假设",
            "reasoning": "假设依据"
        }
    ]
}

【注意事项】
- 只输出JSON格式，不要添加markdown代码块标记
- 所有字段值都用双引号包裹
- 确保JSON格式正确，可以被解析
"""
        
        try:
            response = self.client.chat.completions.create(
                model="deepseek-chat",
                messages=[
                    {
                        "role": "system",
                        "content": "你是一个专业的产品经理。你必须严格按照JSON格式输出，不输出任何其他内容。"
                    },
                    {
                        "role": "user",
                        "content": prompt
                    }
                ],
                temperature=0.2,
                max_tokens=1500
            )
            
            result_text = response.choices[0].message.content.strip()
            
            # 提取JSON
            result_json = self._extract_json(result_text)
            
            # 验证必需字段
            required_fields = ['intent', 'user_goal', 'target_files', 'expected_effect', 'success_criteria']
            for field in required_fields:
                if field not in result_json:
                    if field in ['target_files', 'success_criteria']:
                        result_json[field] = []
                    elif field == 'expected_effect':
                        result_json[field] = {}
                    else:
                        result_json[field] = ""
            
            # 返回结果，同时返回file_data供后续模块使用
            return {
                'success': True,
                'analysis': result_json,
                'raw_output': result_text,
                'file_data': file_data  # 传递给下游模块
            }
            
        except Exception as e:
            return {
                'success': False,
                'error': str(e),
                'analysis': {
                    "intent": user_input,
                    "user_goal": user_input,
                    "target_files": [],
                    "expected_effect": {},
                    "success_criteria": ["任务完成"],
                    "clarifications": [],
                    "error": f"PM分析失败: {str(e)}"
                },
                'file_data': file_data
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
    
    def _format_files_metadata(self, files):
        """格式化文件元数据"""
        if not files:
            return "工作区暂无文件"
        
        files_text = []
        for f in files:
            files_text.append(
                f"- {f['name']} (路径: {f['path']}, 类型: {f['extension']}, 大小: {f['size']} bytes)"
            )
        
        return "\n".join(files_text)
