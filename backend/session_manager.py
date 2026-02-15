import os
import json
import shutil
from pathlib import Path
from datetime import datetime
from openai import OpenAI

class SessionManager:
    """会话管理器"""
    
    def __init__(self, workspace_root):
        self.workspace_root = Path(workspace_root)
        self.workspace_root.mkdir(parents=True, exist_ok=True)
        self.sessions_file = self.workspace_root / 'sessions.json'
        self._load_sessions()
    
    def _load_sessions(self):
        """加载会话列表"""
        if self.sessions_file.exists():
            with open(self.sessions_file, 'r', encoding='utf-8') as f:
                self.sessions = json.load(f)
        else:
            self.sessions = {}
            self._save_sessions()
    
    def _save_sessions(self):
        """保存会话列表"""
        with open(self.sessions_file, 'w', encoding='utf-8') as f:
            json.dump(self.sessions, f, ensure_ascii=False, indent=2)
    
    def generate_session_name(self, user_input, api_key, base_url):
        """使用AI生成会话名称"""
        try:
            client = OpenAI(api_key=api_key, base_url=base_url)
            
            response = client.chat.completions.create(
                model="deepseek-chat",
                messages=[
                    {
                        "role": "system",
                        "content": "你是一个会话命名助手。根据用户的需求，生成一个简洁的会话名称，7-10个字，直接输出名称，不要其他内容。"
                    },
                    {
                        "role": "user",
                        "content": f"用户需求：{user_input}\n\n请生成会话名称："
                    }
                ],
                temperature=0.7,
                max_tokens=50
            )
            
            session_name = response.choices[0].message.content.strip()
            # 限制长度
            if len(session_name) > 15:
                session_name = session_name[:15]
            
            return session_name
        except Exception as e:
            print(f"生成会话名称失败: {e}")
            # 使用时间戳作为备用名称
            return f"会话_{datetime.now().strftime('%m%d_%H%M')}"
    
    def create_session(self, session_id, user_input=""):
        """创建新会话"""
        # 使用时间戳创建可读的文件夹名称
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        folder_name = f"session_{timestamp}"
        
        # 创建会话目录
        session_dir = self.workspace_root / folder_name
        workspace_dir = session_dir / 'workspace'
        output_dir = session_dir / 'output'
        
        workspace_dir.mkdir(parents=True, exist_ok=True)
        output_dir.mkdir(parents=True, exist_ok=True)
        
        # 直接使用"新建会话"作为初始名称
        session_name = "新建会话"
        
        # 保存会话信息
        self.sessions[session_id] = {
            'id': session_id,
            'name': session_name,
            'folder_name': folder_name,  # 保存文件夹名称
            'created_at': datetime.now().isoformat(),
            'workspace_path': str(workspace_dir),
            'output_path': str(output_dir),
            'messages': [],
            'name_generated': False  # 标记会话名称是否已生成
        }
        
        self._save_sessions()
        
        return self.sessions[session_id]
    
    def update_session_name(self, session_id, new_name):
        """更新会话名称"""
        if session_id in self.sessions:
            self.sessions[session_id]['name'] = new_name
            self.sessions[session_id]['name_generated'] = True
            self._save_sessions()
            return True
        return False
    
    def delete_session(self, session_id):
        """删除会话"""
        if session_id not in self.sessions:
            return False
        
        # 获取文件夹名称
        session = self.sessions[session_id]
        folder_name = session.get('folder_name', session_id)
        
        # 删除会话目录
        session_dir = self.workspace_root / folder_name
        if session_dir.exists():
            shutil.rmtree(session_dir)
        
        # 从会话列表中删除
        del self.sessions[session_id]
        self._save_sessions()
        
        return True
    
    def list_sessions(self):
        """列出所有会话"""
        return list(self.sessions.values())
    
    def get_session(self, session_id):
        """获取会话信息"""
        return self.sessions.get(session_id)
    
    def is_session_name_generated(self, session_id):
        """检查会话名称是否已生成"""
        if session_id in self.sessions:
            return self.sessions[session_id].get('name_generated', False)
        return False
    
    def get_session_files(self, session_id):
        """获取会话的文件列表"""
        if session_id not in self.sessions:
            return {'workspace': [], 'output': []}
        
        session = self.sessions[session_id]
        workspace_path = Path(session['workspace_path'])
        output_path = Path(session['output_path'])
        
        def list_files(directory):
            files = []
            if directory.exists():
                for item in directory.rglob('*'):
                    if item.is_file():
                        rel_path = item.relative_to(directory)
                        files.append({
                            'filename': item.name,
                            'filepath': str(rel_path),
                            'size': item.stat().st_size,
                            'modified': datetime.fromtimestamp(item.stat().st_mtime).isoformat()
                        })
            return files
        
        return {
            'workspace': list_files(workspace_path),
            'output': list_files(output_path)
        }
    
    def save_file(self, session_id, file, folder='workspace'):
        """保存文件到会话目录"""
        if session_id not in self.sessions:
            return False
        
        session = self.sessions[session_id]
        target_dir = Path(session[f'{folder}_path'])
        
        # 确保目录存在
        target_dir.mkdir(parents=True, exist_ok=True)
        
        file_path = target_dir / file.filename
        file.save(str(file_path))
        
        return True
    
    def delete_file(self, session_id, filepath):
        """删除文件"""
        if session_id not in self.sessions:
            return False
        
        session = self.sessions[session_id]
        
        # 尝试从工作区和输出区删除
        for folder in ['workspace', 'output']:
            full_path = Path(session[f'{folder}_path']) / filepath
            if full_path.exists():
                full_path.unlink()
                return True
        
        return False
    
    def get_file_path(self, session_id, filepath):
        """获取文件的绝对路径"""
        if session_id not in self.sessions:
            return None
        
        session = self.sessions[session_id]
        
        # 尝试从工作区和输出区查找
        for folder in ['workspace', 'output']:
            full_path = Path(session[f'{folder}_path']) / filepath
            if full_path.exists():
                # 返回绝对路径
                return str(full_path.absolute())
        
        return None
    
    def add_message(self, session_id, message):
        """添加消息到会话"""
        if session_id in self.sessions:
            self.sessions[session_id]['messages'].append(message)
            self._save_sessions()
    
    def get_messages(self, session_id):
        """获取会话的消息历史"""
        if session_id in self.sessions:
            return self.sessions[session_id]['messages']
        return []
    
    def clear_messages(self, session_id):
        """清空会话的消息历史"""
        if session_id in self.sessions:
            self.sessions[session_id]['messages'] = []
            self._save_sessions()
            return True
        return False

