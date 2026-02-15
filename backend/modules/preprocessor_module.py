import base64
import json
from pathlib import Path
from PIL import Image
import PyPDF2
import io
from openai import OpenAI

class PreprocessorModule:
    """预处理模块 - 处理特殊文件（优化版）"""
    
    def __init__(self, config):
        self.config = config
        self.qianwen_api_key = config.get('qianwen_api_key', '')
        self.qianwen_base_url = config.get('qianwen_base_url', 'https://dashscope.aliyuncs.com/compatible-mode/v1')
        
        # 初始化千问OCR客户端
        if self.qianwen_api_key:
            self.qianwen_client = OpenAI(
                api_key=self.qianwen_api_key,
                base_url=self.qianwen_base_url
            )
        else:
            self.qianwen_client = None
    
    def process(self, required_files, workspace_path, file_data):
        """
        处理特殊文件（图片OCR、PDF提取）
        
        Args:
            required_files: 需要处理的文件列表
            workspace_path: 工作区路径
            file_data: 从PM模块传递的文件数据（包含已读取的内容）
        
        Returns:
            处理结果
        """
        
        processed_files = []
        files_dict = {f['path']: f for f in file_data.get('files', [])}
        
        for file_rel_path in required_files:
            # 规范化文件路径
            clean_path = str(file_rel_path).replace('workspace/', '').replace('workspace\\', '')
            
            # 尝试从file_data中获取文件信息
            file_info = files_dict.get(clean_path)
            
            if not file_info:
                # 文件不存在
                processed_files.append({
                    'file': clean_path,
                    'status': 'not_found',
                    'content': None
                })
                continue
            
            file_path = Path(file_info['absolute_path'])
            file_ext = file_info['extension']
            
            # 只处理需要特殊处理的文件类型
            if file_ext in ['.png', '.jpg', '.jpeg', '.gif']:
                # 图片文件 - 使用OCR
                content = self._process_image_with_ocr(file_path)
            elif file_ext == '.pdf':
                # PDF文件 - 提取文本或OCR
                content = self._process_pdf(file_path)
            else:
                # 其他文件类型，直接使用已读取的内容
                content = {
                    'type': 'standard',
                    'path': str(file_path),
                    'extension': file_ext,
                    'note': '标准文件，无需预处理'
                }
            
            processed_files.append({
                'file': clean_path,
                'status': 'processed',
                'content': content,
                'path': str(file_path),
                'absolute_path': str(file_path.absolute())
            })
        
        return {
            'success': True,
            'processed_files': processed_files
        }
    
    def _process_image_with_ocr(self, image_path):
        """使用千问OCR处理图片"""
        try:
            # 调用千问OCR API
            if self.qianwen_client:
                ocr_text = self._call_qianwen_ocr(image_path)
            else:
                ocr_text = "[OCR未配置] 图片文件，需要OCR处理"
            
            return {
                'type': 'image',
                'path': str(image_path),
                'ocr_text': ocr_text
            }
            
        except Exception as e:
            return {
                'type': 'image',
                'path': str(image_path),
                'error': f'OCR处理失败: {str(e)}'
            }
    
    def _call_qianwen_ocr(self, image_path):
        """调用千问OCR API - 使用OpenAI兼容接口"""
        try:
            # 读取图片并转换为base64
            with open(image_path, 'rb') as f:
                image_data = f.read()
                image_base64 = base64.b64encode(image_data).decode('utf-8')
            
            # 构建图片URL（data URI格式）
            image_url = f"data:image/jpeg;base64,{image_base64}"
            
            # 使用OpenAI兼容接口调用千问OCR
            completion = self.qianwen_client.chat.completions.create(
                model="qwen-vl-ocr-2025-11-20",
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": image_url
                                },
                                "min_pixels": 32 * 32 * 3,
                                "max_pixels": 32 * 32 * 8192
                            },
                            {
                                "type": "text",
                                "text": "请识别这张图片中的所有文字内容，保持原有格式和结构。要求准确无误的提取关键信息，不要遗漏和捏造虚假信息，模糊或者强光遮挡的单个文字可以用英文问号?代替。"
                            }
                        ]
                    }
                ]
            )
            
            # 提取OCR结果
            ocr_text = completion.choices[0].message.content
            return ocr_text
                
        except Exception as e:
            return f"[OCR错误] {str(e)}"
    
    def _process_pdf(self, pdf_path):
        """处理PDF文件"""
        try:
            # 尝试提取文本
            with open(pdf_path, 'rb') as f:
                pdf_reader = PyPDF2.PdfReader(f)
                text_content = []
                
                for page_num in range(len(pdf_reader.pages)):
                    page = pdf_reader.pages[page_num]
                    text = page.extract_text()
                    if text.strip():
                        text_content.append(f"--- 第{page_num + 1}页 ---\n{text}")
                
                if text_content:
                    return {
                        'type': 'pdf',
                        'path': str(pdf_path),
                        'text': '\n\n'.join(text_content),
                        'pages': len(pdf_reader.pages)
                    }
                else:
                    # 如果没有文本，可能是扫描版PDF，需要OCR
                    return {
                        'type': 'pdf',
                        'path': str(pdf_path),
                        'text': '[扫描版PDF，需要OCR处理]',
                        'pages': len(pdf_reader.pages)
                    }
                    
        except Exception as e:
            return {
                'type': 'pdf',
                'path': str(pdf_path),
                'error': f'PDF处理失败: {str(e)}'
            }
