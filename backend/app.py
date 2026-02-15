import os
import json
import uuid
import threading
from concurrent.futures import ThreadPoolExecutor
from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
from pathlib import Path
from workflow_engine import WorkflowEngine
from session_manager import SessionManager
from template_manager import TemplateManager

app = Flask(__name__)

# 配置CORS，允许所有来源和方法
CORS(app, resources={
    r"/api/*": {
        "origins": "*",
        "methods": ["GET", "POST", "DELETE", "OPTIONS"],
        "allow_headers": ["Content-Type"]
    }
})

# 加载配置
with open('config.json', 'r', encoding='utf-8') as f:
    config = json.load(f)

# 初始化会话管理器
session_manager = SessionManager(config['workspace_root'])

# 初始化模板管理器
template_manager = TemplateManager(config['workspace_root'], config)

# 创建线程池，支持多个会话并发执行
executor = ThreadPoolExecutor(max_workers=10, thread_name_prefix="workflow_")

# 存储每个会话的执行状态和结果
execution_status = {}
execution_lock = threading.Lock()

@app.route('/api/sessions', methods=['GET'])
def get_sessions():
    """获取所有会话列表"""
    sessions = session_manager.list_sessions()
    return jsonify({'sessions': sessions})

@app.route('/api/sessions', methods=['POST'])
def create_session():
    """创建新会话"""
    try:
        data = request.json if request.json else {}
        user_input = data.get('user_input', '')
        
        # 生成会话ID
        session_id = str(uuid.uuid4())
        
        # 创建会话
        session = session_manager.create_session(session_id, user_input)
        
        print(f"✅ 创建新会话: {session_id}, 名称: {session['name']}")
        
        return jsonify({
            'session_id': session_id,
            'session_name': session['name'],
            'workspace_path': session['workspace_path'],
            'output_path': session['output_path']
        })
    except Exception as e:
        print(f"❌ 创建会话失败: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/sessions/<session_id>', methods=['DELETE'])
def delete_session(session_id):
    """删除会话"""
    success = session_manager.delete_session(session_id)
    return jsonify({'success': success})

@app.route('/api/sessions/<session_id>/files', methods=['GET'])
def get_session_files(session_id):
    """获取会话的工作区和输出区文件"""
    files = session_manager.get_session_files(session_id)
    return jsonify(files)

@app.route('/api/sessions/<session_id>/upload', methods=['POST'])
def upload_file(session_id):
    """上传文件到工作区"""
    try:
        print(f"📤 收到文件上传请求 - 会话ID: {session_id}")
        
        # 检查会话是否存在
        session = session_manager.get_session(session_id)
        if not session:
            print(f"❌ 会话不存在: {session_id}")
            return jsonify({'error': '会话不存在'}), 400
        
        if 'file' not in request.files:
            print(f"❌ 请求中没有文件")
            return jsonify({'error': '没有文件'}), 400
        
        file = request.files['file']
        if file.filename == '':
            print(f"❌ 文件名为空")
            return jsonify({'error': '文件名为空'}), 400
        
        print(f"📄 文件名: {file.filename}")
        
        # 检查文件类型
        allowed_extensions = {'.xlsx', '.xls', '.csv', '.docx', '.doc', '.pdf', '.png', '.jpg', '.jpeg', '.gif', '.txt'}
        file_ext = Path(file.filename).suffix.lower()
        
        print(f"📄 文件扩展名: {file_ext}")
        
        if file_ext not in allowed_extensions:
            print(f"❌ 不支持的文件类型: {file_ext}")
            return jsonify({'error': f'不支持的文件类型: {file_ext}'}), 400
        
        # 保存文件
        print(f"💾 开始保存文件...")
        success = session_manager.save_file(session_id, file, 'workspace')
        
        if success:
            print(f"✅ 文件保存成功: {file.filename}")
            return jsonify({'success': True, 'filename': file.filename})
        else:
            print(f"❌ 文件保存失败")
            return jsonify({'error': '保存文件失败'}), 500
            
    except Exception as e:
        print(f"❌ 上传文件异常: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/sessions/<session_id>/files/<path:filepath>', methods=['DELETE'])
def delete_file(session_id, filepath):
    """删除文件"""
    success = session_manager.delete_file(session_id, filepath)
    return jsonify({'success': success})

@app.route('/api/sessions/<session_id>/files/<path:filepath>', methods=['GET'])
def download_file(session_id, filepath):
    """下载文件"""
    file_path = session_manager.get_file_path(session_id, filepath)
    if file_path and os.path.exists(file_path):
        return send_file(file_path, as_attachment=True)
    else:
        return jsonify({'error': '文件不存在'}), 404

@app.route('/api/sessions/<session_id>/open/<path:filepath>', methods=['POST'])
def open_file(session_id, filepath):
    """获取文件的绝对路径，用于在系统中打开"""
    print(f"📂 请求打开文件: {filepath}")
    print(f"📂 会话ID: {session_id}")
    
    # 移除路径前缀（workspace/ 或 output/）
    clean_filepath = filepath
    if filepath.startswith('workspace/'):
        clean_filepath = filepath[10:]  # 移除 "workspace/"
    elif filepath.startswith('output/'):
        clean_filepath = filepath[7:]  # 移除 "output/"
    
    print(f"📂 清理后的文件路径: {clean_filepath}")
    
    file_path = session_manager.get_file_path(session_id, clean_filepath)
    print(f"📂 获取到的文件路径: {file_path}")
    
    if file_path and os.path.exists(file_path):
        print(f"✅ 文件存在，返回绝对路径")
        return jsonify({'success': True, 'file_path': str(file_path)})
    else:
        print(f"❌ 文件不存在")
        return jsonify({'error': '文件不存在', 'success': False}), 404

def _execute_workflow_task(session_id, user_input):
    """在后台线程中执行工作流"""
    try:
        print(f"🔄 [线程 {threading.current_thread().name}] 开始执行工作流 - 会话ID: {session_id}")
        
        # 创建工作流引擎
        engine = WorkflowEngine(config, session_id, session_manager)
        
        # 执行工作流
        result = engine.execute(user_input)
        
        # 如果会话名称被更新，返回更新后的会话名称
        if result.get('session_name_updated'):
            session = session_manager.get_session(session_id)
            result['session_name'] = session['name']
        
        # 更新执行状态
        with execution_lock:
            execution_status[session_id] = {
                'status': 'completed',
                'result': result,
                'error': None
            }
        
        print(f"✅ [线程 {threading.current_thread().name}] 工作流执行完成 - 会话ID: {session_id}")
        
    except Exception as e:
        error_msg = str(e)
        print(f"❌ [线程 {threading.current_thread().name}] 工作流执行失败 - 会话ID: {session_id}, 错误: {error_msg}")
        import traceback
        traceback.print_exc()
        
        # 更新执行状态
        with execution_lock:
            execution_status[session_id] = {
                'status': 'error',
                'result': None,
                'error': error_msg
            }

@app.route('/api/sessions/<session_id>/execute', methods=['POST'])
def execute_workflow(session_id):
    """异步执行工作流"""
    try:
        data = request.json
        user_input = data.get('user_input', '')
        
        print(f"📝 收到执行请求 - 会话ID: {session_id}")
        print(f"📝 用户输入: {user_input}")
        
        # 检查该会话是否已经在执行中
        with execution_lock:
            if session_id in execution_status and execution_status[session_id]['status'] == 'executing':
                return jsonify({
                    'success': False,
                    'error': '该会话正在执行中，请等待完成后再试'
                }), 400
            
            # 标记为执行中
            execution_status[session_id] = {
                'status': 'executing',
                'result': None,
                'error': None
            }
        
        # 提交到线程池异步执行
        executor.submit(_execute_workflow_task, session_id, user_input)
        
        # 立即返回，告诉前端任务已提交
        return jsonify({
            'success': True,
            'status': 'executing',
            'message': '任务已提交，正在后台执行...'
        })
        
    except Exception as e:
        print(f"❌ 提交工作流任务失败: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e), 'success': False}), 500

@app.route('/api/sessions/<session_id>/status', methods=['GET'])
def get_execution_status(session_id):
    """获取会话的执行状态"""
    with execution_lock:
        if session_id not in execution_status:
            return jsonify({
                'status': 'idle',
                'result': None,
                'error': None
            })
        
        status_info = execution_status[session_id]
        
        # 如果已完成或出错，返回结果后清除状态
        if status_info['status'] in ['completed', 'error']:
            result = status_info.copy()
            del execution_status[session_id]
            return jsonify(result)
        
        # 如果正在执行，返回执行中状态
        return jsonify(status_info)

@app.route('/api/sessions/<session_id>/messages', methods=['GET'])
def get_messages(session_id):
    """获取会话的消息历史"""
    messages = session_manager.get_messages(session_id)
    return jsonify({'messages': messages})

@app.route('/api/sessions/<session_id>/messages', methods=['POST'])
def add_message(session_id):
    """添加消息到会话"""
    data = request.json
    message = data.get('message', {})
    
    session_manager.add_message(session_id, message)
    return jsonify({'success': True})

@app.route('/api/sessions/<session_id>/messages', methods=['DELETE'])
def clear_messages(session_id):
    """清空会话的消息历史"""
    success = session_manager.clear_messages(session_id)
    return jsonify({'success': success})

# ==================== 模板管理API ====================

@app.route('/api/templates', methods=['GET'])
def get_templates():
    """获取所有模板列表"""
    templates = template_manager.list_templates()
    return jsonify({'templates': templates})

@app.route('/api/templates/<template_id>', methods=['GET'])
def get_template(template_id):
    """获取模板详情"""
    template = template_manager.get_template(template_id)
    if template:
        return jsonify(template)
    else:
        return jsonify({'error': '模板不存在'}), 404

@app.route('/api/templates/<template_id>', methods=['DELETE'])
def delete_template(template_id):
    """删除模板"""
    success = template_manager.delete_template(template_id)
    return jsonify({'success': success})

@app.route('/api/templates/<template_id>/tags', methods=['POST'])
def add_template_tags(template_id):
    """为模板添加标签"""
    data = request.json
    tags = data.get('tags', [])
    success = template_manager.add_template_tags(template_id, tags)
    return jsonify({'success': success})

@app.route('/api/sessions/<session_id>/save-template', methods=['POST'])
def save_as_template(session_id):
    """将会话的成功代码保存为模板"""
    try:
        data = request.json
        task_description = data.get('task_description', '')
        code = data.get('code', '')
        file_info = data.get('file_info', [])
        output_files = data.get('output_files', [])
        
        template_id = template_manager.save_template(
            session_id,
            task_description,
            code,
            file_info,
            output_files
        )
        
        return jsonify({
            'success': True,
            'template_id': template_id,
            'message': '模板保存成功'
        })
    except Exception as e:
        return jsonify({'error': str(e), 'success': False}), 500

@app.route('/api/sessions/<session_id>/check-similar', methods=['POST'])
def check_similar_templates(session_id):
    """检查是否有相似的可复用模板"""
    try:
        data = request.json
        user_input = data.get('user_input', '')
        
        # 获取当前会话的文件信息
        files = session_manager.get_session_files(session_id)
        current_files = files.get('workspace', [])
        
        # 查找相似模板
        similar_templates = template_manager.find_similar_templates(user_input, current_files)
        
        return jsonify({
            'success': True,
            'has_similar': len(similar_templates) > 0,
            'similar_templates': similar_templates
        })
    except Exception as e:
        return jsonify({'error': str(e), 'success': False}), 500

@app.route('/api/templates/<template_id>/execute', methods=['POST'])
def execute_template(template_id):
    """执行模板代码"""
    try:
        data = request.json
        session_id = data.get('session_id', '')
        
        print(f"🔄 执行模板 {template_id} - 会话ID: {session_id}")
        
        # 获取模板
        template = template_manager.get_template(template_id)
        if not template:
            return jsonify({'error': '模板不存在', 'success': False}), 404
        
        # 获取当前会话的文件信息
        files = session_manager.get_session_files(session_id)
        current_files = files.get('workspace', [])
        
        if not current_files:
            return jsonify({
                'success': False,
                'error': '当前会话没有上传文件，请先上传文件'
            }), 400
        
        # 检查文件兼容性
        compatibility = template_manager.check_file_compatibility(template_id, current_files)
        
        if not compatibility['compatible']:
            return jsonify({
                'success': False,
                'error': '文件不兼容: ' + compatibility.get('reason', '未知原因'),
                'details': compatibility
            }), 400
        
        # 更新使用统计
        template_manager.update_template_usage(template_id)
        
        # 获取会话信息
        session = session_manager.get_session(session_id)
        workspace_path = Path(session['workspace_path'])
        output_path = Path(session['output_path'])
        
        # 确保输出目录存在
        output_path.mkdir(parents=True, exist_ok=True)
        
        # 读取模板代码
        code_file = template_manager.templates_dir / f"{template_id}.py"
        if not code_file.exists():
            return jsonify({'error': '模板代码文件不存在', 'success': False}), 404
            
        with open(code_file, 'r', encoding='utf-8') as f:
            code_content = f.read()
        
        print(f"📝 原始代码长度: {len(code_content)} 字符")
        
        # 创建临时代码文件
        temp_code_dir = workspace_path.parent / '.temp_code'
        temp_code_dir.mkdir(parents=True, exist_ok=True)
        temp_code_file = temp_code_dir / f'template_{template_id}_{session_id}.py'
        
        # 智能替换代码中的路径
        import re
        modified_code = code_content
        
        # 1. 替换 workspace_path 变量赋值
        modified_code = re.sub(
            r'workspace_path\s*=\s*Path\([^)]+\)',
            f'workspace_path = Path(r"{workspace_path}")',
            modified_code
        )
        
        # 2. 替换 output_path 变量赋值
        modified_code = re.sub(
            r'output_path\s*=\s*Path\([^)]+\)',
            f'output_path = Path(r"{output_path}")',
            modified_code
        )
        
        # 3. 获取模板原始文件名和当前文件名的映射
        template_files = template.get('file_info', [])
        file_mapping = {}
        
        if template_files and current_files:
            # 按文件扩展名匹配
            template_by_ext = {}
            current_by_ext = {}
            
            for tf in template_files:
                ext = Path(tf.get('name', '')).suffix.lower()
                if ext:
                    template_by_ext[ext] = tf.get('name', '')
            
            for cf in current_files:
                ext = Path(cf.get('name', '')).suffix.lower()
                if ext:
                    current_by_ext[ext] = cf.get('name', '')
            
            # 创建文件名映射
            for ext, template_name in template_by_ext.items():
                if ext in current_by_ext:
                    file_mapping[template_name] = current_by_ext[ext]
            
            print(f"📝 文件名映射: {file_mapping}")
            
            # 4. 替换代码中的文件名引用
            for old_name, new_name in file_mapping.items():
                # 替换字符串中的文件名（带引号）
                modified_code = modified_code.replace(f'"{old_name}"', f'"{new_name}"')
                modified_code = modified_code.replace(f"'{old_name}'", f"'{new_name}'")
                # 替换 f-string 中的文件名
                modified_code = modified_code.replace(f'/{old_name}', f'/{new_name}')
        
        print(f"📝 路径替换完成:")
        print(f"   workspace_path -> {workspace_path}")
        print(f"   output_path -> {output_path}")
        
        # 写入临时文件
        with open(temp_code_file, 'w', encoding='utf-8') as f:
            f.write(modified_code)
        
        print(f"📝 临时代码文件: {temp_code_file}")
        print(f"📁 工作目录: {workspace_path.parent}")
        
        # 使用subprocess执行代码
        import subprocess
        
        try:
            result = subprocess.run(
                ['python3', str(temp_code_file.absolute())],
                capture_output=True,
                text=True,
                timeout=300,
                cwd=str(workspace_path.parent),
                env={**os.environ, 'PYTHONIOENCODING': 'utf-8'}
            )
            
            print(f"📤 执行结果: returncode={result.returncode}")
            print(f"📤 标准输出:\n{result.stdout}")
            
            if result.stderr:
                print(f"⚠️ 错误输出:\n{result.stderr}")
            
            # 清理临时文件
            try:
                temp_code_file.unlink()
            except:
                pass
            
            if result.returncode == 0:
                return jsonify({
                    'success': True,
                    'output': result.stdout,
                    'message': '模板执行成功',
                    'compatibility_warning': compatibility.get('warning'),
                    'session_name_updated': True,
                    'session_name': template.get('name', '模板执行')
                })
            else:
                error_msg = result.stderr if result.stderr else result.stdout
                return jsonify({
                    'success': False,
                    'error': f'代码执行失败: {error_msg}',
                    'output': result.stdout,
                    'stderr': result.stderr
                }), 500
                
        except subprocess.TimeoutExpired:
            # 清理临时文件
            try:
                temp_code_file.unlink()
            except:
                pass
            return jsonify({
                'success': False,
                'error': '代码执行超时（超过5分钟）'
            }), 500
            
    except Exception as e:
        import traceback
        error_trace = traceback.format_exc()
        print(f"❌ 模板执行异常:\n{error_trace}")
        return jsonify({
            'error': f'模板执行失败: {str(e)}',
            'success': False,
            'traceback': error_trace
        }), 500

if __name__ == '__main__':
    # 确保工作区目录存在
    os.makedirs(config['workspace_root'], exist_ok=True)
    
    print("🚀 AI自动化办公软件后端启动中...")
    print(f"📁 工作区目录: {config['workspace_root']}")
    print(f"🔄 最大迭代次数: {config['max_iterations']}")
    print("=" * 50)
    
    # 关闭自动重载，避免工作区文件变化导致服务重启
    app.run(
        host='0.0.0.0', 
        port=5001, 
        debug=True,
        use_reloader=False  # 关闭自动重载
    )

