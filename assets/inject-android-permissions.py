#!/usr/bin/env python3
"""给 CI 生成的 AndroidManifest.xml 注入相机/相册/存储/麦克风权限（幂等），
并注入语音识别服务的 <queries> 可见性声明（Android 11+ 包可见性规则：
没有这段声明，系统语音识别服务对应用不可见，SpeechRecognition.available() 恒为 false）。
用法: python3 assets/inject-android-permissions.py <AndroidManifest.xml路径>
"""
import sys
import re

PERMISSIONS = [
    'android.permission.RECORD_AUDIO',
    'android.permission.CAMERA',
    'android.permission.READ_MEDIA_IMAGES',
    'android.permission.READ_MEDIA_VIDEO',
    'android.permission.READ_EXTERNAL_STORAGE',
    'android.permission.WRITE_EXTERNAL_STORAGE',
]

def main():
    if len(sys.argv) < 2:
        print('usage: inject-android-permissions.py <manifest>')
        sys.exit(1)
    path = sys.argv[1]
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()
    # 找 <manifest ...> 标签结束位置
    m = re.search(r'<manifest[^>]*>', content)
    if not m:
        print('manifest tag not found')
        sys.exit(1)
    insert_at = m.end()
    lines = []
    for perm in PERMISSIONS:
        # 若已存在同名权限则跳过（幂等）
        name = perm.split('.')[-1]
        if re.search(rf'android:name="[^"]*{name}"', content):
            continue
        # READ/WRITE_EXTERNAL_STORAGE 在 Android 13+ 意义有限，加 maxSdkVersion 避免 Google Play 声明冲突
        if 'EXTERNAL_STORAGE' in perm:
            lines.append(f'    <uses-permission android:name="{perm}" android:maxSdkVersion="32" />')
        else:
            lines.append(f'    <uses-permission android:name="{perm}" />')
    changed = False
    if lines:
        block = '\n' + '\n'.join(lines)
        content = content[:insert_at] + block + content[insert_at:]
        changed = True
        print('injected', len(lines), 'permissions')
    else:
        print('permissions already present')
    # 关闭应用数据备份（v0.1.285）：模板默认 allowBackup=true，adb backup/云备份可带走
    # 保险箱密文与本地数据；显式置 false（幂等：已有该属性则改值）。
    app_m = re.search(r'<application\b[^>]*>', content)
    if app_m:
        tag = app_m.group(0)
        if 'android:allowBackup' in tag:
            new_tag = re.sub(r'android:allowBackup="[^"]*"', 'android:allowBackup="false"', tag)
        else:
            new_tag = tag.replace('<application', '<application android:allowBackup="false"', 1)
        if new_tag != tag:
            content = content[:app_m.start()] + new_tag + content[app_m.end():]
            changed = True
            print('allowBackup set to false')
    else:
        print('application tag not found')
        sys.exit(1)
    # 语音识别服务可见性声明（幂等：已有 RecognitionService 则跳过）
    if 'android.speech.RecognitionService' not in content:
        queries = ('\n    <queries>\n'
                   '        <intent>\n'
                   '            <action android:name="android.speech.RecognitionService" />\n'
                   '        </intent>\n'
                   '    </queries>')
        # queries 放在 <application> 之前（与 uses-permission 同级）
        app_at = content.find('<application')
        if app_at > 0:
            content = content[:app_at] + queries.strip() + '\n    ' + content[app_at:]
            changed = True
            print('injected RecognitionService queries')
    else:
        print('RecognitionService queries already present')
    if changed:
        with open(path, 'w', encoding='utf-8') as f:
            f.write(content)

if __name__ == '__main__':
    main()
