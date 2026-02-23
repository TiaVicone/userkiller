#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
测试模板路径替换逻辑
"""

import re
from pathlib import Path

# 模拟原始模板代码
template_code = '''
workspace_path = Path(r"/Users/mutsumi/Documents/工作用/wpsKiller/userKiller/backend/workspaces/session_20260215_105842/workspace")
output_path = Path(r"/Users/mutsumi/Documents/工作用/wpsKiller/userKiller/backend/workspaces/session_20260215_105842/output")

input_file = workspace_path / "一月统计明细.xlsx"
'''

# 新的路径
new_workspace = "/Users/mutsumi/Documents/工作用/wpsKiller/userKiller/backend/workspaces/session_20260215_111831/workspace"
new_output = "/Users/mutsumi/Documents/工作用/wpsKiller/userKiller/backend/workspaces/session_20260215_111831/output"

# 文件名映射（即使相同也要映射）
file_mapping = {"一月统计明细.xlsx": "一月统计明细.xlsx"}

print("=" * 60)
print("原始代码:")
print("=" * 60)
print(template_code)

# 应用替换
modified_code = template_code

# 1. 替换 workspace_path
modified_code = re.sub(
    r'workspace_path\s*=\s*Path\([^)]+\)',
    f'workspace_path = Path(r"{new_workspace}")',
    modified_code
)

# 2. 替换 output_path
modified_code = re.sub(
    r'output_path\s*=\s*Path\([^)]+\)',
    f'output_path = Path(r"{new_output}")',
    modified_code
)

# 3. 替换文件名（即使相同）
for old_name, new_name in file_mapping.items():
    print(f"\n替换文件名: '{old_name}' -> '{new_name}'")
    modified_code = modified_code.replace(f'"{old_name}"', f'"{new_name}"')
    modified_code = modified_code.replace(f"'{old_name}'", f"'{new_name}'")

print("\n" + "=" * 60)
print("修改后代码:")
print("=" * 60)
print(modified_code)

print("\n" + "=" * 60)
print("验证:")
print("=" * 60)
print(f"✓ workspace_path 已更新: {new_workspace in modified_code}")
print(f"✓ output_path 已更新: {new_output in modified_code}")
print(f"✓ 文件名保持正确: {'一月统计明细.xlsx' in modified_code}")

