# Changelog

[English](https://github.com/yyamamot/vscode-kiwifs/blob/main/CHANGELOG.md) | 日本語

## 0.0.5 (2026-05-04)

- 通常インストールした拡張が、意図せず変更ありとして検知される場合がある問題を修正した
- 接続情報の扱いを見直し、パスワードが内部の一時キーに含まれないようにした
- `テストケースの操作` Webview の execution 表記を `テスト実行` に統一した
- テストケースの右クリックから `テストケースの実行を管理` を直接開けるようにした
- Source Control View から LLM Local Mirror Prompt / Diff を準備できるようにした
- LLM Local Mirror Prompt で、LLM が参照・編集できる範囲をより明確に制限した
- LLM Local Mirror Prompt で、新規ファイル作成・削除を避ける案内を追加した
- LLM Local Mirror Diff Context で、変更なしと生成失敗を区別できるようにした
- LLM Local Mirror Diff Context の差分を、前後の文脈付きで確認できるようにした
- LLM Assist Kit 利用時に `.kiwi-mirror/` と `.kiwi-agent/` の `.gitignore` 追記を確認できるようにした
- コマンド名、Webview、Source Control View、LLM prompt artifact の日本語 / 英語表示対応を広げた
- Source Control View で local mirror の local-only 変更を自動更新し、metadata-only の remote 変更も確認できるようにした
- Source Control View の local mirror 操作メニュー名と表示文言を整理した
- TreeView 右クリックを主要操作に絞り、補助操作を `詳細操作を開く` に集約した
- `テストケースの操作` Webview に対象 case 情報を常時表示するようにした
- `テストケースの操作` Webview の比較・反映判断系操作を Source Control View に集約した
- `テストケースの操作` Webview に metadata 表示と `基本情報を編集` 導線を追加した
- Kiwi Plans 右クリック menu の表記を、対象別の操作名として分かりやすく整理した
- `テスト計画の操作` Webview に plan 情報、配下テストケース数、テスト実行数、local mirror サマリを常時表示するようにした
- `テスト計画の操作` Webview から case 管理、test run、local mirror の主要操作を進められるようにした
- README を英語版と日本語版に分離し、日本語版 CHANGELOG を追加した

## 0.0.4 (2026-04-19)

- テスト計画の右クリックから、配下のローカルミラーを比較・反映できるようにした
- ローカルミラーの compare snapshot を Source Control に表示し、`Compare Again` / `Upload Local Changes` / `Take Remote Changes` を使えるようにした
- Explorer でも compare snapshot を優先表示し、`Local Changes` / `Remote Changes` / `Conflicts` が SCM と揃うようにした
- remote だけ更新されたケースを `Remote Changes` と正しく判定するようにし、旧 manifest でも可能な範囲で比較を継続できるようにした
- SCM から `Remote Changes` を開いたときに空との差分にならないようにし、その時点の remote 最新本文と local mirror の差分を開くようにした
- SCM の操作導線を右クリック中心へ寄せ、専用 command は command palette から隠した

## 0.0.3 (2026-04-16)

- 新規テストケース作成時に、Kiwi TCMS の Template を選んで本文のひな形として使えるようにした
- テストケースを本文全文で探せるようにし、検索結果は 50 件ずつ追加表示できるようにした
- 変更履歴を見やすくし、履歴ごとの差分を追いやすくした
- 開いているテストケースが最新ではない場合に気づきやすくした
- テストケース一覧から複数ケースを選んで、status や tags をまとめて更新できるようにした
- 右クリックから、テストケースを計画から外す操作と削除操作を続けて選びやすくした
- Test Run を専用画面から探して開けるようにした
- コマンド名を日本語に寄せ、`テストケースを探す` / `テスト実行を探す` など操作名を揃えた
- 右クリックメニューの文言を短くし、テスト計画 / テストケース表現を揃えた

## 0.0.2 (2026-04-14)

- case 起点の複数 Test Run 管理で、既存の全計画検索と plan selector を維持したまま初回表示を軽量化
- case ノード右クリックから、選択した履歴本文と最新本文の差分表示をサポート

## 0.0.1 (2026-04-12)

- 初期リリース
- `Kiwi Plans` view による plan / case 探索を追加
- `kiwi:` document としての case open / save を追加
- case metadata 編集、case 作成/複製、plan への追加/解除を追加
- local mirror の download / compare / upload を追加
