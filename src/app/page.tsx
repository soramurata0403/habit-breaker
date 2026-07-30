import { BookOpenCheck } from "lucide-react";

import { TextEditor } from "@/components/editor/text-editor";
import { habitRules } from "@/data/habit-rules";

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-teal-50 via-white to-white">
      <div className="mx-auto flex max-w-3xl flex-col px-4 py-12 sm:py-16">
        <header className="mb-10 text-center">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-teal-200 bg-teal-50 px-4 py-1.5 text-sm font-medium text-teal-700">
            <BookOpenCheck className="h-4 w-4" />
            HabitBreaker English
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-neutral-900 sm:text-4xl">
            日本人学習者特有の「英語の癖」を可視化する
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-balance text-neutral-500">
            TOEFL / IELTS ライティング向けエディタ。ハイライトされた単語をクリックすると、
            コーパスデータに基づく解説とパラフレーズ候補が表示され、ワンクリックで置き換えられます。
          </p>
        </header>

        <main className="rounded-3xl border border-neutral-200 bg-white/70 p-5 shadow-sm backdrop-blur-sm sm:p-8">
          <TextEditor />
        </main>

        <section className="mt-6 flex flex-wrap items-center justify-center gap-2">
          <span className="text-xs font-medium text-neutral-400">検出対象の癖：</span>
          {habitRules.map((rule) => (
            <span
              key={rule.word}
              className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700"
            >
              {rule.word}
            </span>
          ))}
        </section>

        <footer className="mt-10 text-center text-xs text-neutral-400">
          MVP prototype — コーパスルールはシードデータとして静的に組み込まれています。
        </footer>
      </div>
    </div>
  );
}
