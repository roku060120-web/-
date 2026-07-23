# 今日の授業をDiscordに自動投稿

毎日 **12:00（日本時間）** に、その日の授業一覧を Discord に自動投稿します。
GitHub Actions（無料）で動くので、PCを開いていなくてもOK。

## 仕組み
```
timetable.csv（週間時間割）
      │ 毎日12:00にGitHub Actionsが実行
      ▼
  post_schedule.py が今日の曜日の授業を抽出
      ▼
  Discord に投稿
```

## ファイル
| ファイル | 役割 |
|---|---|
| `timetable.csv` | 週間時間割（**ここだけ編集すればOK**） |
| `post_schedule.py` | 今日の授業を抽出してDiscordへ送るスクリプト |
| `.github/workflows/daily-discord.yml` | 毎日12:00に実行する設定 |

## 時間割の編集方法
`timetable.csv` を編集するだけ。列は `曜日, 時間, 講師, 生徒, 教科`。
GitHubの画面上で鉛筆アイコンから直接編集できます。

例：
```csv
曜日,時間,講師,生徒,教科
月,17:00-18:30,田中先生,Aさん,数学
木,19:00-20:30,佐藤先生,Bさん,英語
```

## 初回セットアップ（1回だけ）
1. リポジトリの **Settings → Secrets and variables → Actions → New repository secret**
2. Name = `DISCORD_WEBHOOK` / Secret = DiscordのWebフックURL を登録
3. **Actions** タブ →「今日の授業をDiscordに投稿」→ **Run workflow** で手動テスト

以降は毎日12:00に自動投稿されます。手動投稿したいときは同じ **Run workflow** ボタンで即時実行できます。
