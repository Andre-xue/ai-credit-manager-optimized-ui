#!/usr/bin/env python3
"""把固定 debug 签名配置注入生成的 app/build.gradle 末尾。

背景：AGP 默认从 ~/.android/debug.keystore 读 debug 签名，但 CI 上该路径
并未真正生效（每版 APK 签名都不同，用户无法覆盖安装）。改为在构建脚本里
显式指定 storeFile 绝对路径（环境变量 ACM_DEBUG_KEYSTORE），不依赖默认位置。

用法: inject-android-signing.py <path-to-app/build.gradle>
"""
import sys

MARKER = "// ACM-STABLE-DEBUG-SIGNING"
BLOCK = f"""
{MARKER}
// 固定签名：storeFile 由 CI 环境变量显式指定，保证每版签名一致、可覆盖安装。
// v0.1.285 起改走 release 构建：同一把固定密钥同时注入 debug 与 release 两套 signingConfig，
// release 构建的证书指纹与此前 debug 包完全一致（同一 keystore），老用户可直接覆盖安装，
// 且 release 构建不再带 android:debuggable=true。
android {{
    signingConfigs {{
        debug {{
            storeFile file(System.getenv("ACM_DEBUG_KEYSTORE"))
            storePassword "android"
            keyAlias "androiddebugkey"
            keyPassword "android"
        }}
        release {{
            storeFile file(System.getenv("ACM_DEBUG_KEYSTORE"))
            storePassword "android"
            keyAlias "androiddebugkey"
            keyPassword "android"
        }}
    }}
    buildTypes {{
        release {{
            signingConfig signingConfigs.release
        }}
    }}
}}
"""


def main() -> int:
    path = sys.argv[1]
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()
    if MARKER in content:
        print("signing config already injected, skip")
        return 0
    with open(path, "a", encoding="utf-8") as f:
        f.write(BLOCK)
    print(f"injected stable debug signing into {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
