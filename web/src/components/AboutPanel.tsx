import { useEffect } from "react";
import { useLang } from "../i18n";

interface Source {
  tool: string;
  indicator: string;
  source: string;
  key: string;
  check: { ja: string; en: string };
}

// Which public source each OSINT tool queries, and the indicator it informs.
const SOURCES: Source[] = [
  { tool: "domain_rdap", indicator: "A2", source: "RDAP (rdap.org)", key: "—", check: { ja: "ドメイン登録年齢・登録者・国", en: "Domain age, registrar, country" } },
  { tool: "cert_ct", indicator: "A2", source: "crt.sh (CT logs)", key: "—", check: { ja: "証明書履歴・サブドメイン", en: "Certificate history / subdomains" } },
  { tool: "web_search", indicator: "A1/A3/B3", source: "Anthropic web search", key: "Anthropic", check: { ja: "会社・人物・主張の裏取り（公開・適法のみ）", en: "Corroborate company/person/claims (public, lawful)" } },
  { tool: "corp_jp", indicator: "A5", source: "国税庁 法人番号", key: "HHC_HOUJIN_APP_ID", check: { ja: "国内法人の実在（一次）", en: "JP company existence (primary)" } },
  { tool: "corp_jp_aux", indicator: "A5", source: "gBizINFO", key: "HHC_GBIZ_INFO_API_KEY", check: { ja: "国内法人の活動（補助）", en: "JP company activity (auxiliary)" } },
  { tool: "corp_gleif", indicator: "A5", source: "GLEIF (LEI)", key: "—", check: { ja: "海外法人の実在（LEI登録）", en: "Global legal entity (LEI)" } },
  { tool: "corp_global", indicator: "A5", source: "OpenCorporates", key: "HHC_OPENCORPORATES_TOKEN", check: { ja: "海外法人の実在", en: "Global company existence" } },
  { tool: "sanctions_opensanctions", indicator: "F1/F2/F3", source: "OpenSanctions", key: "HHC_OPENSANCTIONS_API_KEY", check: { ja: "制裁・PEP・ウォッチリスト（UN/OFAC/EU/英OFSI 等）", en: "Sanctions/PEP/watchlist (UN/OFAC/EU/UK OFSI…)" } },
  { tool: "enduser_jp_meti", indicator: "F1", source: "OpenSanctions (jp_meti_eul)", key: "HHC_OPENSANCTIONS_API_KEY", check: { ja: "METI 外国ユーザーリスト", en: "METI foreign end-user list" } },
  { tool: "screening_us_csl", indicator: "F1", source: "Trade.gov CSL", key: "HHC_TRADEGOV_API_KEY", check: { ja: "米CSL（OFAC SDN・BIS Entity 等）", en: "US CSL (OFAC SDN, BIS Entity…)" } },
  { tool: "reverse_image", indicator: "B1", source: "Google Lens / TinEye / Yandex", key: "—", check: { ja: "画像の使い回し確認（リンク導線のみ・自動顔照合なし）", en: "Reverse-image search (links only; no auto face match)" } },
];

