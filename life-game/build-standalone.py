#!/usr/bin/env python3
"""index.html / css / js を1枚のHTMLにまとめる。

  python3 build-standalone.py                -> standalone.html （個人データなし）
  python3 build-standalone.py --with-preset  -> standalone-personal.html （data/preset.js を同梱）
  python3 build-standalone.py --artifact     -> 埋め込み用の本文のみを標準出力へ
"""
import re
import sys
import pathlib

ROOT = pathlib.Path(__file__).parent
JS_ORDER = ['vendor/supabase.js', 'cloud.js', 'store.js', 'ui.js', 'status.js', 'tasks.js', 'network.js', 'credits.js', 'onboarding.js', 'app.js']


def bundle(with_preset=False):
    html = (ROOT / 'index.html').read_text(encoding='utf-8')
    css = (ROOT / 'css' / 'style.css').read_text(encoding='utf-8')
    js = '\n\n'.join(
        f'/* ===== {name} ===== */\n' + (ROOT / 'js' / name).read_text(encoding='utf-8')
        for name in JS_ORDER
    )
    html = html.replace('<link rel="stylesheet" href="css/style.css">',
                        '<style>\n' + css + '\n</style>')
    html = re.sub(r'\n?<script src="js/[^"]+"></script>', '', html)

    # 個人データ（preset）は既定では埋め込まない
    preset_path = ROOT / 'data' / 'preset.js'
    if with_preset and preset_path.exists():
        js = preset_path.read_text(encoding='utf-8') + '\n\n' + js
    html = re.sub(r'\n?<script src="data/preset.js"></script>', '', html)

    html = html.replace('</body>', '<script>\n' + js + '\n</script>\n</body>')
    return html


def artifact_body(html):
    """<body> の中身 + <title> + <style> だけを取り出す（Artifact 用）。"""
    title = re.search(r'<title>(.*?)</title>', html, re.S).group(1)
    style = re.search(r'<style>.*?</style>', html, re.S).group(0)
    body = re.search(r'<body>(.*?)</body>', html, re.S).group(1)
    compat = ("<style>\n"
              "/* Artifact の iframe 内でも全画面高になるように */\n"
              "html,body{height:100vh;min-height:100vh;margin:0}\n"
              "</style>")
    return f'<title>{title}</title>\n{style}\n{compat}\n{body}'


if __name__ == '__main__':
    with_preset = '--with-preset' in sys.argv
    out = bundle(with_preset)
    if '--artifact' in sys.argv:
        sys.stdout.write(artifact_body(out))
    elif with_preset:
        # 個人データ入り。.gitignore で除外されている
        (ROOT / 'standalone-personal.html').write_text(out, encoding='utf-8')
        print(f'standalone-personal.html written ({len(out):,} bytes) ※個人データ入り')
    else:
        (ROOT / 'standalone.html').write_text(out, encoding='utf-8')
        print(f'standalone.html written ({len(out):,} bytes)')
