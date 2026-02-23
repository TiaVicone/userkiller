"""
模板代码生成器 - 生成可参数化的模板代码
"""
import re
import json
from pathlib import Path

class TemplateCodeGenerator:
    """
    生成可参数化的模板代码
    核心思路：让 Coder 生成时就使用参数化的路径和文件名
    """
    
    @staticmethod
    def get_template_code_requirements():
        """
        返回给 Coder 的模板代码要求
        这些要求会被添加到 Coder 的 prompt 中
        """
        return """
【模板化代码要求】
为了让代码可以作为模板复用，请遵循以下规范：

1. **路径参数化**：
   - 在代码开头定义路径变量：
     ```python
     # 路径配置（可被外部注入）
     WORKSPACE_PATH = Path(r"{{WORKSPACE_PATH}}")
     OUTPUT_PATH = Path(r"{{OUTPUT_PATH}}")
     ```
   
2. **文件名参数化**：
   - 定义文件名映射字典：
     ```python
     # 文件名映射（可被外部注入）
     FILE_MAPPING = {
         "input_file": "{{INPUT_FILE_1}}",
         "output_file": "{{OUTPUT_FILE}}"
     }
     ```
   
3. **使用参数**：
   - 使用参数化的路径和文件名：
     ```python
     input_file = WORKSPACE_PATH / FILE_MAPPING["input_file"]
     output_file = OUTPUT_PATH / FILE_MAPPING["output_file"]
     ```

4. **配置注入点**：
   - 在代码开头添加配置注入标记：
     ```python
     # === 配置注入区域 START ===
     # 此区域的变量会在模板执行时被替换
     WORKSPACE_PATH = Path(r"{{WORKSPACE_PATH}}")
     OUTPUT_PATH = Path(r"{{OUTPUT_PATH}}")
     FILE_MAPPING = {{FILE_MAPPING_JSON}}
     # === 配置注入区域 END ===
     ```

这样生成的代码可以轻松复用到不同的会话中。
"""
    
    @staticmethod
    def convert_code_to_template(code, workspace_path, output_path):
        """
        将实际代码转换为模板代码（添加占位符）
        
        Args:
            code: 实际执行的代码
            workspace_path: 当前工作区路径
            output_path: 当前输出路径
        
        Returns:
            模板代码（包含占位符）
        """
        template_code = code
        
        # 1. 替换路径变量定义
        # 匹配: workspace_path = Path(r"/actual/path")
        template_code = re.sub(
            r'workspace_path\s*=\s*Path\([^)]+\)',
            'workspace_path = Path(r"{{WORKSPACE_PATH}}")',
            template_code
        )
        
        # 匹配: output_path = Path(r"/actual/path")
        template_code = re.sub(
            r'output_path\s*=\s*Path\([^)]+\)',
            'output_path = Path(r"{{OUTPUT_PATH}}")',
            template_code
        )
        
        # 2. 提取文件名并创建 FILE_MAPPING 占位符
        # 查找所有文件名引用
        file_pattern = r'["\']([^"\']+\.(xlsx|xls|csv|docx|doc|pdf|txt|png|jpg|jpeg))["\']'
        files = re.findall(file_pattern, template_code, re.IGNORECASE)
        
        if files:
            # 构建文件映射
            file_mapping = {}
            for filename, ext in files:
                # 只保留文件名，不包含路径
                basename = Path(filename).name
                if basename and basename not in file_mapping:
                    file_mapping[basename] = f"{{{{{basename}}}}}"
            
            # 在代码开头添加配置注入区域
            config_section = '''
# === 配置注入区域 START ===
# 此区域的变量会在模板执行时被自动替换
WORKSPACE_PATH = Path(r"{{WORKSPACE_PATH}}")
OUTPUT_PATH = Path(r"{{OUTPUT_PATH}}")
FILE_MAPPING = {{FILE_MAPPING_JSON}}
# === 配置注入区域 END ===
'''
            
            # 在 main() 函数之前插入配置区域
            if 'def main():' in template_code:
                template_code = template_code.replace(
                    'def main():',
                    config_section + '\ndef main():'
                )
            else:
                # 如果没有 main 函数，在导入语句后插入
                import_end = template_code.rfind('import ')
                if import_end != -1:
                    next_line = template_code.find('\n', import_end)
                    if next_line != -1:
                        template_code = (
                            template_code[:next_line+1] + 
                            config_section + 
                            template_code[next_line+1:]
                        )
        
        return template_code
    
    @staticmethod
    def inject_config_to_template(template_code, workspace_path, output_path, file_mapping):
        """
        将配置注入到模板代码中
        
        Args:
            template_code: 模板代码
            workspace_path: 工作区路径
            output_path: 输出路径
            file_mapping: 文件名映射 {"old_name": "new_name"}
        
        Returns:
            注入配置后的代码
        """
        import json
        import re
        
        # 方法1：替换配置注入区域
        if "=== 配置注入区域 START ===" in template_code:
            # 构建新的配置区域
            config_section = f'''# === 配置注入区域 START ===
# 此区域的变量会在模板执行时被替换
WORKSPACE_PATH = Path(r"{workspace_path}")
OUTPUT_PATH = Path(r"{output_path}")
FILE_MAPPING = {json.dumps(file_mapping, ensure_ascii=False, indent=4)}
# === 配置注入区域 END ==='''
            
            # 替换配置区域
            pattern = r'# === 配置注入区域 START ===.*?# === 配置注入区域 END ==='
            modified_code = re.sub(pattern, config_section, template_code, flags=re.DOTALL)
            
            return modified_code
        
        # 方法2：替换占位符（兼容旧代码）
        modified_code = template_code
        
        # 替换路径占位符
        modified_code = modified_code.replace('{{WORKSPACE_PATH}}', str(workspace_path))
        modified_code = modified_code.replace('{{OUTPUT_PATH}}', str(output_path))
        
        # 替换文件名占位符
        modified_code = modified_code.replace(
            '{{FILE_MAPPING_JSON}}', 
            json.dumps(file_mapping, ensure_ascii=False, indent=4)
        )
        
        # 替换单个文件名占位符
        for i, (old_name, new_name) in enumerate(file_mapping.items(), 1):
            modified_code = modified_code.replace(f'{{{{INPUT_FILE_{i}}}}}', new_name)
        
        return modified_code
    
    @staticmethod
    def extract_file_references(template_code):
        """
        从模板代码中提取文件引用
        用于分析模板需要哪些文件
        
        Returns:
            List[str]: 文件名列表
        """
        import re
        
        file_refs = set()
        
        # 查找 FILE_MAPPING 定义
        mapping_pattern = r'FILE_MAPPING\s*=\s*\{([^}]+)\}'
        match = re.search(mapping_pattern, template_code)
        if match:
            mapping_content = match.group(1)
            # 提取文件名
            file_pattern = r'["\']([^"\']+\.(xlsx|xls|csv|docx|pdf|txt))["\']'
            files = re.findall(file_pattern, mapping_content, re.IGNORECASE)
            file_refs.update([f[0] for f in files])
        
        # 查找直接的文件名引用
        direct_pattern = r'["\']([^"\']+\.(xlsx|xls|csv|docx|pdf|txt))["\']'
        files = re.findall(direct_pattern, template_code, re.IGNORECASE)
        file_refs.update([f[0] for f in files])
        
        return list(file_refs)

