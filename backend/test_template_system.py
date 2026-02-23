#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
模板系统测试脚本
测试新的参数化模板功能
"""

import sys
from pathlib import Path

# 添加 backend 目录到路径
sys.path.insert(0, str(Path(__file__).parent))

from modules.template_code_generator import TemplateCodeGenerator

def test_template_code_generator():
    """测试模板代码生成器"""
    print("=" * 60)
    print("测试：模板代码生成器")
    print("=" * 60)
    
    # 测试代码（新格式）
    template_code = '''#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
测试模板代码
"""

from pathlib import Path
import pandas as pd

# === 配置注入区域 START ===
# 此区域的变量会在模板执行时被自动替换
WORKSPACE_PATH = Path(r"{{WORKSPACE_PATH}}")
OUTPUT_PATH = Path(r"{{OUTPUT_PATH}}")
FILE_MAPPING = {{FILE_MAPPING_JSON}}
# === 配置注入区域 END ===

def main():
    """主函数"""
    print(f"工作区: {WORKSPACE_PATH}")
    print(f"输出区: {OUTPUT_PATH}")
    print(f"文件映射: {FILE_MAPPING}")
    
    # 读取输入文件
    input_file = WORKSPACE_PATH / FILE_MAPPING.get("员工信息.xlsx", "员工信息.xlsx")
    df = pd.read_excel(input_file)
    
    # 保存输出文件
    output_file = OUTPUT_PATH / FILE_MAPPING.get("统计结果.xlsx", "统计结果.xlsx")
    df.to_excel(output_file, index=False)
    
    print(f"✓ 处理完成: {output_file}")

if __name__ == "__main__":
    main()
'''
    
    # 测试配置
    workspace_path = "/Users/test/workspaces/session_123/workspace"
    output_path = "/Users/test/workspaces/session_123/output"
    file_mapping = {
        "员工信息.xlsx": "2024员工数据.xlsx",
        "统计结果.xlsx": "月度统计.xlsx"
    }
    
    print("\n【原始模板代码】")
    print(template_code[:300] + "...")
    
    print("\n【注入配置】")
    print(f"workspace_path: {workspace_path}")
    print(f"output_path: {output_path}")
    print(f"file_mapping: {file_mapping}")
    
    # 执行注入
    modified_code = TemplateCodeGenerator.inject_config_to_template(
        template_code,
        workspace_path,
        output_path,
        file_mapping
    )
    
    print("\n【注入后的代码】")
    print(modified_code[:500] + "...")
    
    # 验证注入结果
    assert workspace_path in modified_code, "❌ workspace_path 未正确注入"
    assert output_path in modified_code, "❌ output_path 未正确注入"
    assert "2024员工数据.xlsx" in modified_code, "❌ 文件映射未正确注入"
    assert "月度统计.xlsx" in modified_code, "❌ 文件映射未正确注入"
    assert "{{WORKSPACE_PATH}}" not in modified_code, "❌ 占位符未被替换"
    
    print("\n✅ 所有验证通过！")
    return True

def test_extract_file_references():
    """测试文件引用提取"""
    print("\n" + "=" * 60)
    print("测试：文件引用提取")
    print("=" * 60)
    
    template_code = '''
FILE_MAPPING = {
    "员工信息.xlsx": "员工信息.xlsx",
    "部门数据.csv": "部门数据.csv"
}

df = pd.read_excel("销售记录.xlsx")
df.to_csv("output.csv")
'''
    
    file_refs = TemplateCodeGenerator.extract_file_references(template_code)
    
    print(f"\n提取到的文件引用: {file_refs}")
    
    assert "员工信息.xlsx" in file_refs, "❌ 未提取到 员工信息.xlsx"
    assert "部门数据.csv" in file_refs, "❌ 未提取到 部门数据.csv"
    
    print("✅ 文件引用提取测试通过！")
    return True

def test_old_format_compatibility():
    """测试旧格式兼容性"""
    print("\n" + "=" * 60)
    print("测试：旧格式兼容性")
    print("=" * 60)
    
    # 旧格式代码（使用占位符）
    old_template = '''
from pathlib import Path

workspace_path = Path(r"{{WORKSPACE_PATH}}")
output_path = Path(r"{{OUTPUT_PATH}}")

input_file = workspace_path / "{{INPUT_FILE_1}}"
'''
    
    workspace_path = "/new/workspace"
    output_path = "/new/output"
    file_mapping = {"old_file.xlsx": "new_file.xlsx"}
    
    modified_code = TemplateCodeGenerator.inject_config_to_template(
        old_template,
        workspace_path,
        output_path,
        file_mapping
    )
    
    print("\n【修改后的代码】")
    print(modified_code)
    
    assert "/new/workspace" in modified_code, "❌ 旧格式路径未替换"
    assert "/new/output" in modified_code, "❌ 旧格式路径未替换"
    
    print("\n✅ 旧格式兼容性测试通过！")
    return True

def test_code_requirements():
    """测试代码要求生成"""
    print("\n" + "=" * 60)
    print("测试：代码要求生成")
    print("=" * 60)
    
    requirements = TemplateCodeGenerator.get_template_code_requirements()
    
    print("\n【生成的代码要求】")
    print(requirements[:300] + "...")
    
    assert "配置注入区域" in requirements, "❌ 缺少配置注入区域说明"
    assert "FILE_MAPPING" in requirements, "❌ 缺少 FILE_MAPPING 说明"
    assert "{{WORKSPACE_PATH}}" in requirements, "❌ 缺少占位符说明"
    
    print("\n✅ 代码要求生成测试通过！")
    return True

def main():
    """主测试函数"""
    print("\n" + "=" * 60)
    print("模板系统测试")
    print("=" * 60 + "\n")
    
    results = []
    
    try:
        results.append(("模板代码生成器", test_template_code_generator()))
    except Exception as e:
        print(f"❌ 测试失败: {e}")
        import traceback
        traceback.print_exc()
        results.append(("模板代码生成器", False))
    
    try:
        results.append(("文件引用提取", test_extract_file_references()))
    except Exception as e:
        print(f"❌ 测试失败: {e}")
        import traceback
        traceback.print_exc()
        results.append(("文件引用提取", False))
    
    try:
        results.append(("旧格式兼容性", test_old_format_compatibility()))
    except Exception as e:
        print(f"❌ 测试失败: {e}")
        import traceback
        traceback.print_exc()
        results.append(("旧格式兼容性", False))
    
    try:
        results.append(("代码要求生成", test_code_requirements()))
    except Exception as e:
        print(f"❌ 测试失败: {e}")
        import traceback
        traceback.print_exc()
        results.append(("代码要求生成", False))
    
    # 输出总结
    print("\n" + "=" * 60)
    print("测试总结")
    print("=" * 60)
    
    passed = sum(1 for _, result in results if result)
    total = len(results)
    
    for name, result in results:
        status = "✅ 通过" if result else "❌ 失败"
        print(f"{name}: {status}")
    
    print(f"\n总计: {passed}/{total} 测试通过")
    
    if passed == total:
        print("\n🎉 所有测试通过！模板系统优化成功。\n")
        return 0
    else:
        print(f"\n⚠️  有 {total - passed} 个测试失败。\n")
        return 1

if __name__ == "__main__":
    sys.exit(main())

