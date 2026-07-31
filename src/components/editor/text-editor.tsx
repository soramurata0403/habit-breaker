"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type SyntheticEvent,
} from "react";
import { ClipboardPaste, Lightbulb, RotateCcw, Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  applyAiTypoFlags,
  applyPronounContextFlags,
  getExtendedContext,
  preserveSubject,
  tokenize,
  type AiTypoInfo,
  type Token,
} from "@/lib/tokenize";
import { SAMPLE_TEXT, contextualPronouns } from "@/data/habit-rules";
import { loadDictionary } from "@/lib/spellcheck";
import { checkPronounContext, scanTextForContextualTypos } from "@/lib/word-insight";
import { buildIssueItems } from "@/lib/issue-list";
import {
  ANALYSIS_DEBOUNCE_MS,
  COOLDOWN_MS,
  DAILY_LIMIT_MESSAGE,
  LOW_REMAINING_THRESHOLD,
  MAX_DAILY_REQUESTS,
  MAX_TEXT_LENGTH,
} from "@/lib/config";
import { consumeRequest, useUsageLimit } from "@/lib/usage-store";
import { useTextHistory } from "@/lib/use-text-history";
import { Button } from "@/components/ui/button";
import { WordToken } from "./word-token";
import { IssuePanel, type IssuePanelTab } from "./issue-panel";

// サイドパネルからのジャンプ後、対象単語のパルス演出をどれだけ表示し
// 続けるか。globals.css の .animate-issue-jump の総再生時間と揃える。
const JUMP_HIGHLIGHT_DURATION_MS = 1600;

const MIN_HEIGHT = 224;

// 入力中の単語（例: "policy" の途中の "polic"）を誤ってスペルミス判定
// しないよう、入力が止まってからこの時間が経過するまでスペルチェックの
// 反映を遅らせる。こちらは通信を伴わないローカル処理専用の遅延。
const SPELLCHECK_DEBOUNCE_MS = 900;

// 同じ本文を再解析しないためのキャッシュ保持数（Undo/Redo・推敲時の
// 行き来で無駄にAPIを叩かないようにする）。
const MAX_ANALYSIS_CACHE_ENTRIES = 50;

/**
 * 解析対象として「意味のある変化」があったかを比較するための正規化。
 * 空白・改行の増減だけでは解析を実行しないよう、連続する空白は1つに
 * まとめ、前後の空白は落とす。
 */
