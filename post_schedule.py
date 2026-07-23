"""今日の授業一覧をDiscordに投稿する（GitHub Actionsから毎日実行）。

データ源は2つのGoogleスプレッドシート（サービスアカウントで非公開のまま読む）:
  - 時間割マスター : 曜日, 時間, 講師, 生徒, 教科
  - 例外マスター   : 日付, 種別(休講/振替/追加), 講師, 生徒, 時間, 教科

必要な環境変数（GitHub Secrets）:
  - DISCORD_WEBHOOK            : DiscordのWebフックURL
  - GOOGLE_SERVICE_ACCOUNT_JSON: サービスアカウントの鍵(JSON全文)
"""

import json
import os
import re
import urllib.request
from datetime import datetime, timezone, timedelta

from google.oauth2 import service_account
from googleapiclient.discovery import build

JST = timezone(timedelta(hours=9))
DOW = ["月", "火", "水", "木", "金", "土", "日"]  # weekday(): 月=0 … 日=6

# スプレッドシートID（機密ではないのでコードに記載）
SHEET_TIMETABLE = "1fUkcHlgNz03iv0n3FslFgtpKQKxH0C_jNCTwyoY0WVI"
SHEET_EXCEPTIONS = "1Y-mj2kMxj8CJrGQYeDkTMuS14rs9mqXOOSYZqe0d8QE"


def sheets_client():
    info = json.loads(os.environ["GOOGLE_SERVICE_ACCOUNT_JSON"])
    creds = service_account.Credentials.from_service_account_info(
        info, scopes=["https://www.googleapis.com/auth/spreadsheets.readonly"]
    )
    return build("sheets", "v4", credentials=creds, cache_discovery=False)


def read_values(svc, sheet_id, rng):
    """先頭シートの指定範囲を読む（タブ名に依存しないよう範囲のみ指定）。"""
    res = (
        svc.spreadsheets()
        .values()
        .get(spreadsheetId=sheet_id, range=rng)
        .execute()
    )
    return res.get("values", [])


def cell(row, i):
    return row[i].strip() if i < len(row) and row[i] is not None else ""


def date_is_today(value, now):
    nums = [int(x) for x in re.findall(r"\d+", str(value))]
    if len(nums) >= 3:
        return (nums[0], nums[1], nums[2]) == (now.year, now.month, now.day)
    if len(nums) == 2:
        return (nums[0], nums[1]) == (now.month, now.day)
    return False


def start_minutes(time_str):
    m = re.search(r"(\d{1,2}):(\d{2})", time_str)
    return int(m.group(1)) * 60 + int(m.group(2)) if m else 9999


def build_message(svc, now):
    dow = DOW[now.weekday()]

    timetable = read_values(svc, SHEET_TIMETABLE, "A2:E")   # 曜日,時間,講師,生徒,教科
    exceptions = read_values(svc, SHEET_EXCEPTIONS, "A2:F")  # 日付,種別,講師,生徒,時間,教科

    # 今日の例外を仕分け
    cancels = set()   # (講師, 生徒)
    adds = []         # 追加/振替のレッスン
    for r in exceptions:
        if not date_is_today(cell(r, 0), now):
            continue
        kind = cell(r, 1)
        if kind == "休講":
            cancels.add((cell(r, 2), cell(r, 3)))
        elif kind in ("振替", "追加"):
            adds.append({
                "時間": cell(r, 4), "講師": cell(r, 2),
                "生徒": cell(r, 3), "教科": cell(r, 5), "種別": kind,
            })

    lessons = []
    for r in timetable:
        if cell(r, 0) != dow:
            continue
        teacher, student = cell(r, 2), cell(r, 3)
        if (teacher, student) in cancels:
            continue
        lessons.append({
            "時間": cell(r, 1), "講師": teacher,
            "生徒": student, "教科": cell(r, 4), "種別": "",
        })
    lessons.extend(adds)
    lessons.sort(key=lambda x: start_minutes(x["時間"]))

    date = f"{now.month}/{now.day}({dow})"
    lines = [f"📅 **本日 {date} の授業**", "━━━━━━━━━━━━"]
    if lessons:
        for x in lessons:
            tag = f"【{x['種別']}】" if x["種別"] else ""
            lines.append(
                f"・{x['時間']}　{x['講師']} / {x['生徒']} / {x['教科']}{tag}"
            )
    else:
        lines.append("本日の授業はありません 🎉")
    return "\n".join(lines)


def post_discord(content):
    data = json.dumps({"content": content}).encode("utf-8")
    req = urllib.request.Request(
        os.environ["DISCORD_WEBHOOK"],
        data=data,
        headers={
            "Content-Type": "application/json",
            # DiscordのCloudflareがデフォルトUAを403で弾くため、UAを明示する
            "User-Agent": "juku-schedule-bot/1.0 (+github-actions)",
        },
    )
    with urllib.request.urlopen(req) as resp:
        print("Discordへ投稿しました:", resp.status)


def main():
    now = datetime.now(JST)
    content = build_message(sheets_client(), now)
    print(content)
    post_discord(content)


if __name__ == "__main__":
    main()
