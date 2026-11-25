#!/usr/bin/env python3
"""给 CI 生成的安卓项目注入桌面小组件（AppWidget）：
- Java: AcmWidgetProvider（读 Capacitor Preferences 的 acm_widget_summary 渲染）
- res/layout/acm_widget.xml、res/drawable/acm_widget_bg.xml、
  res/xml/acm_widget_info.xml、res/values/acm_widget_strings.xml
- AndroidManifest.xml 注入 <receiver>（幂等）
用法: python3 assets/inject-android-widget.py <AndroidManifest.xml路径>
"""
import os
import re
import sys

PACKAGE = 'com.example.aicredit'

JAVA = r'''
package com.example.aicredit;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.widget.RemoteViews;

import org.json.JSONObject;

/** 桌面小组件：展示剩余额度与待签到数，数据由 App 写入 Capacitor Preferences。 */
public class AcmWidgetProvider extends AppWidgetProvider {
    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        for (int id : ids) {
            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.acm_widget);
            String remaining = "打开 App 查看额度";
            String sub = "剩余额度 · 待签到";
            try {
                SharedPreferences prefs = context.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE);
                String raw = prefs.getString("acm_widget_summary", null);
                if (raw != null) {
                    JSONObject o = new JSONObject(raw);
                    remaining = o.optString("remainingText", remaining);
                    int pending = o.optInt("pendingCheckins", -1);
                    String updated = o.optString("updatedLabel", "");
                    StringBuilder sb = new StringBuilder();
                    if (pending >= 0) sb.append("待签到 ").append(pending).append(" 个");
                    if (updated.length() > 0) {
                        if (sb.length() > 0) sb.append(" · ");
                        sb.append(updated).append(" 更新");
                    }
                    if (sb.length() > 0) sub = sb.toString();
                }
            } catch (Exception ignored) {
                // 数据缺失/损坏时保留占位文案
            }
            views.setTextViewText(R.id.acm_widget_remaining, remaining);
            views.setTextViewText(R.id.acm_widget_sub, sub);
            Intent intent = new Intent(context, MainActivity.class);
            intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent pi = PendingIntent.getActivity(context, 0, intent,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            views.setOnClickPendingIntent(R.id.acm_widget_root, pi);
            manager.updateAppWidget(id, views);
        }
    }
}
'''.lstrip()

LAYOUT = '''<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:id="@+id/acm_widget_root"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:orientation="vertical"
    android:background="@drawable/acm_widget_bg"
    android:padding="14dp">
    <TextView
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:text="AI 积分管家 · 剩余额度"
        android:textColor="#E9D5FF"
        android:textSize="12sp" />
    <TextView
        android:id="@+id/acm_widget_remaining"
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:layout_marginTop="4dp"
        android:text="打开 App 查看额度"
        android:textColor="#FFFFFF"
        android:textSize="24sp"
        android:textStyle="bold" />
    <TextView
        android:id="@+id/acm_widget_sub"
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:layout_marginTop="4dp"
        android:text="剩余额度 · 待签到"
        android:textColor="#E9D5FF"
        android:textSize="12sp" />
</LinearLayout>
'''

BG = '''<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <gradient android:startColor="#6D28D9" android:endColor="#9333EA" android:angle="45" />
    <corners android:radius="20dp" />
</shape>
'''

INFO = '''<?xml version="1.0" encoding="utf-8"?>
<appwidget-provider xmlns:android="http://schemas.android.com/apk/res/android"
    android:minWidth="180dp"
    android:minHeight="110dp"
    android:targetCellWidth="3"
    android:targetCellHeight="2"
    android:updatePeriodMillis="1800000"
    android:initialLayout="@layout/acm_widget"
    android:resizeMode="horizontal|vertical"
    android:widgetCategory="home_screen"
    android:description="@string/acm_widget_desc" />
'''

STRINGS = '''<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="acm_widget_desc">剩余额度与今日待签到速览</string>
    <string name="acm_widget_label">AI 积分管家</string>
</resources>
'''

RECEIVER = '''        <receiver android:name=".AcmWidgetProvider" android:exported="false" android:label="@string/acm_widget_label">
            <intent-filter>
                <action android:name="android.appwidget.action.APPWIDGET_UPDATE" />
            </intent-filter>
            <meta-data android:name="android.appwidget.provider" android:resource="@xml/acm_widget_info" />
        </receiver>
'''


def write(path, content):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)
    print('wrote', path)


def main():
    if len(sys.argv) < 2:
        print('usage: inject-android-widget.py <AndroidManifest.xml>')
        sys.exit(1)
    manifest = sys.argv[1]
    main_dir = os.path.dirname(os.path.abspath(manifest))  # .../app/src/main
    pkg_path = PACKAGE.replace('.', '/')

    write(os.path.join(main_dir, 'java', pkg_path, 'AcmWidgetProvider.java'), JAVA)
    write(os.path.join(main_dir, 'res', 'layout', 'acm_widget.xml'), LAYOUT)
    write(os.path.join(main_dir, 'res', 'drawable', 'acm_widget_bg.xml'), BG)
    write(os.path.join(main_dir, 'res', 'xml', 'acm_widget_info.xml'), INFO)
    write(os.path.join(main_dir, 'res', 'values', 'acm_widget_strings.xml'), STRINGS)

    with open(manifest, 'r', encoding='utf-8') as f:
        content = f.read()
    if 'AcmWidgetProvider' in content:
        print('widget receiver already present')
        return
    if '</application>' not in content:
        print('manifest </application> not found')
        sys.exit(1)
    content = content.replace('</application>', RECEIVER + '    </application>', 1)
    with open(manifest, 'w', encoding='utf-8') as f:
        f.write(content)
    print('injected widget receiver into manifest')


if __name__ == '__main__':
    main()
