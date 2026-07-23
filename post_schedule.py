"""今日の授業一覧をDiscordに投稿する（GitHub Actionsから毎日実行）。
外部ライブラリ不要（標準ライブラリのみ）。時間割は timetable.csv を読む。"""

import csv
import json
import os
import urllib.request
from datetime import datetime, timezone, timedelta

JST = timezone(timedelta(hours=9))
DOW = ["月", "火", "水", "木", "金", "土", "日"]  # weekday(): 月=0 … 日=6


def build_message():
    now = datetime.now(JST)
    dow = DOW[now.weekday()]
    rows = []
    with open("timetable.csv", encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            if (r.get("曜日") or "").strip() == dow:
                rows.append(r)

    date = f"{now.month}/{now.day}({dow})"
    lines = [f"📅 **本日 {date} の授業**", "━━━━━━━━━━━━"]
    if rows:
        for r in rows:
            lines.append(
                f"・{r['時間'].strip()}　{r['講師'].strip()} / "
                f"{r['生徒'].strip()} / {r['教科'].strip()}"
            )
    else:
        lines.append("本日の授業はありません 🎉")
    return "\n".join(lines)


def main():
    webhook = os.environ["DISCORD_WEBHOOK"]
    content = build_message()
    data = json.dumps({"content": content}).encode("utf-8")
    req = urllib.request.Request(
        webhook, data=data, headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req) as resp:
        print("Discordへ投稿しました:", resp.status)
    print(content)


if __name__ == "__main__":
    main()
