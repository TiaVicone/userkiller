#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
后端模块优化验证脚本
测试新的模块是否正常工作
"""

import sys
import json
from pathlib import Path

# 添加模块路径
sys.path.insert(0, str(Path(__file__).parent))

def test_file_reader():
    """测试FileReader模块"""
    print("=" * 60)
    print("测试 1: FileReader 模块")
    print("=" * 60)
    
    try:
        from modules.file_reader import FileReader
        
        reader = FileReader()
        print("✅ FileReader 导入成功")
        
        # 测试基本功能
        test_path = Path(__file__).parent / "workspaces"
        if test_path.exists():
            result = reader.read_workspace_files(test_path, include_content=False)
            print(f"✅ 读取文件元数据成功，找到 {len(result['files'])} 个文件")
        else:
            print("⚠️  测试目录不存在，跳过实际读取测试")
        
        return True
    except Exception as e:
        print(f"❌ FileReader 测试失败: {e}")
        import traceback
        traceback.print_exc()
        return False

def test_pm_module():
    """测试PM模块"""
    print("\n" + "=" * 60)
    print("测试 2: PM 模块")
    print("=" * 60)
    
    try:
        from modules.pm_module import PMModule
        
        config = {
            'deepseek_api_key': 'test_key',
            'deepseek_base_url': 'https://api.deepseek.com'
        }
        
        pm = PMModule(config)
        print("✅ PM模块 导入成功")
        print("✅ PM模块 初始化成功")
        
        # 检查是否有file_reader属性
        if hasattr(pm, 'file_reader'):
            print("✅ PM模块 已集成 FileReader")
        else:
            print("❌ PM模块 未集成 FileReader")
            return False
        
        return True
    except Exception as e:
        print(f"❌ PM模块 测试失败: {e}")
        import traceback
        traceback.print_exc()
        return False

def test_planner_module():
    """测试Planner模块"""
    print("\n" + "=" * 60)
    print("测试 3: Planner 模块")
    print("=" * 60)
    
    try:
        from modules.planner_module import PlannerModule
        
        config = {
            'deepseek_api_key': 'test_key',
            'deepseek_base_url': 'https://api.deepseek.com'
        }
        
        planner = PlannerModule(config)
        print("✅ Planner模块 导入成功")
        print("✅ Planner模块 初始化成功")
        
        # 检查plan方法的参数
        import inspect
        sig = inspect.signature(planner.plan)
        params = list(sig.parameters.keys())
        
        if 'file_data' in params:
            print("✅ Planner模块 已支持 file_data 参数")
        else:
            print("❌ Planner模块 未支持 file_data 参数")
            return False
        
        return True
    except Exception as e:
        print(f"❌ Planner模块 测试失败: {e}")
        import traceback
        traceback.print_exc()
        return False

def test_preprocessor_module():
    """测试Preprocessor模块"""
    print("\n" + "=" * 60)
    print("测试 4: Preprocessor 模块")
    print("=" * 60)
    
    try:
        from modules.preprocessor_module import PreprocessorModule
        
        config = {
            'qianwen_api_key': '',
            'qianwen_base_url': 'https://dashscope.aliyuncs.com/compatible-mode/v1'
        }
        
        preprocessor = PreprocessorModule(config)
        print("✅ Preprocessor模块 导入成功")
        print("✅ Preprocessor模块 初始化成功")
        
        # 检查process方法的参数
        import inspect
        sig = inspect.signature(preprocessor.process)
        params = list(sig.parameters.keys())
        
        if 'file_data' in params:
            print("✅ Preprocessor模块 已支持 file_data 参数")
        else:
            print("❌ Preprocessor模块 未支持 file_data 参数")
            return False
        
        return True
    except Exception as e:
        print(f"❌ Preprocessor模块 测试失败: {e}")
        import traceback
        traceback.print_exc()
        return False

def test_coder_module():
    """测试Coder模块"""
    print("\n" + "=" * 60)
    print("测试 5: Coder 模块")
    print("=" * 60)
    
    try:
        from modules.coder_module import CoderModule
        
        config = {
            'deepseek_api_key': 'test_key',
            'deepseek_base_url': 'https://api.deepseek.com'
        }
        
        coder = CoderModule(config)
        print("✅ Coder模块 导入成功")
        print("✅ Coder模块 初始化成功")
        
        return True
    except Exception as e:
        print(f"❌ Coder模块 测试失败: {e}")
        import traceback
        traceback.print_exc()
        return False

def test_reviewer_module():
    """测试Reviewer模块"""
    print("\n" + "=" * 60)
    print("测试 6: Reviewer 模块")
    print("=" * 60)
    
    try:
        from modules.reviewer_module import ReviewerModule
        
        config = {
            'deepseek_api_key': 'test_key',
            'deepseek_base_url': 'https://api.deepseek.com'
        }
        
        reviewer = ReviewerModule(config)
        print("✅ Reviewer模块 导入成功")
        print("✅ Reviewer模块 初始化成功")
        
        return True
    except Exception as e:
        print(f"❌ Reviewer模块 测试失败: {e}")
        import traceback
        traceback.print_exc()
        return False

def test_workflow_engine():
    """测试WorkflowEngine"""
    print("\n" + "=" * 60)
    print("测试 7: WorkflowEngine")
    print("=" * 60)
    
    try:
        from workflow_engine import WorkflowEngine
        print("✅ WorkflowEngine 导入成功")
        
        return True
    except Exception as e:
        print(f"❌ WorkflowEngine 测试失败: {e}")
        import traceback
        traceback.print_exc()
        return False

def main():
    """主测试函数"""
    print("\n" + "🚀" * 30)
    print("后端模块优化验证测试")
    print("🚀" * 30 + "\n")
    
    tests = [
        ("FileReader", test_file_reader),
        ("PM模块", test_pm_module),
        ("Planner模块", test_planner_module),
        ("Preprocessor模块", test_preprocessor_module),
        ("Coder模块", test_coder_module),
        ("Reviewer模块", test_reviewer_module),
        ("WorkflowEngine", test_workflow_engine),
    ]
    
    results = []
    for name, test_func in tests:
        result = test_func()
        results.append((name, result))
    
    # 打印总结
    print("\n" + "=" * 60)
    print("测试总结")
    print("=" * 60)
    
    passed = sum(1 for _, result in results if result)
    total = len(results)
    
    for name, result in results:
        status = "✅ 通过" if result else "❌ 失败"
        print(f"{name:20s} {status}")
    
    print("-" * 60)
    print(f"总计: {passed}/{total} 通过")
    
    if passed == total:
        print("\n🎉 所有测试通过！模块优化成功！")
        return 0
    else:
        print(f"\n⚠️  有 {total - passed} 个测试失败，请检查")
        return 1

if __name__ == "__main__":
    sys.exit(main())

