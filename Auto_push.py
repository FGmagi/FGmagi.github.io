#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
GitHub 自动推送控制台程序

流程:
    1. 展示最近 3 次(去重)的版本推送记录
    2. 用户输入新版本号 x.y.z; 直接回车 => 在上一次版本基础上 z + 1
    3. 依次执行:
           git add .
           git add -u
           git commit -m "<版本号>"
           git push origin main
"""

import re
import subprocess
import sys

VERSION_RE = re.compile(r'^v?(\d+\.\d+\.\d+)$')
REMOTE = 'origin'
BRANCH = 'main'
HISTORY_COUNT = 3


# ----------------------------------------------------------------------
# 工具函数
# ----------------------------------------------------------------------
def run(cmd, check=True):
    """执行命令并回显输出"""
    print(f"\n$ {' '.join(cmd)}")
    proc = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        encoding='utf-8',
        errors='replace',
    )
    out = (proc.stdout or '').strip()
    err = (proc.stderr or '').strip()
    if out:
        print(out)
    if err:
        print(err, file=sys.stderr)
    if check and proc.returncode != 0:
        raise RuntimeError(f"命令失败(退出码 {proc.returncode}): {' '.join(cmd)}")
    return proc


def ensure_git_repo():
    """确认当前目录在 git 仓库内"""
    proc = subprocess.run(
        ['git', 'rev-parse', '--is-inside-work-tree'],
        capture_output=True, text=True,
    )
    if proc.returncode != 0 or proc.stdout.strip() != 'true':
        print('当前目录不是 git 仓库，请先 git init 或切换到仓库目录。')
        sys.exit(1)


def git_log_subjects():
    """取所有提交标题"""
    proc = subprocess.run(
        ['git', 'log', '--pretty=format:%s'],
        capture_output=True, text=True, encoding='utf-8', errors='replace',
    )
    if proc.returncode != 0:
        return []
    return [line.strip() for line in proc.stdout.splitlines() if line.strip()]


def recent_versions(n=HISTORY_COUNT):
    """最近 n 条去重后的提交信息"""
    seen, result = set(), []
    for msg in git_log_subjects():
        if msg in seen:
            continue
        seen.add(msg)
        result.append(msg)
        if len(result) >= n:
            break
    return result


def last_version():
    """最近一条符合 x.y.z 的版本号"""
    for msg in git_log_subjects():
        m = VERSION_RE.match(msg)
        if m:
            return m.group(1)
    return None


def bump_patch(version):
    """小版本号 +1:  x.y.z -> x.y.(z+1)"""
    major, minor, patch = version.split('.')
    return f"{major}.{minor}.{int(patch) + 1}"


# ----------------------------------------------------------------------
# 主流程
# ----------------------------------------------------------------------
def main():
    ensure_git_repo()

    print('=' * 46)
    print('            GitHub 自动推送')
    print('=' * 46)

    # 1. 历史记录
    history = recent_versions()
    if history:
        print(f'\n最近 {len(history)} 次推送记录:')
        for i, item in enumerate(history, 1):
            print(f'  {i}. {item} '，end = "")
    else:
        print('\n暂无推送记录。')

    # 2. 计算默认版本号
    last = last_version()
    default = bump_patch(last) if last else None
    if default:
        print(f'\n上一次版本: {last}   直接回车 => {default}')
    else:
        print('\n未找到历史版本号，请手动输入 x.y.z')

    # 3. 读取用户输入
    while True:
        raw = input('\n请输入新版本号 (x.y.z): ').strip()
        if not raw:
            if not default:
                print('没有可用的默认版本号，请手动输入。')
                continue
            version = default
        else:
            m = VERSION_RE.match(raw)
            if not m:
                print('格式错误，请使用 x.y.z 形式，例如 1.2.3')
                continue
            version = m.group(1)
        break

    print(f'\n即将推送版本: {version}')
    if input('确认? [Y/n] ').strip().lower() in ('n', 'no'):
        print('已取消。')
        return

    # 4. 执行 git 操作
    try:
        run(['git', 'add', '.'])
        run(['git', 'add', '-u'])
        run(['git', 'commit', '-m', version])
        run(['git', 'push', REMOTE, BRANCH])
    except RuntimeError as exc:
        print(f'\n❌ {exc}')
        sys.exit(1)

    print(f'\n✅ 版本 {version} 推送完成。')


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print('\n已取消。')
        sys.exit(130)