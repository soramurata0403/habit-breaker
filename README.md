# HabitBreaker English

日本人英語学習者（TOEFL/IELTS受験生）向けのライティング支援ツールのプロトタイプ（MVP）です。
英文テキスト中の「日本人学習者に特有の使いすぎ単語」をハイライトし、クリックすると
コーパスデータに基づく解説とパラフレーズ候補をポップオーバー表示、ワンクリックで置き換えられます。

## 主な機能

- テキスト入力エリア（貼り付け・自由入力に対応、内容に応じて自動で高さが伸びます）
- 対象単語（`bad` / `think` / `we` / `so`）を自動検出してハイライト表示
- ハイライト単語をクリックすると、直下にポップオーバーで解説 + 言い換え候補を表示
- 候補をクリックすると、その場でワンクリック置換
- 「サンプル文章をセット」ボタンでデモ用の例文を即座に入力可能

## 技術スタック

- [Next.js](https://nextjs.org) (App Router, TypeScript)
- Tailwind CSS
- Radix UI (`@radix-ui/react-popover`) / lucide-react

## シードデータ

コーパスルール（対象単語・解説・言い換え候補）は `src/data/habit-rules.ts` に静的データとして定義しています。

## Getting Started

```bash
npm install
npm run dev
```

[http://localhost:3000](http://localhost:3000) を開いて確認してください。
