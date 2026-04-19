# Changelog

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
