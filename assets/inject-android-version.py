#!/usr/bin/env python3
"""把 CI 生成的 Android build.gradle 版本号与发布标签对齐（幂等）。
用法: python3 assets/inject-android-version.py <app/build.gradle> <v0.1.54>
"""
import re
import sys

if len(sys.argv) < 3:
    print('usage: inject-android-version.py <build.gradle> <tag>')
    sys.exit(1)

path, tag = sys.argv[1], sys.argv[2]
version = tag.lstrip('v')
nums = [int(x) for x in re.findall(r'\d+', version)[:3]]
while len(nums) < 3:
    nums.append(0)
code = nums[0] * 10000 + nums[1] * 100 + nums[2]

with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

content = re.sub(r'versionCode\s+\d+', f'versionCode {code}', content, count=1)
content = re.sub(r'versionName\s+"[^"]*"', f'versionName "{version}"', content, count=1)

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)
print(f'android versionName={version} versionCode={code}')
