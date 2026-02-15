import os
import json
import uuid
from pathlib import Path
from datetime import datetime
from openai import OpenAI

class TemplateManager:
    """模板管理器 - 管理代码模板和历史记录"""
    
    def __init__(self, workspace_root, config):
        self.workspace_root = Path(workspace_root)
        self.templates_dir = self.workspace_root / 'templates'
        self.templates_dir.mkdir(parents=True, exist_ok=True)
        
        self.templates_file = self.templates_dir / 'templates.json'
        self.config = config
        self.client = OpenAI(
            api_key=config['deepseek_api_key'],
            base_url=config['deepseek_base_url']
        )
        
        self._load_templates()
    
    def _load_templates(self):
        """加载模板列表"""
        if self.templates_file.exists():
            with open(self.templates_file, 'r', encoding='utf-8') as f:
                self.templates = json.load(f)
        else:
            self.templates = {}
            self._save_templates()
    
    def _save_templates(self):
        """保存模板列表"""
        with open(self.templates_file, 'w', encoding='utf-8') as f:
            json.dump(self.templates, f, ensure_ascii=False, indent=2)
    
    def save_template(self, session_id, task_description, code, file_info, output_files):
        """保存代码为模板"""
        template_id = str(uuid.uuid4())
        
        template = {
            'id': template_id,
            'name': task_description[:50],  # 截取前50字符作为名称
            'description': task_description,
            'code': code,
            'file_info': file_info,  # 原始文件信息（文件名、结构）
            'output_files': output_files,  # 输出文件信息
            'created_at': datetime.now().isoformat(),
            'created_from_session': session_id,
            'usage_count': 0,
            'last_used': None,
            'tags': []
        }
        
        self.templates[template_id] = template
        self._save_templates()
        
        # 保存代码文件
        code_file = self.templates_dir / f"{template_id}.py"
        with open(code_file, 'w', encoding='utf-8') as f:
            f.write(code)
        
        return template_id
    
    def get_template(self, template_id):
        """获取模板详情"""
        if template_id not in self.templates:
            return None
        
        template = self.templates[template_id].copy()
        
        # 读取代码文件
        code_file = self.templates_dir / f"{template_id}.py"
        if code_file.exists():
            with open(code_file, 'r', encoding='utf-8') as f:
                template['code'] = f.read()
        
        return template
    
    def list_templates(self):
        """列出所有模板"""
        templates_list = []
        for template_id, template in self.templates.items():
            templates_list.append({
                'id': template_id,
                'name': template['name'],
                'description': template['description'],
                'created_at': template['created_at'],
                'usage_count': template['usage_count'],
                'last_used': template['last_used'],
                'tags': template.get('tags', [])
            })
        
        # 按创建时间倒序排列
        templates_list.sort(key=lambda x: x['created_at'], reverse=True)
        return templates_list
    
    def delete_template(self, template_id):
        """删除模板"""
        if template_id not in self.templates:
            return False
        
        # 删除代码文件
        code_file = self.templates_dir / f"{template_id}.py"
        if code_file.exists():
            code_file.unlink()
        
        # 从列表中删除
        del self.templates[template_id]
        self._save_templates()
        
        return True
    
    def update_template_usage(self, template_id):
        """更新模板使用统计"""
        if template_id in self.templates:
            self.templates[template_id]['usage_count'] += 1
            self.templates[template_id]['last_used'] = datetime.now().isoformat()
            self._save_templates()
    
    def add_template_tags(self, template_id, tags):
        """为模板添加标签"""
        if template_id in self.templates:
            current_tags = set(self.templates[template_id].get('tags', []))
            current_tags.update(tags)
            self.templates[template_id]['tags'] = list(current_tags)
            self._save_templates()
            return True
        return False
    
    def find_similar_templates(self, user_input, current_files):
        """使用AI查找相似的模板"""
        if not self.templates:
            return []
        
        # 构建模板摘要
        templates_summary = []
        for template_id, template in self.templates.items():
            templates_summary.append({
                'id': template_id,
                'name': template['name'],
                'description': template['description'],
                'file_info': template['file_info']
            })
        
        # 使用AI判断相似度
        prompt = f"""你是一个智能助手，负责判断用户的新需求是否可以复用已有的代码模板。

【用户新需求】
{user_input}

【当前工作区文件】
{json.dumps(current_files, ensure_ascii=False, indent=2)}

【已有模板列表】
{json.dumps(templates_summary, ensure_ascii=False, indent=2)}

【任务】
分析用户的新需求，判断是否可以复用已有模板。考虑以下因素：
1. 任务类型是否相似（如都是数据统计、格式转换等）
2. 文件类型是否匹配（如都是Excel文件）
3. 处理逻辑是否相似（如都是去重、汇总等）

【输出格式】
严格按照以下JSON格式输出：

```json
{{
    "has_similar": true/false,
    "similar_templates": [
        {{
            "template_id": "模板ID",
            "similarity_score": 0.0-1.0,
            "reason": "相似原因说明",
            "file_match": true/false,
            "suggested_modifications": "如果文件不完全匹配，建议的修改"
        }}
    ],
    "recommendation": "是否建议复用（直接复用/需要调整/不建议复用）"
}}
```

只输出JSON，不要其他内容。
"""
        
        try:
            response = self.client.chat.completions.create(
                model="deepseek-chat",
                messages=[
                    {
                        "role": "system",
                        "content": "你是一个智能代码复用助手。你必须严格按照JSON格式输出。"
                    },
                    {
                        "role": "user",
                        "content": prompt
                    }
                ],
                temperature=0.3,
                max_tokens=1000
            )
            
            result_text = response.choices[0].message.content.strip()
            
            # 提取JSON
            if "```json" in result_text:
                result_text = result_text.split("```json")[1].split("```")[0].strip()
            elif "```" in result_text:
                result_text = result_text.split("```")[1].split("```")[0].strip()
            
            result = json.loads(result_text)
            
            # 过滤出高相似度的模板
            if result.get('has_similar') and result.get('similar_templates'):
                similar = [t for t in result['similar_templates'] if t['similarity_score'] >= 0.6]
                return similar
            
            return []
            
        except Exception as e:
            print(f"查找相似模板失败: {e}")
            return []
    
    def check_file_compatibility(self, template_id, current_files):
        """检查模板与当前文件的兼容性"""
        template = self.get_template(template_id)
        if not template:
            return {'compatible': False, 'reason': '模板不存在'}
        
        template_files = template.get('file_info', [])
        
        if not template_files:
            return {'compatible': True, 'reason': '模板不依赖特定文件'}
        
        if not current_files:
            return {'compatible': False, 'reason': '当前会话没有文件'}
        
        # 获取文件名和扩展名
        template_file_names = set(f.get('name', '') for f in template_files if f.get('name'))
        current_file_names = set(f.get('name', '') for f in current_files if f.get('name'))
        
        # 1. 完全匹配（文件名相同）
        if template_file_names == current_file_names:
            return {'compatible': True, 'reason': '文件完全匹配'}
        
        # 2. 按扩展名分组
        template_by_ext = {}
        current_by_ext = {}
        
        for f in template_files:
            name = f.get('name', '')
            if name:
                ext = Path(name).suffix.lower()
                if ext not in template_by_ext:
                    template_by_ext[ext] = []
                template_by_ext[ext].append(name)
        
        for f in current_files:
            name = f.get('name', '')
            if name:
                ext = Path(name).suffix.lower()
                if ext not in current_by_ext:
                    current_by_ext[ext] = []
                current_by_ext[ext].append(name)
        
        # 3. 检查扩展名是否匹配
        template_extensions = set(template_by_ext.keys())
        current_extensions = set(current_by_ext.keys())
        
        if not template_extensions.issubset(current_extensions):
            missing = template_extensions - current_extensions
            return {
                'compatible': False,
                'reason': f'缺少必需的文件类型: {", ".join(missing)}',
                'details': {
                    'required': list(template_extensions),
                    'current': list(current_extensions),
                    'missing': list(missing)
                }
            }
        
        # 4. 检查每种类型的文件数量
        for ext in template_extensions:
            template_count = len(template_by_ext[ext])
            current_count = len(current_by_ext.get(ext, []))
            
            if current_count < template_count:
                return {
                    'compatible': False,
                    'reason': f'{ext} 文件数量不足（需要{template_count}个，当前{current_count}个）'
                }
        
        # 5. 类型和数量都匹配，但文件名不同
        return {
            'compatible': True,
            'reason': '文件类型和数量匹配',
            'warning': '文件名不同，系统将自动替换代码中的文件名引用',
            'file_mapping': self._create_file_mapping(template_files, current_files)
        }
    
    def _create_file_mapping(self, template_files, current_files):
        """创建模板文件名到当前文件名的映射"""
        mapping = {}
        
        # 按扩展名分组
        template_by_ext = {}
        current_by_ext = {}
        
        for f in template_files:
            name = f.get('name', '')
            if name:
                ext = Path(name).suffix.lower()
                if ext not in template_by_ext:
                    template_by_ext[ext] = []
                template_by_ext[ext].append(name)
        
        for f in current_files:
            name = f.get('name', '')
            if name:
                ext = Path(name).suffix.lower()
                if ext not in current_by_ext:
                    current_by_ext[ext] = []
                current_by_ext[ext].append(name)
        
        # 创建映射（按顺序匹配）
        for ext, template_names in template_by_ext.items():
            current_names = current_by_ext.get(ext, [])
            for i, template_name in enumerate(template_names):
                if i < len(current_names):
                    mapping[template_name] = current_names[i]
        
        return mapping

