# clasp で Apps Script を管理する

このフォルダ (`apps-script/`) が Apps Script プロジェクトの中身です。
`clasp` を使うと、ローカル（お手元のPCのClaude Code）で編集 → `clasp push` で
Apps Script に反映、という流れで開発できます。

> ⚠️ `clasp login` はブラウザでのGoogle認証が必要です。クラウド実行環境（web版）では
> 完結できないため、**この手順はお手元のPCで実行**してください。

---

## 0. 事前準備（1回だけ）

1. **Apps Script API を ON**
   https://script.google.com/home/usersettings → 「Apps Script API」をオンにする
2. **clasp をインストール**
   ```bash
   npm install -g @google/clasp
   ```
3. **ログイン**
   ```bash
   clasp login
   ```
4. **スクリプトIDを控える**
   Apps Scriptエディタ → ⚙️プロジェクトの設定 → 「スクリプト ID」をコピー

---

## 1. 既存プロジェクトをこのフォルダに接続する

すでに Apps Script 側にプロジェクトがある場合は、`.clasp.json` を作って紐づけます。
このフォルダで:

```bash
cd apps-script
# .clasp.json を作成（<SCRIPT_ID> は控えたスクリプトID）
printf '{\n  "scriptId": "<SCRIPT_ID>",\n  "rootDir": "."\n}\n' > .clasp.json
```

まず**リモートの現状を確認**したいときは別フォルダで:
```bash
clasp clone <SCRIPT_ID>
```

---

## 2. 日常の開発フロー

```bash
cd apps-script
clasp pull      # Apps Script側の最新をローカルへ
# ... Claude Code で Code.gs を編集 ...
clasp push      # ローカルの変更を Apps Script へ反映
```

- `clasp push` は **このフォルダの Code.gs / appsscript.json で上書き**します
  （`.claspignore` で送信対象を限定済み）。
- Apps Script側に古い `discord.gs` 等が残っている場合は、初回 push 前に
  エディタ上で削除しておくと重複関数エラーを防げます。

---

## 3. 実行・トリガー

- 動作確認: エディタで `testPost_` を編集して `testPost_('2026-07-28')` を実行、
  または `postToday` を実行
- 自動投稿ON: `setupNoonTrigger` を1回実行（毎日12:00）

---

## メモ

- `NOTION_TOKEN` と `DISCORD_WEBHOOK_URL` は **スクリプトプロパティ**に保存（コードには書かない）
- `.clasp.json` はスクリプトIDが入るだけなのでコミットしてOK
  （秘密情報ではありません）。認証情報 `~/.clasprc.json` は**絶対にコミットしない**こと。
