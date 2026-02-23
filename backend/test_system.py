#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
系统测试脚本 - 验证所有模块是否正常工作
"""

import sys
import json
from pathlib import Path

def test_imports():
    """测试所有模块导入"""
    print("=" * 60)
    print("测试 1: 模块导入")
    print("=" * 60)
    
    try:
        from modules.pm_module import PMModule
        print("✓ PMModule 导入成功")
    except Exception as e:
        print(f"✗ PMModule 导入失败: {e}")
        return False
    
    try:
        from modules.planner_module import PlannerModule
        print("✓ PlannerModule 导入成功")
    except Exception as e:
        print(f"✗ PlannerModule 导入失败: {e}")
        return False
    
    try:
        from modules.preprocessor_module import PreprocessorModule
        print("✓ PreprocessorModule 导入成功")
    except Exception as e:
        print(f"✗ PreprocessorModule 导入失败: {e}")
        return False
    
    try:
        from modules.coder_module import CoderModule
        print("✓ CoderModule 导入成功")
    except Exception as e:
        print(f"✗ CoderModule 导入失败: {e}")
        return False
    
    try:
        from modules.reviewer_module import ReviewerModule
        print("✓ ReviewerModule 导入成功")
    except Exception as e:
        print(f"✗ ReviewerModule 导入失败: {e}")
        return False
    
    try:
        from modules.file_reader import FileReader
        print("✓ FileReader 导入成功")
    except Exception as e:
        print(f"✗ FileReader 导入失败: {e}")
        return False
    
    try:
        from workflow_engine import WorkflowEngine
        print("✓ WorkflowEngine 导入成功")
    except Exception as e:
        print(f"✗ WorkflowEngine 导入失败: {e}")
        return False
    
    try:
        from session_manager import SessionManager
        print("✓ SessionManager 导入成功")
    except Exception as e:
        print(f"✗ SessionManager 导入失败: {e}")
        return False
    
    try:
        from template_manager import TemplateManager
        print("✓ TemplateManager 导入成功")
    except Exception as e:
        print(f"✗ TemplateManager 导入失败: {e}")
        return False
    
    print("\n✅ 所有模块导入成功！\n")
    return True

def test_config():
    """测试配置文件"""
    print("=" * 60)
    print("测试 2: 配置文件")
    print("=" * 60)
    
    config_file = Path('config.json')
    if not config_file.exists():
        print("✗ config.json 不存在")
        return False
    
    try:
        with open(config_file, 'r', encoding='utf-8') as f:
            config = json.load(f)
        
        required_keys = ['deepseek_api_key', 'deepseek_base_url', 'workspace_root']
        for key in required_keys:
            if key not in config:
                print(f"✗ 配置缺少必需字段: {key}")
                return False
            print(f"✓ {key}: {config[key][:20]}..." if len(str(config[key])) > 20 else f"✓ {key}: {config[key]}")
        
        print("\n✅ 配置文件正常！\n")
        return True
    except Exception as e:
        print(f"✗ 读取配置文件失败: {e}")
        return False

def test_workflow_engine():
    """测试工作流引擎"""
    print("=" * 60)
    print("测试 3: 工作流引擎")
    print("=" * 60)
    
    try:
        from workflow_engine import WorkflowEngine
        from session_manager import SessionManager
        import json
        
        # 加载配置
        with open('config.json', 'r', encoding='utf-8') as f:
            config = json.load(f)
        
        # 创建会话管理器
        session_manager = SessionManager(config['workspace_root'])
        
        # 创建测试会话
        test_session_id = 'test_session_123'
        session = session_manager.create_session(test_session_id, '测试会话')
        
        print(f"✓ 创建测试会话: {test_session_id}")
        print(f"  会话名称: {session['name']}")
        print(f"  工作区: {session['workspace_path']}")
        print(f"  输出区: {session['output_path']}")
        
        # 创建工作流引擎
        engine = WorkflowEngine(config, test_session_id, session_manager)
        print("✓ 工作流引擎初始化成功")
        
        # 检查关键方法是否存在
        assert hasattr(engine, 'execute'), "缺少 execute 方法"
        assert hasattr(engine, '_execute_code'), "缺少 _execute_code 方法"
        assert hasattr(engine, '_build_interrupted_result'), "缺少 _build_interrupted_result 方法"
        print("✓ 所有必需方法都存在")
        
        # 清理测试会话
        session_manager.delete_session(test_session_id)
        print("✓ 清理测试会话")
        
        print("\n✅ 工作流引擎测试通过！\n")
        return True
        
    except Exception as e:
        print(f"✗ 工作流引擎测试失败: {e}")
        import traceback
        traceback.print_exc()
        return False

def test_reviewer_module():
    """测试验收员模块"""
    print("=" * 60)
    print("测试 4: 验收员模块")
    print("=" * 60)
    
    try:
        from modules.reviewer_module import ReviewerModule
        import json
        
        # 加载配置
        with open('config.json', 'r', encoding='utf-8') as f:
            config = json.load(f)
        
        reviewer = ReviewerModule(config)
        print("✓ ReviewerModule 初始化成功")
        
        # 检查关键方法
        assert hasattr(reviewer, 'review'), "缺少 review 方法"
        assert hasattr(reviewer, '_analyze_error_and_suggest_fix'), "缺少 _analyze_error_and_suggest_fix 方法"
        assert hasattr(reviewer, '_regular_review'), "缺少 _regular_review 方法"
        print("✓ 所有必需方法都存在")
        
        print("\n✅ 验收员模块测试通过！\n")
        return True
        
    except Exception as e:
        print(f"✗ 验收员模块测试失败: {e}")
        import traceback
        traceback.print_exc()
        return False

def main():
    """主测试函数"""
    print("\n" + "=" * 60)
    print("AI 自动化办公助手 - 系统测试")
    print("=" * 60 + "\n")
    
    results = []
    
    # 运行所有测试
    results.append(("模块导入", test_imports()))
    results.append(("配置文件", test_config()))
    results.append(("工作流引擎", test_workflow_engine()))
    results.append(("验收员模块", test_reviewer_module()))
    
    # 输出总结
    print("=" * 60)
    print("测试总结")
    print("=" * 60)
    
    passed = sum(1 for _, result in results if result)
    total = len(results)
    
    for name, result in results:
        status = "✅ 通过" if result else "❌ 失败"
        print(f"{name}: {status}")
    
    print(f"\n总计: {passed}/{total} 测试通过")
    
    if passed == total:
        print("\n🎉 所有测试通过！系统运行正常。\n")
        return 0
    else:
        print(f"\n⚠️  有 {total - passed} 个测试失败，请检查错误信息。\n")
        return 1

if __name__ == "__main__":
    sys.exit(main())

