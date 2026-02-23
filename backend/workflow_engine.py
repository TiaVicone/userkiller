import os
import json
import subprocess
import traceback
from pathlib import Path
from datetime import datetime
from openai import OpenAI
from modules.pm_module import PMModule
from modules.planner_module import PlannerModule
from modules.preprocessor_module import PreprocessorModule
from modules.coder_module import CoderModule
from modules.reviewer_module import ReviewerModule

class WorkflowEngine:
    """工作流引擎"""
    
    def __init__(self, config, session_id, session_manager):
        self.config = config
        self.session_id = session_id
        self.session_manager = session_manager
        self.session = session_manager.get_session(session_id)
        
        # 初始化各个模块
        self.pm = PMModule(config)
        self.planner = PlannerModule(config)
        self.preprocessor = PreprocessorModule(config)
        self.coder = CoderModule(config)
        self.reviewer = ReviewerModule(config)
        
        # 工作流日志
        self.logs = []
        self.workflow_steps = []
        
        # 创建会话目录和临时代码目录
        session_dir = Path(self.session['workspace_path']).parent
        # 确保会话目录存在
        session_dir.mkdir(parents=True, exist_ok=True)
        
        self.temp_code_dir = session_dir / '.temp_code'
        self.temp_code_dir.mkdir(parents=True, exist_ok=True)
        
        # 创建日志文件
        self.log_file = session_dir / f"workflow_log_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log"
        self._init_log_file()
        
        # 中断控制
        self.interrupt_file = session_dir / '.interrupt'
        self.should_stop = False
        # 清除旧的中断标志
        if self.interrupt_file.exists():
            self.interrupt_file.unlink()
    
    def _init_log_file(self):
        """初始化日志文件"""
        with open(self.log_file, 'w', encoding='utf-8') as f:
            f.write("=" * 80 + "\n")
            f.write(f"AI自动化办公软件 - 工作流执行日志\n")
            f.write(f"会话ID: {self.session_id}\n")
            f.write(f"会话名称: {self.session['name']}\n")
            f.write(f"开始时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
            f.write("=" * 80 + "\n\n")
    
    def log(self, step, content, status='success'):
        """记录日志"""
        log_entry = {
            'timestamp': datetime.now().isoformat(),
            'step': step,
            'content': content,
            'status': status
        }
        self.logs.append(log_entry)
        
        # 打印到控制台
        print(f"[{step}] {content[:100]}...")
        
        # 写入日志文件
        self._write_to_log_file(step, content, status)
    
    def _write_to_log_file(self, step, content, status):
        """写入日志文件"""
        try:
            with open(self.log_file, 'a', encoding='utf-8') as f:
                timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
                f.write(f"\n{'=' * 80}\n")
                f.write(f"[{timestamp}] [{step}] 状态: {status}\n")
                f.write(f"{'-' * 80}\n")
                f.write(f"{content}\n")
        except Exception as e:
            print(f"写入日志文件失败: {e}")
    
    def check_interrupt(self):
        """检查是否需要中断执行"""
        if self.interrupt_file.exists():
            self.should_stop = True
            self.log('Interrupt', '⚠️ 用户请求中断执行', 'interrupted')
            return True
        return False
    
    def stop_execution(self):
        """停止执行（创建中断标志文件）"""
        try:
            self.interrupt_file.touch()
            return True
        except Exception as e:
            print(f"创建中断标志失败: {e}")
            return False
    
    def execute(self, user_input):
        """执行完整工作流"""
        session_name_updated = False
        
        try:
            # 如果会话名称还未生成，使用AI生成会话名称
            if not self.session_manager.is_session_name_generated(self.session_id):
                self.log('SessionNaming', '正在生成会话名称...')
                session_name = self.session_manager.generate_session_name(
                    user_input,
                    self.config['deepseek_api_key'],
                    self.config['deepseek_base_url']
                )
                self.session_manager.update_session_name(self.session_id, session_name)
                session_name_updated = True
                self.log('SessionNaming', f'会话名称已生成: {session_name}')
            
            # 1. PM模块：分析需求（只读取文件元数据）
            if self.check_interrupt():
                return self._build_interrupted_result(session_name_updated, iteration=0)
            
            self.log('PM', '产品经理开始分析需求...')
            pm_result = self.pm.analyze(
                user_input,
                Path(self.session['workspace_path'])
            )
            
            # 记录详细的PM分析结果
            pm_detail = f"用户输入: {user_input}\n\nPM分析结果:\n{json.dumps(pm_result['analysis'], ensure_ascii=False, indent=2)}"
            self.log('PM_Detail', pm_detail)
            
            # 为前端准备简化的输出
            pm_summary = {
                'intent': pm_result['analysis'].get('intent', ''),
                'user_goal': pm_result['analysis'].get('user_goal', ''),
                'target_files_count': len(pm_result['analysis'].get('target_files', [])),
                'target_files': [f.get('filename', f.get('path', '')) if isinstance(f, dict) else str(f) 
                                for f in pm_result['analysis'].get('target_files', [])],
                'success_criteria_count': len(pm_result['analysis'].get('success_criteria', []))
            }
            
            self.workflow_steps.append({
                'module': 'PM（产品经理）',
                'output': json.dumps(pm_summary, ensure_ascii=False, indent=2),
                'status': 'completed'
            })
            
            # 获取文件数据（包含完整内容，供后续模块使用）
            file_data = pm_result.get('file_data', {})
            
            # 2. 规划师模块：制定计划（接收PM的文件数据，避免重复读取）
            if self.check_interrupt():
                return self._build_interrupted_result(session_name_updated, iteration=0)
            
            self.log('Planner', '规划师开始制定执行计划...')
            
            # 如果file_data中没有内容，则读取完整内容
            if not file_data.get('content_previews') or file_data.get('content_previews') == '工作区暂无文件':
                from modules.file_reader import FileReader
                file_reader = FileReader()
                file_data = file_reader.read_workspace_files(
                    Path(self.session['workspace_path']), 
                    include_content=True
                )
            
            planner_result = self.planner.plan(
                user_input,
                pm_result['analysis'],
                file_data  # 传递文件数据
            )
            
            # 记录详细的规划结果
            planner_detail = f"规划结果:\n{json.dumps(planner_result['plan'], ensure_ascii=False, indent=2)}"
            self.log('Planner_Detail', planner_detail)
            
            # 为前端准备简化的输出
            planner_summary = {
                'required_files_count': len(planner_result.get('required_files', [])),
                'required_files': planner_result.get('required_files', []),
                'technical_libraries': planner_result['plan'].get('technical_approach', {}).get('libraries', []),
                'implementation_steps': len(planner_result['plan'].get('implementation_steps', [])),
                'output_file': planner_result['plan'].get('output_specification', {}).get('filename', ''),
                'output_format': planner_result['plan'].get('output_specification', {}).get('format', '')
            }
            
            self.workflow_steps.append({
                'module': '规划师',
                'output': json.dumps(planner_summary, ensure_ascii=False, indent=2),
                'status': 'completed'
            })
            
            # 3. 预处理模块：处理特殊文件（图片OCR、PDF提取）
            self.log('Preprocessor', '预处理模块开始处理特殊文件...')
            preprocessor_result = self.preprocessor.process(
                planner_result['required_files'],
                Path(self.session['workspace_path']),
                file_data  # 传递文件数据，避免重复读取
            )
            
            # 记录详细的预处理结果
            preprocessor_detail = f"预处理结果:\n{json.dumps(preprocessor_result, ensure_ascii=False, indent=2)}"
            self.log('Preprocessor_Detail', preprocessor_detail)
            
            self.workflow_steps.append({
                'module': '预处理',
                'output': f"已处理 {len(preprocessor_result['processed_files'])} 个文件",
                'status': 'completed',
                'details': preprocessor_result
            })
            
            # 4. Coder + Executor（+ Reviewer可选）
            iteration = 0
            max_iterations = self.config.get('max_iterations', 5)
            code_approved = False
            auto_review = self.config.get('auto_review', True)  # 默认启用自动验收
            
            # 如果禁用自动验收，只执行一次
            if not auto_review:
                max_iterations = 1
            
            while iteration < max_iterations and not code_approved:
                iteration += 1
                
                # 检查中断（迭代开始前）
                if self.check_interrupt():
                    return self._build_interrupted_result(session_name_updated, iteration)
                
                self.log('Coder', f'Coder开始生成代码（第{iteration}次尝试）...')
                
                # Coder生成代码
                coder_result = self.coder.generate_code(
                    user_input,
                    pm_result['analysis'],
                    planner_result['plan'],
                    preprocessor_result,
                    Path(self.session['workspace_path']),
                    Path(self.session['output_path']),
                    iteration,
                    self.temp_code_dir  # 传递临时代码目录
                )
                
                # 检查中断（代码生成后）
                if self.check_interrupt():
                    return self._build_interrupted_result(session_name_updated, iteration)
                
                # 记录详细的生成代码
                coder_detail = f"生成的代码 (第{iteration}次):\n\n{coder_result['code']}"
                self.log(f'Coder_Code_{iteration}', coder_detail)
                
                self.workflow_steps.append({
                    'module': f'Coder（第{iteration}次）',
                    'output': f"代码已生成: {coder_result['code_file']}",
                    'status': 'completed',
                    'code': coder_result['code']
                })
                
                # 检查中断（代码执行前）
                if self.check_interrupt():
                    return self._build_interrupted_result(session_name_updated, iteration)
                
                # 执行代码
                self.log('Executor', '执行生成的代码...')
                execution_result = self._execute_code(coder_result['code_file'])
                
                # 记录详细的执行结果
                exec_detail = f"执行结果 (第{iteration}次):\n成功: {execution_result['success']}\n\n标准输出:\n{execution_result.get('output', '')}\n\n错误输出:\n{execution_result.get('error', '')}"
                self.log(f'Executor_Result_{iteration}', exec_detail, 'success' if execution_result['success'] else 'error')
                
                self.workflow_steps.append({
                    'module': '代码执行',
                    'output': execution_result['output'] if execution_result['success'] else execution_result['error'],
                    'status': 'completed' if execution_result['success'] else 'error'
                })
                
                # 检查中断（代码执行后）
                if self.check_interrupt():
                    return self._build_interrupted_result(session_name_updated, iteration)
                
                # 检查是否启用自动验收
                if auto_review:
                    # 自动验收模式：使用Reviewer验收
                    self.log('Reviewer', '验收员开始验收结果...')
                    reviewer_result = self.reviewer.review(
                        user_input,
                        pm_result['analysis'],
                        coder_result['code'],
                        execution_result,
                        Path(self.session['output_path']),
                        Path(self.session['workspace_path']),
                        file_data
                    )
                    
                    # 记录详细的验收结果
                    reviewer_detail = f"验收结果 (第{iteration}次):\n通过: {reviewer_result['approved']}\n\n反馈:\n{reviewer_result['feedback']}\n\n问题列表:\n{json.dumps(reviewer_result.get('issues', []), ensure_ascii=False, indent=2)}"
                    self.log(f'Reviewer_Feedback_{iteration}', reviewer_detail, 'success' if reviewer_result['approved'] else 'needs_revision')
                    
                    self.workflow_steps.append({
                        'module': f'验收员（第{iteration}次）',
                        'output': reviewer_result['feedback'],
                        'status': 'completed' if reviewer_result['approved'] else 'needs_revision'
                    })
                    
                    if reviewer_result['approved']:
                        code_approved = True
                        self.log('Success', '任务完成！')
                    else:
                        self.log('Retry', f'需要改进，准备第{iteration + 1}次尝试...')
                        # 将反馈传递给下一次迭代
                        if iteration < max_iterations:
                            # 检查是否有深度错误分析
                            if reviewer_result.get('needs_deep_fix'):
                                self.coder.set_feedback(
                                    reviewer_result['feedback'],
                                    reviewer_result.get('error_analysis'),
                                    reviewer_result.get('code_modifications')
                                )
                            else:
                                self.coder.set_feedback(reviewer_result['feedback'])
                else:
                    # 手动验收模式：直接返回结果，等待用户确认
                    self.log('ManualReview', '⏸️  已暂停自动验收，等待用户手动确认...')
                    self.workflow_steps.append({
                        'module': '手动验收',
                        'output': '代码已执行，请查看输出文件并手动确认',
                        'status': 'pending_manual_review'
                    })
                    # 手动模式下，直接跳出循环
                    break
            
            # 写入最终总结
            final_summary = f"\n{'=' * 80}\n工作流执行完成\n{'=' * 80}\n"
            
            if not auto_review:
                final_summary += f"模式: 手动验收\n"
                final_summary += f"状态: 等待用户确认\n"
                final_summary += f"输出目录: {self.session['output_path']}\n"
            else:
                final_summary += f"模式: 自动验收\n"
                final_summary += f"成功: {code_approved}\n"
            
            final_summary += f"迭代次数: {iteration}\n"
            final_summary += f"结束时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n"
            final_summary += f"日志文件: {self.log_file}\n"
            self.log('Summary', final_summary)
            
            # 返回结果
            if not auto_review:
                # 手动验收模式
                return {
                    'success': True,
                    'workflow_steps': self.workflow_steps,
                    'logs': self.logs,
                    'iterations': iteration,
                    'message': '⏸️ 代码已生成并执行，请查看输出文件并手动确认结果',
                    'manual_review': True,
                    'output_path': self.session['output_path'],
                    'session_name_updated': session_name_updated,
                    'log_file': str(self.log_file),
                    # 添加代码信息，用于保存模板
                    'generated_code': coder_result.get('code', ''),
                    'code_file': coder_result.get('code_file', ''),
                    'task_description': user_input
                }
            else:
                # 自动验收模式
                return {
                    'success': code_approved,
                    'workflow_steps': self.workflow_steps,
                    'logs': self.logs,
                    'iterations': iteration,
                    'message': '任务成功完成！' if code_approved else f'达到最大迭代次数（{max_iterations}），任务未完成',
                    'manual_review': False,
                    'session_name_updated': session_name_updated,
                    'log_file': str(self.log_file),
                    # 添加代码信息，用于保存模板
                    'generated_code': coder_result.get('code', '') if code_approved else '',
                    'code_file': coder_result.get('code_file', '') if code_approved else '',
                    'task_description': user_input
                }
            
        except Exception as e:
            error_msg = f"工作流执行错误: {str(e)}\n{traceback.format_exc()}"
            self.log('Error', error_msg, 'error')
            
            # 写入错误总结
            error_summary = f"\n{'=' * 80}\n工作流执行失败\n{'=' * 80}\n"
            error_summary += f"错误信息: {str(e)}\n"
            error_summary += f"结束时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n"
            error_summary += f"日志文件: {self.log_file}\n"
            self.log('Error_Summary', error_summary, 'error')
            
            return {
                'success': False,
                'workflow_steps': self.workflow_steps,
                'logs': self.logs,
                'error': error_msg,
                'session_name_updated': session_name_updated,
                'log_file': str(self.log_file)
            }
    
    def _build_interrupted_result(self, session_name_updated, iteration):
        """构建中断结果"""
        return {
            'success': False,
            'workflow_steps': self.workflow_steps,
            'logs': self.logs,
            'iterations': iteration,
            'message': '⚠️ 执行已被用户中断',
            'interrupted': True,
            'session_name_updated': session_name_updated,
            'log_file': str(self.log_file)
        }
    
    def _execute_code(self, code_file):
        """执行Python代码"""
        try:
            code_path = Path(code_file)
            
            # 检查文件是否存在
            if not code_path.exists():
                error_msg = f"代码文件不存在: {code_file}"
                self.log('Executor_Error', error_msg, 'error')
                return {
                    'success': False,
                    'output': '',
                    'error': error_msg
                }
            
            # 记录执行信息
            exec_info = f"执行代码文件: {code_file}\n工作目录: {code_path.parent}\n文件大小: {code_path.stat().st_size} bytes"
            self.log('Executor_Info', exec_info)
            
            # 使用绝对路径执行
            result = subprocess.run(
                ['python3', str(code_path.absolute())],
                capture_output=True,
                text=True,
                timeout=300,  # 5分钟超时
                cwd=str(code_path.parent)
            )
            
            # 执行成功
            if result.returncode == 0:
                return {
                    'success': True,
                    'output': result.stdout if result.stdout else '代码执行成功，无输出',
                    'error': None
                }
            else:
                # 执行失败
                error_output = result.stderr if result.stderr else result.stdout
                return {
                    'success': False,
                    'output': result.stdout,
                    'error': error_output if error_output else f'代码执行失败，返回码: {result.returncode}'
                }
                
        except subprocess.TimeoutExpired:
            return {
                'success': False,
                'output': '',
                'error': '代码执行超时（超过5分钟）'
            }
        except Exception as e:
            error_detail = f'执行错误: {str(e)}\n{traceback.format_exc()}'
            self.log('Executor_Exception', error_detail, 'error')
            return {
                'success': False,
                'output': '',
                'error': error_detail
            }

