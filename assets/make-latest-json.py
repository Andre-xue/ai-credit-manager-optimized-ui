#!/usr/bin/env python3
"""Generate Tauri updater latest.json from built artifacts and .sig signature files.

Usage: python3 assets/make-latest-json.py <release-files-dir> <output-latest.json> <version> <repo>

Reads files produced by `tauri build` (with createUpdaterArtifacts=true and signing key):
  - macOS:   macos-*.app.tar.gz + .sig  -> darwin-aarch64
  - Windows: Windows-x64-*.exe/.msi + .sig -> windows-x86_64
  - Linux:   Linux-x64-*.AppImage + .sig -> linux-x86_64
The release-files dir has platform-prefixed flat files (from release.yml prepare step).
"""
import json
import sys
import glob
import os
import datetime
from urllib.parse import quote

release_dir = sys.argv[1]
out_path = sys.argv[2]
version = sys.argv[3].lstrip('v')
repo = sys.argv[4]

# mapping: platform key -> candidate artifact globs (exclude .sig)
PLATFORMS = {
    'darwin-aarch64': ['macOS-arm64-*.app.tar.gz', 'macOS-arm64-*.dmg'],
    'windows-x86_64': ['Windows-x64-*.exe', 'Windows-x64-*.msi'],
    'linux-x86_64': ['Linux-x64-*.AppImage', 'Linux-x64-*.deb'],
}

def find_one(patterns):
    for pat in patterns:
        hits = [f for f in glob.glob(os.path.join(release_dir, pat)) if not f.endswith('.sig')]
        if hits:
            return hits[0]
    return None

platforms = {}
for key, patterns in PLATFORMS.items():
    artifact = find_one(patterns)
    if not artifact:
        continue
    sig_path = artifact + '.sig'
    if not os.path.exists(sig_path):
        # signature is mandatory; skip platform without it
        print(f'warn: no .sig for {artifact}, skipping {key}', file=sys.stderr)
        continue
    with open(sig_path, 'r', encoding='utf-8') as f:
        signature = f.read().strip()
    if not signature:
        continue
    name = os.path.basename(artifact)
    # 关键修复：
    # 1) 文件名含空格（如 "AI Credit Manager.app.tar.gz"）必须 URL 编码，否则 Tauri 下载失败；
    # 2) URL 指向本 tag 而非 latest，保证签名(.sig)与下载文件严格对应（latest 会随新版本漂移导致签名不匹配）。
    encoded = quote(name, safe='')
    tag = 'v' + version.lstrip('v')
    url = f'https://github.com/{repo}/releases/download/{tag}/{encoded}'
    platforms[key] = {'signature': signature, 'url': url}

if not platforms:
    print('error: no signed artifacts found; latest.json not generated', file=sys.stderr)
    sys.exit(1)

manifest = {
    'version': version,
    'notes': f'AI 积分管家 {version}',
    'pub_date': datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
    'platforms': platforms,
}
with open(out_path, 'w', encoding='utf-8') as f:
    json.dump(manifest, f, ensure_ascii=False, indent=2)
print('wrote', out_path, 'platforms:', ', '.join(platforms.keys()))
