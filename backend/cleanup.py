#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
清理脚本 - 清理临时文件和旧日志
"""

import os
import shutil
from pathlib import Path
from datetime import datetime, timedelta

def cleanup_temp_files(workspace_root):
    """清理临时代码文件"""
    workspace_path = Path(workspace_root)
    
    print("🧹 开始清理临时文件...")
    
    # 清理 .temp_code 目录
    temp_dirs = list(workspace_path.rglob('.temp_code'))
    for temp_dir in temp_dirs:
        if temp_dir.is_dir():
            try:
                shutil.rmtree(temp_dir)
                print(f"  ✓ 已删除: {temp_dir}")
            except Exception as e:
                print(f"  ✗ 删除失败: {temp_dir}, 错误: {e}")
    
    print(f"✅ 清理完成，共删除 {len(temp_dirs)} 个临时目录")

def cleanup_old_logs(workspace_root, days=7):
    """清理旧日志文件（默认保留7天）"""
    workspace_path = Path(workspace_root)
    cutoff_date = datetime.now() - timedelta(days=days)
    
    print(f"\n🧹 开始清理 {days} 天前的日志文件...")
    
    log_files = list(workspace_path.rglob('*.log'))
    deleted_count = 0
    
    for log_file in log_files:
        if log_file.is_file():
            file_time = datetime.fromtimestamp(log_file.stat().st_mtime)
            if file_time < cutoff_date:
                try:
                    log_file.unlink()
                    print(f"  ✓ 已删除: {log_file.name}")
                    deleted_count += 1
                except Exception as e:
                    print(f"  ✗ 删除失败: {log_file.name}, 错误: {e}")
    
    print(f"✅ 清理完成，共删除 {deleted_count} 个日志文件")

def cleanup_empty_sessions(workspace_root):
    """清理空会话目录"""
    workspace_path = Path(workspace_root)
    
    print("\n🧹 开始清理空会话目录...")
    
    deleted_count = 0
    for session_dir in workspace_path.glob('session_*'):
        if session_dir.is_dir():
            workspace = session_dir / 'workspace'
            output = session_dir / 'output'
            
            # 检查是否为空会话（工作区和输出区都为空）
            workspace_empty = not workspace.exists() or not any(workspace.iterdir())
            output_empty = not output.exists() or not any(output.iterdir())
            
            if workspace_empty and output_empty:
                try:
                    shutil.rmtree(session_dir)
                    print(f"  ✓ 已删除空会话: {session_dir.name}")
                    deleted_count += 1
                except Exception as e:
                    print(f"  ✗ 删除失败: {session_dir.name}, 错误: {e}")
    
    print(f"✅ 清理完成，共删除 {deleted_count} 个空会话")

if __name__ == '__main__':
    import json
    
    # 加载配置
    with open('config.json', 'r', encoding='utf-8') as f:
        config = json.load(f)
    
    workspace_root = config['workspace_root']
    
    print("=" * 60)
    print("AI自动化办公软件 - 清理工具")
    print("=" * 60)
    
    # 执行清理
    cleanup_temp_files(workspace_root)
    cleanup_old_logs(workspace_root, days=7)
    cleanup_empty_sessions(workspace_root)
    
    print("\n" + "=" * 60)
    print("清理完成！")
    print("=" * 60)