function normalizeForAnalysis(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

// we/us/our の文脈チェックに一度に送る出現数の上限（コスト・応答時間の抑制）。
const MAX_PRONOUN_OCCURRENCES = 24;

// vagueStarts が未確定の間、毎レンダー新しい Set を作らないための共有インスタンス。
const EMPTY_STARTS: ReadonlySet<number> = new Set();

// 権限ダイアログが表示されない/応答が返らない環境で貼り付けボタンが
// 無反応に見えたままにならないよう、待機時間の上限を設ける。
const PASTE_TIMEOUT_MS = 8000;

// textarea とハイライト表示用オーバーレイの文字位置を完全に一致させるため、
// フォント・行間・字間・改行規則・パディング・ボーダー幅・box-sizing を
// 1文字たりとも変えずに両者へ適用する共有クラス。
// `block` は必須: <textarea> は既定で display:inline-block のため、
// 指定しないと行ボックスの余白（ベースライン揃えの隙間）分だけ
// 高さがオーバーレイ側とズレてしまう。
const SHARED_BOX_CLASSES =
  "block w-full rounded-2xl border-2 px-6 py-5 text-lg leading-8 tracking-normal font-sans whitespace-pre-wrap break-words [word-break:normal] [box-sizing:border-box]";

export function TextEditor() {
  const [text, setText] = useState("");
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [dictionary, setDictionary] = useState<Set<string> | null>(null);
  const [debouncedText, setDebouncedText] = useState("");
  // API解析用のデバウンス値。ローカル処理（debouncedText）より長く待つ。
  const [analysisText, setAnalysisText] = useState("");
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [isPasting, setIsPasting] = useState(false);
  const [aiTypos, setAiTypos] = useState<Map<string, AiTypoInfo>>(new Map());
  // we/us/our のうち、AIが「曖昧な一般論の主語」と確認した出現箇所（トークンの
  // start 位置）の集合。position は特定のテキストの状態でのみ意味を持つため、
  // どのテキストに対する結果かを text と一緒に保持し、一致する場合のみ使う。
  const [vaguePronouns, setVaguePronouns] = useState<{ text: string; starts: Set<number> }>({
    text: "",
    starts: new Set(),
  });
  // サイドパネルの開閉状態。null は閉じている状態を表し、下部の
  // ステータスボタンを押したタイミングで対応するタブが開く。
  const [activePanel, setActivePanel] = useState<IssuePanelTab | null>(null);
  // サイドパネルの一覧からジャンプしてきた単語トークンの start 位置。
  // 一致するトークンだけ一時的にパルス演出（.animate-issue-jump）を付与する。
  const [jumpTargetId, setJumpTargetId] = useState<number | null>(null);
  // 本文中で1単語だけが選択されているときに表示する「言い換えを探す」ボタンの位置。
  // 表示するだけでは通信は発生せず、押されて初めてAPIを呼ぶ。
  const [paraphrasePrompt, setParaphrasePrompt] = useState<{
    tokenKey: string;
    word: string;
    top: number;
    left: number;
    below: boolean;
  } | null>(null);
  // ユーザーが「言い換えを探す」を押した単語（トークンの start 位置）。
  // このトークンだけ、指摘がなくてもポップオーバーを開けるようにする。
  const [paraphraseTarget, setParaphraseTarget] = useState<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // textarea とオーバーレイを含む相対配置のコンテナ。
  // 言い換えツールチップをこの中に absolute 配置し、ページスクロールに追従させる。
  const editorBoxRef = useRef<HTMLDivElement>(null);
  const jumpTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 直前に解析（事前スキャン）を実行した時刻。連打防止のクールダウン判定に使う。
  const lastAnalysisAtRef = useRef(0);
  // 最後にAPI解析が成功した本文（正規化済み）。空白だけの変化や、
  // クリック・フォーカスによる再評価では再解析しないための比較用。
  const lastAnalyzedRef = useRef("");
  // 現在リクエスト中の本文（正規化済み）。同じ内容を二重に送らないためのガード。
  const inFlightRef = useRef("");
  // 解析済みの本文 → we/us/our の判定結果。Undo/Redo などで同じ本文に
  // 戻ったとき、APIを叩き直さずに復元するためのセッション内キャッシュ。
  const analysisCacheRef = useRef(new Map<string, Set<number>>());

  const { remaining, isExhausted } = useUsageLimit();
  const isOverLength = text.length > MAX_TEXT_LENGTH;

  // Undo/Redo で内容が入れ替わると単語の位置がずれるため、開いている
  // ポップオーバーは閉じる。
  const handleHistoryRestore = useCallback(() => setActiveKey(null), []);

  const { recordTyping, recordCommit, setCaret, handleUndoRedoKeyDown } = useTextHistory({
    initialValue: "",
    setValue: setText,
    textareaRef,
    onRestore: handleHistoryRestore,
  });

  useEffect(() => {
    return () => {
      if (jumpTimeoutRef.current) clearTimeout(jumpTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadDictionary().then((dict) => {
      if (!cancelled) setDictionary(dict);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const timeoutId = setTimeout(() => setDebouncedText(text), SPELLCHECK_DEBOUNCE_MS);
    return () => clearTimeout(timeoutId);
  }, [text]);

  useEffect(() => {
    const timeoutId = setTimeout(() => setAnalysisText(text), ANALYSIS_DEBOUNCE_MS);
    return () => clearTimeout(timeoutId);
  }, [text]);

  // 入力が確定した（＝一定時間止まった）タイミングで、文章全体に対する
  // 事前スキャンを1回の「解析」としてまとめて実行する。
  //   - 文脈的なタイポ（例: leaned → learned）の検出
  //   - we/us/our が曖昧な一般論の主語かどうかの判定
  // どちらもタップ前からハイライトを付けるための処理で、必ず同時に走るため、
  // 利用回数のカウントとクールダウンは「この1ラウンド」単位で扱う。
  useEffect(() => {
    if (!analysisText || analysisText !== text) return;
    // 上限到達時・文字数超過時は通信を行わない（ローカル辞書とコーパス
    // ルールによるハイライトはそのまま動作し続ける）。
    if (isExhausted || isOverLength) return;

    // 空白・改行だけの変化では解析しない。空白のみの本文も対象外。
    // 解析成功済み・送信中の内容と同一なら、何が再評価のきっかけであっても
    // ここで打ち切る（クリックやフォーカス移動では通信しない）。
    const normalized = normalizeForAnalysis(analysisText);
    if (!normalized) return;
    if (normalized === lastAnalyzedRef.current || normalized === inFlightRef.current) return;

    let cancelled = false;

    // 直前の解析から COOLDOWN_MS が経つまで次の解析を遅らせることで、
    // 連続入力中にリクエストが立て続けに飛ぶのを防ぐ。
    const waitMs = Math.max(0, COOLDOWN_MS - (Date.now() - lastAnalysisAtRef.current));

    const timeoutId = setTimeout(() => {
      if (cancelled) return;

      // Undo/Redo や推敲での行き来で同じ本文に戻った場合は、
      // 通信せずキャッシュから復元する（利用回数も消費しない）。
      const cached = analysisCacheRef.current.get(analysisText);
      if (cached) {
        lastAnalyzedRef.current = normalized;
        setVaguePronouns({ text: analysisText, starts: cached });
        return;
      }

      // 送信直前の最終ガード。既に解析成功済み、または同じ内容を送信中の
      // 場合はここでリクエストを取りやめる（クリック・フォーカス等で
      // 再評価が走っても、本文が変わっていなければ通信しない）。
      if (normalized === lastAnalyzedRef.current || normalized === inFlightRef.current) return;

      lastAnalysisAtRef.current = Date.now();
      inFlightRef.current = normalized;

      // 事前スキャン自体は利用回数を消費しない（消費するのは本文を書き換えた
      // 瞬間だけ）。ここでは「解析に成功した本文」の記録だけを行い、
      // 同じ内容を何度も解析しないようにする。失敗時は更新しないため、
      // 次のきっかけで再試行できる。
      let counted = false;
      const countOnce = () => {
        if (counted) return;
        counted = true;
        lastAnalyzedRef.current = normalized;
      };

      let settled = 0;
      const markSettled = () => {
        if (++settled === 2 && inFlightRef.current === normalized) {
          inFlightRef.current = "";
        }
      };

      scanTextForContextualTypos(analysisText).then(({ didRequest, issues }) => {
        if (didRequest) countOnce();
        markSettled();
        if (cancelled || issues.length === 0) return;
        setAiTypos((prev) => {
          const next = new Map(prev);
          let changed = false;
          for (const issue of issues) {
            const key = issue.word.toLowerCase();
            if (!next.has(key)) {
              next.set(key, {
                phrase: issue.phrase,
                correction: issue.correction,
                explanation: issue.explanation,
              });
              changed = true;
            }
          }
          return changed ? next : prev;
        });
      });

      const pronounTokens = tokenize(analysisText).filter(
        (token): token is Extract<Token, { type: "word" }> =>
          token.type === "word" && contextualPronouns.has(token.text.toLowerCase()),
      );

      const occurrences = pronounTokens.slice(0, MAX_PRONOUN_OCCURRENCES).map((token) => ({
        id: token.start,
        word: token.text,
        // 先行詞（例: 前文で紹介された人物名）が前文にあるケースにも
        // 対応できるよう、直前の1文も含めた文脈をAIに渡す。
        sentence: getExtendedContext(analysisText, token.start, 1),
      }));

      // documentText（文章全体）を渡すことで、個人的な体験談かアカデミックな
      // 論説文かのトーン判定も行われる。
      checkPronounContext(occurrences, analysisText).then(({ didRequest, vagueIds }) => {
        if (didRequest) countOnce();
        markSettled();

        const cache = analysisCacheRef.current;
        cache.set(analysisText, vagueIds);
        if (cache.size > MAX_ANALYSIS_CACHE_ENTRIES) {
          const oldest = cache.keys().next().value;
          if (oldest !== undefined) cache.delete(oldest);
        }

        if (cancelled) return;
        setVaguePronouns({ text: analysisText, starts: vagueIds });
      });
    }, waitMs);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [analysisText, text, isExhausted, isOverLength]);

  // クリック時にAI（/api/word-insight）が isTypo: true と判定した単語も、
  // 以後は文章全体でリアルタイムに赤ハイライトへ反映されるようにする。
  const handleConfirmAiTypo = useCallback(
    (word: string, correction: string, explanation: string) => {
      const key = word.toLowerCase();
      setAiTypos((prev) => {
        if (prev.has(key)) return prev;
        const next = new Map(prev);
        // クリック経由で判明した誤りは単語1語単位（句情報は持たない）。
        next.set(key, { phrase: word, correction, explanation });
        return next;
      });
    },
    [],
  );

  // クリック時にAI（/api/word-insight）が「曖昧な一般論の主語」と判定した
  // we/us/our も、以後はリアルタイムに黄色ハイライトへ反映されるようにする。
  const handleConfirmVaguePronoun = useCallback((position: number, forText: string) => {
    setVaguePronouns((prev) => {
      if (prev.text === forText) {
        if (prev.starts.has(position)) return prev;
        const next = new Set(prev.starts);
        next.add(position);
        return { text: forText, starts: next };
      }
      return { text: forText, starts: new Set([position]) };
    });
  }, []);

  // 入力が確定した（＝一定時間止まった）場合のみ辞書チェックを適用する。
  // まだ確定していない間は dictionary を渡さず、赤色ハイライトの更新を保留する。
  const spellcheckDictionary = debouncedText === text ? dictionary : null;
  const vagueStarts = vaguePronouns.text === text ? vaguePronouns.starts : EMPTY_STARTS;
  const tokens = useMemo(() => {
    const base = tokenize(text, spellcheckDictionary);
    const withTypos = applyAiTypoFlags(base, aiTypos, text);
    return applyPronounContextFlags(withTypos, vagueStarts);
  }, [text, spellcheckDictionary, aiTypos, vagueStarts]);
  const { improvements: improvementItems, spelling: spellingItems } = useMemo(
    () => buildIssueItems(tokens),
    [tokens],
  );
  const highlightCount = improvementItems.length;
  const typoCount = spellingItems.length;

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;

    function adjustHeight() {
      if (!el) return;
      el.style.height = "auto";
      el.style.height = `${Math.max(el.scrollHeight, MIN_HEIGHT)}px`;
    }

    adjustHeight();

    // 折り返し幅が変わる（＝ウィンドウ幅の変化など）と行数が変わり、
    // テキストエリアとオーバーレイの高さがズレるため、幅の変化にも追従させる。
    const resizeObserver = new ResizeObserver(adjustHeight);
    resizeObserver.observe(el);
    return () => resizeObserver.disconnect();
  }, [text]);

  function handleReplace(start: number, end: number, replacement: string) {
    // 利用回数は「本文を実際に書き換えた瞬間」だけ消費する
    // （解説やパラフレーズ候補を閲覧しただけでは消費しない）。
    if (isExhausted) return;
    consumeRequest();

    // "I believe" のような主語＋動詞の句を動詞だけの候補で置き換えると
    // 主語が消えてしまうため、必要なら主語を補ってから適用する。
    const safeReplacement = preserveSubject(text.slice(start, end), replacement);

    const next = text.slice(0, start) + safeReplacement + text.slice(end);
    const caret = start + safeReplacement.length;
    setText(next);
    // 置換はひとまとまりの操作として、独立した履歴エントリにする。
    recordCommit(next, caret, caret);
    setCaret(caret);
    setActiveKey(null);
  }

  function handleSample() {
    setText(SAMPLE_TEXT);
    recordCommit(SAMPLE_TEXT, SAMPLE_TEXT.length, SAMPLE_TEXT.length);
    setActiveKey(null);
  }

  async function handlePaste() {
    setPasteError(null);

    if (!navigator.clipboard?.readText) {
      setPasteError(
        "お使いのブラウザはボタンからの貼り付けに対応していません。Ctrl+V（Macは⌘+V）で貼り付けてください。",
      );
      return;
    }

    setIsPasting(true);
    try {
      // 権限ダイアログが表示されないまま応答が返らないブラウザ環境も
      // あるため、一定時間で諦めてフォールバック表示に切り替える。
      const clipboardText = await Promise.race([
        navigator.clipboard.readText(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("clipboard-read-timeout")), PASTE_TIMEOUT_MS),
        ),
      ]);
      if (!clipboardText) {
        setPasteError("クリップボードにテキストが見つかりませんでした。");
        return;
      }
      setText(clipboardText);
      recordCommit(clipboardText, clipboardText.length, clipboardText.length);
      setCaret(clipboardText.length);
      setActiveKey(null);
    } catch (error) {
      console.error("Failed to read clipboard:", error);
      setPasteError(
        "クリップボードの読み取りが許可されませんでした。Ctrl+V（Macは⌘+V）で貼り付けてください。",
      );
    } finally {
      setIsPasting(false);
    }
  }

  /**
   * textarea 内の選択が変わったときに呼ばれる。
   * 「1つの単語だけが選択されている」かつ「その単語に指摘が無い」場合にだけ、
   * 単語の近くに『言い換えを探す』ボタンを出す。ここでは通信は一切行わない。
   */
  function handleSelectionChange(event: SyntheticEvent<HTMLTextAreaElement>) {
    const element = event.currentTarget;
    const { selectionStart, selectionEnd } = element;

    // 選択が無い（カーソルを置いただけ）場合はボタンを出さない。
    if (selectionStart === null || selectionEnd === null || selectionStart === selectionEnd) {
      setParaphrasePrompt(null);
      return;
    }

    // ブラウザによっては、ダブルクリック時に単語の後ろの空白や句読点まで
    // 選択に含まれる（Safari / Firefox 等）。そのままだと「1単語の内側」の
    // 判定に落ちてしまうため、前後の空白・句読点を除いた実質的な範囲で判定する。
    let from = selectionStart;
    let to = selectionEnd;
    const isTrimmable = (char: string) => /[\s.,!?;:"'()[\]]/.test(char);
    while (from < to && isTrimmable(text[from])) from++;
    while (to > from && isTrimmable(text[to - 1])) to--;

    if (from >= to) {
      setParaphrasePrompt(null);
      return;
    }

    // 選択範囲が1単語の内側に収まっているときだけ対象にする
    // （ダブルクリックするとその単語がちょうど選択される）。
    const token = tokens.find(
      (candidate): candidate is Extract<Token, { type: "word" }> =>
        candidate.type === "word" && candidate.start <= from && to <= candidate.end,
    );

    // 黄色・赤色の単語は従来どおりクリックで開けるため、ボタンは出さない。
    if (!token || token.rule || token.isUnknownWord || token.isAiTypo) {
      setParaphrasePrompt(null);
      return;
    }

    const container = editorBoxRef.current;
    const wordElement = document.getElementById(`token-${token.start}`);
    if (!container || !wordElement) {
      setParaphrasePrompt(null);
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const wordRect = wordElement.getBoundingClientRect();
    const top = wordRect.top - containerRect.top;
    // 1行目など上に余白が無い場合は単語の下に出す。
    const below = top < 44;

    setParaphrasePrompt({
      tokenKey: token.key,
      word: token.text,
      top: below ? top + wordRect.height : top,
      left: wordRect.left - containerRect.left + wordRect.width / 2,
      below,
    });
  }

  /** 『言い換えを探す』ボタンが押されたときだけ、その単語の解説を取りに行く。 */
  function handleRequestParaphrase() {
    if (!paraphrasePrompt) return;
    const start = Number(paraphrasePrompt.tokenKey.slice(2));
    setParaphraseTarget(start);
    setActiveKey(paraphrasePrompt.tokenKey);
    setParaphrasePrompt(null);
  }

  function handleClear() {
    setText("");
    recordCommit("", 0, 0);
    setCaret(0);
    setActiveKey(null);
  }

  // 下部のステータスボタン（改善ポイント／スペルミス）を押した時の開閉処理。
  // パネルが閉じている場合は該当タブで開き、既に同じタブが開いている場合は
  // 閉じる。別のタブが開いている場合はそのタブへ切り替える。
  function handleStatusButtonClick(panel: IssuePanelTab) {
    setActivePanel((prev) => (prev === panel ? null : panel));
  }

  function handleClosePanel() {
    setActivePanel(null);
  }

  // サイドパネルの一覧項目をクリックした時、本文中の該当単語まで
  // スムーズスクロールし、一時的にパルス演出でハイライトした上で、
  // その単語の直下に詳細ポップオーバー（理由・言い換え候補・適用ボタン）を
  // 開く。本文の単語を直接クリックした場合と同じ内容が表示される。
  const handleSelectIssue = useCallback((id: number, tokenKey: string) => {
    setJumpTargetId(id);
    document.getElementById(`token-${id}`)?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });

    // 一覧項目は data-issue-row で「外側クリック」判定から除外しているため、
    // 開いているポップオーバーに閉じられることなく、そのまま切り替えられる。
    setActiveKey(tokenKey);

    if (jumpTimeoutRef.current) clearTimeout(jumpTimeoutRef.current);
    jumpTimeoutRef.current = setTimeout(() => {
      setJumpTargetId(null);
    }, JUMP_HIGHLIGHT_DURATION_MS);
  }, []);

  function renderWordToken(token: Extract<Token, { type: "word" }>) {
    return (
      <WordToken
        key={token.key}
        token={token}
        fullText={text}
        dictionary={dictionary}
        isOpen={activeKey === token.key}
        isJumpTarget={jumpTargetId === token.start}
        isUsageExhausted={isExhausted}
        isOverLength={isOverLength}
        isParaphraseRequested={paraphraseTarget === token.start}
        onOpenChange={(open) => {
          setActiveKey(open ? token.key : null);
          // 閉じたら、指摘のない単語は元の「クリックできない素のテキスト」に戻す。
          if (!open && paraphraseTarget === token.start) setParaphraseTarget(null);
        }}
        onReplace={handleReplace}
        onConfirmAiTypo={handleConfirmAiTypo}
        onConfirmVaguePronoun={handleConfirmVaguePronoun}
      />
    );
  }

  // 単語トークンの直後に「改行させたくない句読点」（attachedToPrevious）が
  // 続く場合、両者を1つの whitespace-nowrap な span でまとめて描画することで、
  // 句読点だけが行末で孤立して次行に落ちるのを防ぐ。
  function renderTokenNodes(): ReactNode[] {
    const nodes: ReactNode[] = [];
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (token.type === "word") {
        const next = tokens[i + 1];
        if (next && next.type === "text" && next.attachedToPrevious) {
          nodes.push(
            <span key={token.key} className="whitespace-nowrap">
              {renderWordToken(token)}
              {next.text}
            </span>,
          );
          i++;
          continue;
        }
        nodes.push(renderWordToken(token));
      } else {
        nodes.push(<span key={token.key}>{token.text}</span>);
      }
    }
    return nodes;
  }

  return (
    // パネルはこのツリー内で absolute 配置（panel: 以上）または通常フロー
    // （それ未満）で描画されるため、エディタ側は常に幅 100% を保つ。
    <div className="w-full">
      <div>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-neutral-500">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full bg-amber-400" />
              黄色：言い換え推奨の癖のある単語
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full bg-red-500" />
              赤色：スペルミスの疑い
            </span>
            <span className="flex items-center gap-1.5 font-medium text-neutral-700">
              <Lightbulb className="h-4 w-4 text-amber-500" />
              単語をダブルクリックすると言い換えを探せます
            </span>
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={handleSample}>
              <Sparkles className="h-4 w-4" />
              サンプル文章をセット
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handlePaste}
              disabled={isPasting}
            >
              <ClipboardPaste className="h-4 w-4" />
              {isPasting ? "貼り付け中..." : "貼り付け"}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={handleClear}>
              <RotateCcw className="h-4 w-4" />
              クリア
            </Button>
          </div>
        </div>

        {pasteError && (
          <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {pasteError}
          </p>
        )}

        <div className="relative" ref={editorBoxRef}>
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(event) => {
              const element = event.target;
              setText(element.value);
              recordTyping(element.value, element.selectionStart, element.selectionEnd);
              setActiveKey(null);
              // 本文が変わると単語の位置がずれるため、言い換えの状態は一旦解除する。
              setParaphrasePrompt(null);
              setParaphraseTarget(null);
            }}
            onSelect={handleSelectionChange}
            // onSelect が発火しないブラウザ・操作経路の保険として、
            // ダブルクリックとマウス操作の完了時にも同じ判定を走らせる。
            onDoubleClick={handleSelectionChange}
            onMouseUp={handleSelectionChange}
            onKeyDown={handleUndoRedoKeyDown}
            placeholder="ここに英文を入力または貼り付けしてください..."
            spellCheck={false}
            className={cn(
              SHARED_BOX_CLASSES,
              "relative z-0 resize-none overflow-hidden border-neutral-200 bg-white text-transparent caret-neutral-900 shadow-sm outline-none placeholder:text-neutral-400 focus:border-teal-400 focus:ring-4 focus:ring-teal-100",
            )}
          />
          <div
            className={cn(
              SHARED_BOX_CLASSES,
              "pointer-events-none absolute inset-0 z-10 border-transparent text-neutral-800",
            )}
          >
            {text.length > 0 && renderTokenNodes()}
          </div>

          {paraphrasePrompt && (
            <button
              type="button"
              // mousedown の既定動作を止めて textarea の選択を保ったまま
              // クリックを受け取る（選択が消えると位置の基準を失うため）。
              onMouseDown={(event) => event.preventDefault()}
              onClick={handleRequestParaphrase}
              className={cn(
                "animate-popover absolute z-30 flex -translate-x-1/2 items-center gap-1 rounded-full",
                "border border-teal-200 bg-white px-3 py-1.5 text-xs font-medium text-teal-700",
                "shadow-lg transition-colors hover:border-teal-300 hover:bg-teal-50",
                paraphrasePrompt.below ? "translate-y-2" : "-translate-y-[calc(100%+8px)]",
              )}
              style={{ top: paraphrasePrompt.top, left: paraphrasePrompt.left }}
            >
              <Lightbulb className="h-3.5 w-3.5" />
              「{paraphrasePrompt.word}」の言い換えを探す
            </button>
          )}
        </div>

        {isOverLength && (
          <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-800">
            解析できるのは{MAX_TEXT_LENGTH}文字までです（現在 {text.length} 文字）。
            文字数を減らすと自動的に解析が再開されます。
          </p>
        )}

        {isExhausted && !isOverLength && (
          <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">
            {DAILY_LIMIT_MESSAGE}
          </p>
        )}

        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span
              className={cn(
                "text-sm font-medium whitespace-nowrap",
                isOverLength ? "text-red-600" : "text-neutral-600",
              )}
            >
              {text.length} / {MAX_TEXT_LENGTH} 文字
            </span>
            {/* 残り回数はひと目で分かるようバッジ表示にし、残りわずか／上限到達で
                色が変わるようにする（通常=グレー、残りわずか=黄、上限到達=赤）。 */}
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap",
                isExhausted
                  ? "bg-red-100 text-red-900"
                  : remaining <= LOW_REMAINING_THRESHOLD
                    ? "bg-amber-100 text-amber-900"
                    : "bg-neutral-100 text-neutral-600",
              )}
            >
              {isExhausted ? (
                <>本日の修正上限に到達（{MAX_DAILY_REQUESTS} / {MAX_DAILY_REQUESTS} 回）</>
              ) : (
                <>
                  本日の修正 残り
                  <span className="text-sm font-bold">{remaining}</span>／
                  {MAX_DAILY_REQUESTS} 回
                </>
              )}
            </span>
          </span>
          <span className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => handleStatusButtonClick("improvements")}
              aria-pressed={activePanel === "improvements"}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium whitespace-nowrap transition-colors",
                highlightCount > 0
                  ? "bg-amber-100 text-amber-900 hover:bg-amber-200"
                  : "bg-neutral-100 text-neutral-500 hover:bg-neutral-200",
                activePanel === "improvements" && "ring-2 ring-amber-400",
              )}
            >
              <span className="text-base font-bold">{highlightCount}</span>
              件の改善ポイント
            </button>
            <button
              type="button"
              onClick={() => handleStatusButtonClick("spelling")}
              aria-pressed={activePanel === "spelling"}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium whitespace-nowrap transition-colors",
                typoCount > 0
                  ? "bg-red-100 text-red-900 hover:bg-red-200"
                  : "bg-neutral-100 text-neutral-500 hover:bg-neutral-200",
                activePanel === "spelling" && "ring-2 ring-red-400",
              )}
            >
              <span className="text-base font-bold">{typoCount}</span>
              件のスペルミスの疑い
            </button>
          </span>
        </div>
      </div>

      {activePanel && (
        // panel ブレークポイント以上: メインカードの右外側の余白へ absolute で
        // 浮かせる（left-full = カード内側の右端）。カードは幅も高さも影響を
        // 受けないため、テキストエリアの折り返し幅は開閉前と完全に同一。
        // それ未満: 通常フローでエディタの真下に全幅で積む（横幅を奪わない）。
        <div className="mt-4 w-full panel:absolute panel:top-0 panel:left-full panel:mt-0 panel:ml-4 panel:w-[288px]">
          <IssuePanel
            activeTab={activePanel}
            onTabChange={setActivePanel}
            onClose={handleClosePanel}
            improvementItems={improvementItems}
            spellingItems={spellingItems}
            onSelectIssue={handleSelectIssue}
          />
        </div>
      )}
    </div>
  );
}
