import { BookOpenCheck, MessageSquarePlus } from "lucide-react";

import { TextEditor } from "@/components/editor/text-editor";
import { FEEDBACK_FORM_URL } from "@/lib/config";

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-teal-50 via-white to-white">
      <div className="mx-auto flex max-w-3xl flex-col px-4 py-12 sm:py-16">
        <header className="mb-10 text-center">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-teal-200 bg-teal-50 px-4 py-1.5 text-sm font-medium text-teal-700">
            <BookOpenCheck className="h-4 w-4" />
            HabitBreaker English
          </div>
          <h1 className="text-balance break-keep text-[clamp(1.375rem,6.5vw,2.25rem)] font-bold tracking-tight text-neutral-900 sm:text-4xl">
            ネイティブのような文章へ。
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-neutral-500">
            TOEFL / IELTS ライティング向けエディタ。
            <br />
            ハイライトされた単語をクリックすると、コーパスデータに基づく解説とパラフレーズ候補が表示され、ワンクリックで置き換えられます。
          </p>
        </header>

        {/* relative は必須: サイドパネルを開いた際、このカードの右外側
            （背景の余白エリア）へ absolute で浮かせる際の基準になる。
            カード自身の幅はパネルの開閉によって変化しない。 */}
        <main className="relative rounded-3xl border border-neutral-200 bg-white/70 p-5 shadow-sm backdrop-blur-sm sm:p-8">
          <TextEditor />
        </main>

        <footer className="mt-10 flex flex-col items-center gap-4">
          <a
            href={FEEDBACK_FORM_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-full border border-teal-200 bg-white px-4 py-2 text-sm font-medium text-teal-700 shadow-sm transition-colors hover:border-teal-300 hover:bg-teal-50"
          >
            <MessageSquarePlus className="h-4 w-4" />
            ご意見・バグ報告
          </a>
          <p className="text-center text-xs text-neutral-400">
            MVP prototype — コーパスルールはシードデータとして静的に組み込まれています。
          </p>
        </footer>
      </div>
    </div>
  );
}
