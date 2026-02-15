"""
统一的文件读取工具类
避免多个模块重复读取文件，提高性能
"""

from pathlib import Path
import pandas as pd
from docx import Document
import PyPDF2


class FileReader:
    """统一的文件读取器"""
    
    def __init__(self, max_preview_rows=10, max_file_size=1*1024*1024):
        self.max_preview_rows = max_preview_rows
        self.max_file_size = max_file_size
        self._cache = {}  # 文件内容缓存
    
    def read_workspace_files(self, workspace_path, include_content=True):
        """
        读取工作区所有文件
        
        Args:
            workspace_path: 工作区路径
            include_content: 是否包含文件内容（False时只返回元数据）
        
        Returns:
            {
                'files': [文件列表],
                'file_tree': '文件树字符串',
                'content_previews': '内容预览字符串'
            }
        """
        if not workspace_path.exists():
            return {
                'files': [],
                'file_tree': '工作区为空',
                'content_previews': '工作区为空'
            }
        
        files = []
        content_previews = []
        
        for file_path in sorted(workspace_path.rglob('*')):
            if not file_path.is_file() or file_path.name.startswith('.'):
                continue
            
            rel_path = file_path.relative_to(workspace_path)
            file_ext = file_path.suffix.lower()
            file_size = file_path.stat().st_size
            
            # 基本元数据
            file_info = {
                'name': file_path.name,
                'path': str(rel_path),
                'extension': file_ext,
                'size': file_size,
                'absolute_path': str(file_path.absolute())
            }
            
            # 读取文件内容（如果需要）
            if include_content:
                cache_key = str(file_path.absolute())
                
                # 检查缓存
                if cache_key in self._cache:
                    file_info['content'] = self._cache[cache_key]
                else:
                    content = self._read_file_content(file_path, file_ext, file_size)
                    file_info['content'] = content
                    self._cache[cache_key] = content
                
                # 生成内容预览字符串
                preview = self._format_content_preview(rel_path, file_ext, file_size, file_info['content'])
                content_previews.append(preview)
            
            files.append(file_info)
        
        return {
            'files': files,
            'file_tree': self._build_file_tree(workspace_path),
            'content_previews': '\n'.join(content_previews) if content_previews else '工作区暂无文件'
        }
    
    def _read_file_content(self, file_path, file_ext, file_size):
        """读取单个文件内容"""
        is_large = file_size > self.max_file_size
        
        try:
            # CSV文件
            if file_ext == '.csv':
                df = pd.read_csv(file_path, nrows=self.max_preview_rows if is_large else None)
                return {
                    'type': 'csv',
                    'columns': df.columns.tolist(),
                    'dtypes': df.dtypes.astype(str).to_dict(),
                    'rows': len(df),
                    'preview': df.to_string(index=False, max_rows=self.max_preview_rows),
                    'is_large': is_large
                }
            
            # Excel文件
            elif file_ext in ['.xlsx', '.xls']:
                excel_file = pd.ExcelFile(file_path)
                df = pd.read_excel(file_path, sheet_name=0, nrows=self.max_preview_rows if is_large else None)
                return {
                    'type': 'excel',
                    'sheets': excel_file.sheet_names,
                    'columns': df.columns.tolist(),
                    'dtypes': df.dtypes.astype(str).to_dict(),
                    'rows': len(df),
                    'preview': df.to_string(index=False, max_rows=self.max_preview_rows),
                    'is_large': is_large
                }
            
            # Word文件
            elif file_ext == '.docx':
                doc = Document(file_path)
                paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
                preview_count = min(self.max_preview_rows * 2, len(paragraphs))
                return {
                    'type': 'word',
                    'paragraphs': len(paragraphs),
                    'preview': '\n'.join(paragraphs[:preview_count]),
                    'is_large': len(paragraphs) > preview_count
                }
            
            # PDF文件
            elif file_ext == '.pdf':
                with open(file_path, 'rb') as f:
                    pdf_reader = PyPDF2.PdfReader(f)
                    pages = len(pdf_reader.pages)
                    text_parts = []
                    for i in range(min(3, pages)):
                        text_parts.append(pdf_reader.pages[i].extract_text()[:500])
                    return {
                        'type': 'pdf',
                        'pages': pages,
                        'preview': '\n'.join(text_parts),
                        'is_large': pages > 3
                    }
            
            # 文本文件
            elif file_ext in ['.txt', '.json', '.xml', '.md', '.log']:
                if is_large:
                    with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                        lines = [f.readline() for _ in range(self.max_preview_rows)]
                        content = ''.join(lines)
                else:
                    with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                        content = f.read()
                
                return {
                    'type': 'text',
                    'content': content,
                    'is_large': is_large
                }
            
            # 图片文件
            elif file_ext in ['.png', '.jpg', '.jpeg', '.gif']:
                return {
                    'type': 'image',
                    'needs_ocr': True
                }
            
            # 其他文件
            else:
                return {
                    'type': 'unknown',
                    'extension': file_ext
                }
        
        except Exception as e:
            return {
                'type': 'error',
                'error': str(e)
            }
    
    def _format_content_preview(self, rel_path, file_ext, file_size, content):
        """格式化内容预览字符串"""
        preview = f"\n{'='*80}\n【文件: {rel_path}】\n{'='*80}\n"
        
        if content.get('type') == 'csv':
            preview += f"CSV文件 (大小: {file_size} bytes)\n"
            preview += f"列名: {', '.join(content['columns'])}\n"
            preview += f"数据类型: {content['dtypes']}\n"
            preview += f"前{content['rows']}行数据:\n{content['preview']}"
            if content['is_large']:
                preview += f"\n⚠️ 文件较大，仅显示前{self.max_preview_rows}行"
        
        elif content.get('type') == 'excel':
            preview += f"Excel文件 (大小: {file_size} bytes)\n"
            preview += f"工作表: {', '.join(content['sheets'])}\n"
            preview += f"第一个工作表 [{content['sheets'][0]}]:\n"
            preview += f"列名: {', '.join(content['columns'])}\n"
            preview += f"数据类型: {content['dtypes']}\n"
            preview += f"前{content['rows']}行数据:\n{content['preview']}"
            if content['is_large']:
                preview += f"\n⚠️ 文件较大，仅显示前{self.max_preview_rows}行"
        
        elif content.get('type') == 'word':
            preview += f"Word文档 (大小: {file_size} bytes)\n"
            preview += f"共 {content['paragraphs']} 段落\n"
            preview += f"内容预览:\n{content['preview']}"
            if content['is_large']:
                preview += f"\n⚠️ 文档较长，仅显示部分内容"
        
        elif content.get('type') == 'pdf':
            preview += f"PDF文件 (大小: {file_size} bytes)\n"
            preview += f"共 {content['pages']} 页\n"
            preview += f"内容预览:\n{content['preview']}"
            if content['is_large']:
                preview += f"\n⚠️ 仅显示前3页"
        
        elif content.get('type') == 'text':
            preview += f"文本文件 (大小: {file_size} bytes)\n"
            preview += f"内容:\n{content['content']}"
            if content['is_large']:
                preview += f"\n⚠️ 文件较大，仅显示部分内容"
        
        elif content.get('type') == 'image':
            preview += f"图片文件 (大小: {file_size} bytes)\n需要OCR处理"
        
        elif content.get('type') == 'error':
            preview += f"读取失败: {content['error']}"
        
        else:
            preview += f"文件类型: {file_ext}, 大小: {file_size} bytes"
        
        return preview
    
    def _build_file_tree(self, workspace_path, max_depth=3):
        """构建文件树结构"""
        tree_lines = [workspace_path.name + "/"]
        
        def build_tree(path, prefix="", current_depth=0):
            if current_depth >= max_depth:
                return
            
            items = sorted(path.iterdir(), key=lambda x: (not x.is_dir(), x.name))
            items = [item for item in items if not item.name.startswith('.')]
            
            for i, item in enumerate(items):
                is_last = i == len(items) - 1
                current_prefix = "└── " if is_last else "├── "
                
                if item.is_file():
                    size = item.stat().st_size
                    tree_lines.append(f"{prefix}{current_prefix}{item.name} ({size} bytes)")
                else:
                    tree_lines.append(f"{prefix}{current_prefix}{item.name}/")
                    next_prefix = prefix + ("    " if is_last else "│   ")
                    build_tree(item, next_prefix, current_depth + 1)
        
        build_tree(workspace_path)
        return "\n".join(tree_lines)
    
    def get_file_by_path(self, workspace_path, file_path):
        """根据路径获取文件信息"""
        # 规范化路径
        clean_path = str(file_path).replace('workspace/', '').replace('workspace\\', '')
        
        # 尝试多种路径组合
        possible_paths = [
            workspace_path / clean_path,
            workspace_path / file_path,
        ]
        
        for path in possible_paths:
            if path.exists():
                return {
                    'found': True,
                    'path': str(path),
                    'absolute_path': str(path.absolute()),
                    'name': path.name,
                    'extension': path.suffix.lower(),
                    'size': path.stat().st_size
                }
        
        return {
            'found': False,
            'searched_paths': [str(p) for p in possible_paths]
        }
    
    def clear_cache(self):
        """清除缓存"""
        self._cache.clear()