const L = {
  title: { ja: "HHC について — 情報源とガイドライン", en: "About HHC — sources & guidelines" },
  close: { ja: "閉じる", en: "Close" },
  whatHead: { ja: "これは何か／何でないか", en: "What it is / isn't" },
  what: {
    ja: [
      "怪しい求人・スカウトが外国情報機関の勧誘かを自己診断する、ローカル優先の自衛ツール。",
      "個人を「スパイ」と断定しない。出力はリスク帯域（低/中/高）＋推奨アクションのみ。",
      "公開・適法な情報源のみを使用（LinkedIn本体のスクレイピング・ログイン背後アクセスはしない）。",
      "AIは提案、最終確定は人間。決定論スコアが常にAIに優先。",
      "「証拠なし≠無実」。リスト不掲載でスコアは下げない。",
      "国籍・民族を自動スコアの主軸にしない（国家ネクサスは所属・リスト合致＝カテゴリFで捉える。カテゴリGは人手設定の任意ネクサス）。",
    ],
    en: [
      "A local-first self-defense tool to triage whether a suspicious job/scout approach is foreign-intelligence recruitment.",
      "Never labels a person a \"spy\". Output is only a risk band (low/med/high) + a recommended action.",
      "Public, lawful sources only (no LinkedIn scraping, no login-gated access).",
      "The AI proposes; the human confirms. The deterministic score always overrides the AI.",
      "\"No evidence\" is not innocence; absence from a list never lowers the score.",
      "Nationality/ethnicity are not the scoring axis (state nexus is captured by affiliation/list matching = category F; category G is an optional human-set nexus).",
    ],
  },
  scenariosHead: { ja: "想定シナリオ", en: "Use cases" },
  scenarios: {
    ja: [
      "① あなたが標的: 求人・ヘッドハンティングを装った勧誘（コンサル/シンクタンク偽装 → 機密アクセスの見極め → 報酬と引き換えに情報要求）。",
      "② あなたが採用・発注側: 応募者・フリーランス受託者の“なりすまし”（偽の身元で採用/受託し、システム・データ・コードへのアクセスを得る。例: 北朝鮮IT労働者詐欺）。",
    ],
    en: [
      "(1) You are the target: a recruiter/headhunter front (fake consultancy/think tank → gauges your access → asks for info in exchange for pay).",
      "(2) You are hiring/contracting: a fraudulent applicant/freelancer (fake identity to get hired/contracted and gain access to systems, data, code — e.g. the DPRK IT-worker fraud).",
    ],
  },
  sourcesHead: { ja: "使用する情報源（API）", en: "Sources (APIs) used" },
  colTool: { ja: "ツール", en: "Tool" },
  colCheck: { ja: "調べること", en: "What it checks" },
  colInd: { ja: "指標", en: "Indicator" },
  colSrc: { ja: "情報源", en: "Source" },
  colKey: { ja: "キー", en: "Key" },
  guideHead: { ja: "準拠する警告・ガイドライン", en: "Guidance & frameworks" },
  guide: {
    ja: [
      "2026年6月 ファイブ・アイズ共同警告（求人サイト等での機密アクセス者の勧誘）",
      "英NPSA \"Think Before You Link\" / \"Applicant Beware\"",
      "公安調査庁「経済安全保障の確保に向けて」",
      "Five Eyes/FBI: なりすましIT労働者（北朝鮮等）の不正就労・委託への警告",
      "照合リスト: OFAC SDN・BIS Entity/Unverified/MEU・UN安保理・EU・英OFSI・METI外国ユーザーリスト・PEP",
    ],
    en: [
      "June 2026 Five Eyes joint warning (recruiting access-holders via job sites)",
      "UK NPSA \"Think Before You Link\" / \"Applicant Beware\"",
      "Japan PSIA economic-security guidance",
      "Five Eyes/FBI advisories on fraudulent (e.g. DPRK) IT workers gaining employment/contracts",
      "Lists screened: OFAC SDN, BIS Entity/Unverified/MEU, UN, EU, UK OFSI, METI end-user list, PEP",
    ],
  },
  scoreHead: { ja: "スコアリングの考え方", en: "How scoring works" },
  score: {
    ja: [
      "決定論スコア = 該当指標の重み合計 × 標的属性係数（E1 ×1.3 / E2 ×1.2）",
      "クリティカル・オーバーライド: D3単独 / C2＋D1 / 人間確認F1 → スコアに関わらず『高』",
      "帯域: 0–5 低 / 6–12 中 / 13+ 高",
      "F1（指定リスト合致）はOSINTで高確信時に自動チェック（同名・翻字の誤検出なら解除）",
    ],
    en: [
      "Deterministic score = sum of matched weights × target coefficients (E1 ×1.3 / E2 ×1.2)",
      "Critical overrides: D3 alone / C2+D1 / human-confirmed F1 → forces 'high' regardless of score",
      "Bands: 0–5 low / 6–12 med / 13+ high",
      "F1 (designation-list match) auto-ticks on a high-confidence OSINT hit; untick if a same-name/translit false positive",
    ],
  },
  privacyHead: { ja: "プライバシー", en: "Privacy" },
  privacy: {
    ja: [
      "第1層（チェックリスト＋スコア）は端末内で完結・非送信・APIキー不要。",
      "§6/§7 は自分のAnthropicキーで送信時のみ。サーバに保存しない。",
      "案件履歴はローカル暗号化DB（SQLCipher）・gitignore。エクスポートはage暗号化。",
    ],
    en: [
      "Layer-1 (checklist + score) runs entirely on your device; nothing is sent; no API key needed.",
      "§6/§7 send only when you trigger them, with your own Anthropic key; nothing is stored server-side.",
      "Case history is a local encrypted DB (SQLCipher), gitignored; exports are age-encrypted.",
    ],
  },
} as const;

export function AboutPanel({ onClose }: { onClose: () => void }) {
  const lang = useLang();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const list = (items: readonly string[]) => (
    <ul>
      {items.map((x, i) => (
        <li key={i}>{x}</li>
      ))}
    </ul>
  );

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={L.title[lang]} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{L.title[lang]}</h2>
          <button type="button" className="ghost" onClick={onClose}>
            ✕ {L.close[lang]}
          </button>
        </div>
        <div className="modal-body">
          <h3>{L.whatHead[lang]}</h3>
          {list(L.what[lang])}

          <h3>{L.scenariosHead[lang]}</h3>
          {list(L.scenarios[lang])}

          <h3>{L.sourcesHead[lang]}</h3>
          <table className="about-table">
            <thead>
              <tr>
                <th>{L.colTool[lang]}</th>
                <th>{L.colCheck[lang]}</th>
                <th>{L.colInd[lang]}</th>
                <th>{L.colSrc[lang]}</th>
                <th>{L.colKey[lang]}</th>
              </tr>
            </thead>
            <tbody>
              {SOURCES.map((s) => (
                <tr key={s.tool}>
                  <td><code>{s.tool}</code></td>
                  <td>{s.check[lang]}</td>
                  <td>{s.indicator}</td>
                  <td>{s.source}</td>
                  <td>{s.key === "—" ? "—" : <code>{s.key}</code>}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3>{L.guideHead[lang]}</h3>
          {list(L.guide[lang])}

          <h3>{L.scoreHead[lang]}</h3>
          {list(L.score[lang])}

          <h3>{L.privacyHead[lang]}</h3>
          {list(L.privacy[lang])}
        </div>
      </div>
    </div>
  );
}
