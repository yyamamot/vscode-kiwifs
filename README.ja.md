# vscode-kiwifs

[English](https://github.com/yyamamot/vscode-kiwifs/blob/main/README.md) | 日本語

## Overview

`kiwifs` は、[Kiwi TCMS](https://kiwitcms.org/) のテスト計画とテストケースを VS Code から扱いやすくする拡張です。
Explorer の `Kiwi Plans` からテスト計画を開き、テストケース本文の確認・更新、ケース情報の編集、添付確認、テスト実行の更新まで進められます。

必要なときだけ、テストケース本文をローカルファイルとして取り出す `ローカルミラー` も使えます。
LLM や手元のツールで参照・比較・反映したい場合に向いています。

kiwifs は、LLM 安全な編集フローを実現します。LLM に Kiwi TCMS を直接編集させるのではなく、まず本文をローカルミラーに取り出し、LLM が読んでよいファイルと編集してよいファイルを限定します。
編集後は VS Code の Source Control View で差分を確認し、人間が問題ないと判断してから Kiwi に反映します。

この流れにより、LLM の作業範囲を狭く保ち、意図しないファイル参照や直接反映を避けながら、Wiki / テストケース本文の編集を支援できます。

<!--
  screenshot: kiwi-plans-overview
  file: assets/readme1.png
  capture: Explorer で Kiwi Plans を展開し、テスト計画と複数のテストケースが見える状態。右側にテストケース本文の Markdown preview / editor も表示する。
  purpose: Kiwi TCMS の plan / case を VS Code から確認でき、テストケース本文を Markdown として読めることを最初に伝える。
-->
<p align="center">
  <a href="#quick-start">
    <img src="assets/readme1.png" alt="Kiwi Plans overview" width="960">
  </a>
</p>

## この拡張でできること

- `Kiwi Plans` でテスト計画とテストケースを一覧する
- テストケース本文を VS Code で開いて更新する
- テストケースの情報、履歴、添付を確認する
- テストケースの基本情報を編集する
- テスト計画に新規テストケースを作成する、既存テストケースを追加する
- テストケースを計画から外す、または削除する
- テストケースやテスト実行を専用画面から探す
- テスト実行画面でテスト実行を作成・更新する
- テストケースごとの実行を case 起点画面から管理する
- ローカルミラーを使ってローカル比較・反映を行う
- 実験的機能の LLM Assist Kit でローカルミラー編集や差分確認用の Skill / prompt を準備する

## Installation

Marketplace からインストールする場合:

1. Extensions ビューで `Kiwi FS` または `vscode-kiwifs` を検索する
2. `yyamamot.vscode-kiwifs` を選ぶ
3. `Install` を押して有効化する
4. Command Palette から接続先を設定する

検証用には VSIX からのインストールもできます。

## Quick Start

### 1. 接続先を設定する

Command Palette から次を実行します。

- `Kiwi: ベース URL を設定`
- `Kiwi: ユーザー名を設定`
- `Kiwi: パスワードを設定`

| 項目 | 内容 |
| --- | --- |
| Base URL | `https://kiwi.example.com/` のような Kiwi TCMS URL |
| Username | Kiwi TCMS のログインユーザー名 |
| Password | Kiwi TCMS のログインパスワード |
| 保存先 | Base URL は settings、username/password は Secret Storage |

### 2. `Kiwi Plans` を開く

`Kiwi: ルートを開く` を実行すると、Explorer に `Kiwi Plans` が表示されます。
ここからテスト計画を展開し、配下のテストケースを確認できます。

<!--
  screenshot: kiwi-plan-context
  file: assets/readme2.png
  capture: Kiwi Plans の plan / case 右クリック menu または詳細操作 surface。ブラウザ表示、基本情報編集、テスト実行管理、ローカルミラー操作が見える状態。
  purpose: 右クリックを主要操作に絞ったことと、日常操作の入口を見せる。
-->
<p align="center">
  <a href="#main-workflows">
    <img src="assets/readme2.png" alt="Kiwi Plans context actions" width="360">
  </a>
</p>

### 3. テストケース本文を編集する

1. テスト計画を展開してテストケースを選ぶ
2. `kiwi:` document としてテストケース本文を開く
3. VS Code 上で Markdown 本文を編集して保存する
4. 保存前に本文変更を確認したい場合は `テストケースの差分を表示` を使う
5. Kiwi 側の最新本文を読み直したい場合は `テストケースを更新` を使う

### 4. テストケースの操作画面を使う

テストケースの右クリックから `テストケースの操作を開く` を使うと、case 起点の操作を 1 か所で確認できます。
操作画面の上部には対象 case の情報が表示され、よく使う操作へ移動できます。

- `テストケースの情報を表示`
- `基本情報を編集`
- `テストケースの実行を管理`
- `テストケースの履歴一覧を表示`
- `テストケースの履歴差分を表示`
- `ブラウザで表示`
- `添付をエディタで表示`
- `添付をブラウザで表示`
- `添付を追加`

### 5. テスト実行を扱う

複数のテスト実行をまとめて見たいときは、`Kiwi: テスト実行を表示` からテスト実行画面を開きます。
新しいテスト実行の作成、既存のテスト実行の選択、テストケースの追加、実行結果の更新をまとめて行えます。

ケースごとに登録済みのテスト実行を見ながら更新したいときは、右クリックの `テストケースの実行を管理` を使います。
case 起点の flow では、そのケースに紐づくテスト実行を一覧し、既存のテスト実行への追加、新規テスト実行の作成、実行結果やコメントの更新ができます。

<!--
  screenshot: kiwi-test-run-dashboard1
  file: assets/readme3.png
  capture: テスト実行画面で plan / build / test run を選択し、テストケースと実行行の table が見える状態。可能なら result control や comment も同じ画像に含める。
  purpose: dashboard 型と case 起点の両方を含め、VS Code 内でテスト実行を管理できることを見せる。
-->
<p align="center">
  <a href="#features">
    <img src="assets/readme3.png" alt="テスト実行画面" width="960">
  </a>
</p>

### 6. 必要なら `ローカルミラー` を使う

ローカルミラーは、テストケース本文をローカルファイルとして扱いたいときに使います。
比較後のローカルミラー変更は、VS Code の Source Control View に `ローカルの変更` / `Kiwi側の変更` / `競合` として表示されます。
Source Control View で差分を確認し、ローカル変更を Kiwi に反映するか、Kiwi 側の変更をローカルミラーに取り込むかを判断できます。

1. `このテストケースをローカルに同期` または `配下テストケースをローカルに同期`
2. `このテストケースの差分を確認` または `配下テストケースの差分を確認`
3. Source Control View で差分を確認し、問題なければ `Kiwiに反映` を実行する

ローカルミラーは `.kiwi-mirror/...` 配下に作られ、ローカル編集や外部ツールとの連携に使えます。
kiwifs はローカルミラーファイルの変更も監視し、毎回 full compare をしなくても local-only 変更を Source Control View に反映します。

<!--
  screenshot: kiwi-local-mirror
  file: assets/readme4.png
  capture: VS Code Source Control View に local mirror provider が表示され、ローカルの変更 / Kiwi側の変更 / 競合 と diff editor が見える状態。
  purpose: local mirror の比較・反映判断を Source Control View で行うことを見せる。
-->
<p align="center">
  <a href="#ローカルミラー">
    <img src="assets/readme4.png" alt="ローカルミラーの操作例" width="960">
  </a>
</p>

### 7. LLM Assist Kit を使う（実験的機能）

LLM Assist Kit は実験的機能です。ローカルミラーを LLM に扱わせるための Skill と prompt を準備しますが、今後の version で workflow や生成 artifact が変わる可能性があります。
生成された prompt と Source Control View の差分を自分で確認できる場合に使ってください。

LLM は VS Code の Source Control View や拡張機能内部の状態を直接読めません。
そのため、kiwifs が「読んでよいファイル」「編集してよいファイル」「SCM に出ている差分」を `.kiwi-agent/...` にファイルとして書き出します。
LLM にはそのファイルだけを読ませることで、余計なファイルを読ませず、Kiwi への反映判断も人間の Source Control View 操作に残せます。

主な目的は次の 3 つです。

- LLM が参照・編集してよい範囲を `.kiwi-mirror/**/*.md` に絞る
- Source Control View の diff を LLM が読める patch / prompt として用意する
- `Kiwiに反映` や `ローカルに取り込む` は LLM に実行させず、人間が確認して実行する

1. Command Palette で `Kiwi: LLM Local Mirror Skills をインストール` を実行する
2. ローカルミラーを同期し、必要な本文を `.kiwi-mirror/...` に用意する
3. Source Control View または Command Palette で `Kiwi: LLM Local Mirror Prompt を準備` を実行する
4. LLM に `.kiwi-agent/prompt/current/prompt.md` を読ませて依頼する
5. 変更後は Source Control View で差分を確認し、問題なければ `Kiwiに反映` を実行する

SCM の差分を LLM に要約・確認させたい場合は、Source Control View で差分を作った後に `Kiwi: LLM Local Mirror Diff を準備` を実行します。
生成された `.kiwi-agent/diff/current/prompt.md` は、SCM diff を LLM に読ませるための入力です。

Codex では、必要に応じて `$kiwi-local-mirror-prompt` / `$kiwi-local-mirror-diff` を指定できます。
Claude Code など Skill 呼び出し表記が異なる LLM では、`$...` 表記に頼らず、次のファイルを明示的に読ませてください。

| 用途 | LLM に渡すファイル |
| --- | --- |
| ローカルミラー編集 | `.agents/skills/kiwi-local-mirror-prompt/SKILL.md`, `.agents/skills/kiwi-local-mirror-prompt/agents/generic.md`, `.kiwi-agent/prompt/current/prompt.md` |
| SCM diff 確認 | `.agents/skills/kiwi-local-mirror-diff/SKILL.md`, `.agents/skills/kiwi-local-mirror-diff/agents/generic.md`, `.kiwi-agent/diff/current/prompt.md` |

| 生成先 | 用途 |
| --- | --- |
| `.agents/skills/kiwi-local-mirror-prompt/` | ローカルミラー Markdown 編集用 Skill |
| `.agents/skills/kiwi-local-mirror-diff/` | SCM diff 確認用 Skill |
| `.kiwi-agent/prompt/current/` | 編集依頼用 prompt と editable files |
| `.kiwi-agent/diff/current/` | SCM diff 確認用 prompt と patch |

<!--
  optional screenshot: kiwi-llm-assist-kit
  suggested file if added later: assets/readme5.png
  capture: Source Control View toolbar または Command Palette で "LLM Local Mirror Prompt を準備" / "LLM Local Mirror Diff を準備" が見え、必要なら Explorer に生成された .kiwi-agent files も見える状態。
  purpose: 実験的機能の LLM Assist Kit を視覚説明したい場合だけ追加する。安定機能ではないため、README 上では控えめに扱う。
-->

LLM Assist Kit は Kiwi API の実行や `Kiwiに反映` を自動実行しません。
反映前の最終確認と実行は人間が Source Control View で行います。

## Features

| 機能 | できること | 備考 |
| --- | --- | --- |
| テスト計画の一覧 | `Kiwi Plans` で計画とテストケースを確認 | Explorer から使える |
| テストケース本文の更新 | テストケース本文を VS Code で開いて保存 | 通常の編集感覚で扱える |
| テストケース情報の確認 | タイトル、状態、優先度、タグなどを表示 | 本文とは別に確認できる |
| テストケース情報の編集 | タイトル、状態、優先度、タグを更新 | 必要な項目だけ変更できる |
| テストケースの作成・複製 | 新しいケース作成、既存ケース複製 | create では Kiwi Template を選べる |
| 計画への追加・解除・削除 | 既存ケース追加、計画から解除、case 本体削除 | QuickPick と確認ダイアログを使う |
| テストケースを探す | キーワード、計画、状態、優先度、タグ、本文全文で絞り込む | 結果は 50 件ずつ追加表示 |
| テスト実行を探す | キーワード、計画、build 名でテスト実行を絞り込む | `開く` でテスト実行画面に渡す |
| 履歴と差分 | 本文差分、履歴一覧、履歴差分を表示 | 更新前の確認に使える |
| 最新の変更に気づきやすくする | `テストケースの最新状態を確認` と編集中画面の自動確認 | Web 側で変更があったケースに気づきやすい |
| 添付ファイル | 一覧表示、追加、ブラウザ/エディタ表示 | ケース確認を補助 |
| テストケースの実行結果更新 | 1 つのケースについて実行結果を更新 | 単発の更新に向く |
| テストケースの実行管理 | ケース起点で登録済みのテスト実行を管理 | 既存の追加、新規作成、実行結果の更新 |
| テスト実行画面 | テスト実行の作成、切替、ケース追加、複数件の状態更新 | 実行管理を VS Code で行える |
| ローカルミラー | 本文をローカルへ取り出し、比較結果を Source Control View に表示 | 外部ツール連携向け |
| LLM Assist Kit | Skill と prompt を生成し、LLM の参照・編集範囲を絞る | 実験的機能。ローカルミラー編集と SCM diff 確認向け |
| ブラウザ連携 | plan / case の Kiwi TCMS 画面を開く | Web UI で詳しく見たいときに使う |

## Main Workflows

コマンド名に `Kiwi:` が付いているものは、主に Command Palette から実行するコマンドです。
`Kiwi:` が付いていないものは、主に `Kiwi Plans` の右クリックや各画面の中で使う操作です。
一部のコマンドは複数の場所から使えますが、まずはこの見分け方で問題ありません。

### Command Palette から使う主なコマンド

#### 接続と基本操作

| 目的 | コマンド |
| --- | --- |
| Kiwi Plans を開く | `Kiwi: ルートを開く` |
| Base URL を設定 | `Kiwi: ベース URL を設定` |
| Username を設定 | `Kiwi: ユーザー名を設定` |
| Password を設定 | `Kiwi: パスワードを設定` |
| 設定を消す | `Kiwi: ベース URL を消去`, `Kiwi: ユーザー名を消去`, `Kiwi: パスワードを消去`, `Kiwi: 設定を消去` |

#### テストケースやテスト実行を探す

| 目的 | コマンド |
| --- | --- |
| 軽量検索 | `Kiwi: テストケースを検索` |
| 複合条件で探す | `Kiwi: テストケースを探す` |
| テスト実行を表示 | `Kiwi: テスト実行を表示` |
| テスト実行を探す | `Kiwi: テスト実行を探す` |

### 右クリックや画面内で使う主なコマンド

#### テスト計画の操作

| 目的 | コマンド |
| --- | --- |
| 情報表示 | `テスト計画の情報を表示` |
| ブラウザ表示 | `ブラウザで表示` |
| 新規テストケース作成 | `ここに作成` |
| 既存ケース追加 | `既存テストケースを追加` |
| ケース解除 | `テスト計画からテストケースを外す` |

#### テストケースとテスト実行の操作

| 目的 | コマンド |
| --- | --- |
| 情報表示 | `テストケースの情報を表示` |
| メタデータ編集 | `基本情報を編集` |
| 本文更新 | `テストケースを更新` |
| 最新状態確認 | `テストケースの最新状態を確認` |
| 差分表示 | `テストケースの差分を表示` |
| 履歴一覧 | `テストケースの履歴一覧を表示` |
| 履歴差分 | `テストケースの履歴差分を表示` |
| 複製 | `テストケースを複製` |
| ケースごとに実行結果を更新 | `テストケースの実行結果を更新` |
| ケースごとに実行を管理 | `テストケースの実行を管理` |

#### ローカルミラー

| 目的 | コマンド |
| --- | --- |
| テストケースを同期 | `このテストケースをローカルに同期` |
| テスト計画配下を同期 | `配下テストケースをローカルに同期` |
| テストケースを比較 | `このテストケースの差分を確認` |
| テスト計画配下を比較 | `配下テストケースの差分を確認` |
| Source Control View から反映 | `Kiwiに反映` |
| Source Control View から取り込み | `ローカルに取り込む` |
| 開く | `ローカルミラーを開く` |

#### LLM Assist Kit

| 目的 | コマンド |
| --- | --- |
| Skill をインストール | `Kiwi: LLM Local Mirror Skills をインストール` |
| 編集用 prompt を準備 | `Kiwi: LLM Local Mirror Prompt を準備` |
| SCM diff 確認用 prompt を準備 | `Kiwi: LLM Local Mirror Diff を準備` |

## Limitations

| 事項 | 補足 |
| --- | --- |
| VS Code 拡張として使う前提 | OS の通常ファイルシステム置き換えではありません |
| 編集できるケース情報は一部のみ | タイトル、状態、優先度、タグが対象です |
| ローカルミラーは追加機能 | 通常の確認・更新だけなら使わなくても問題ありません |
| ランタイムログは通常利用では使わない | F5 デバッグ時だけ有効です |

## Requirements / Compatibility

| 項目 | 内容 |
| --- | --- |
| VS Code | Desktop 版 `1.105+` |
| Kiwi TCMS | XML-RPC に接続できる環境 |
| 動作確認 | Kiwi TCMS `15.3` |
| 認証 | Base URL + username + password |
| ローカル作業 | ローカルミラーを使う場合は file workspace 推奨 |
| Marketplace package | `README.md` / `README.ja.md` / `CHANGELOG.md` / `CHANGELOG.ja.md` と screenshot assets を同梱 |

## Source から build する

必要なもの:

- Node.js `22+`
- pnpm `10.30.3+`
- VS Code Desktop `1.105+`

依存関係を install して extension を build します。

```sh
pnpm install
pnpm run build
```

local VSIX を作成します。

```sh
pnpm run package:vsix
```

生成した VSIX を VS Code に install します。

```sh
pnpm run install:vsix
```

主な verification gate を実行します。

```sh
pnpm run verify
```

UI 変更時の確認:

```sh
pnpm run verify:ui-change -- --scenario smoke --id <feature-id>
```

## License

- License: [MIT](./LICENSE)
