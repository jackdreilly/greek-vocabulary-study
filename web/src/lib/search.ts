// Greeklish transliteration of Greek strings for fuzzy/latin-input search.
const DIGRAPHS: Array<[RegExp, string]> = [
  [/μπ/g, "b"],
  [/ντ/g, "d"],
  [/γκ/g, "g"],
  [/γγ/g, "ng"],
  [/τσ/g, "ts"],
  [/τζ/g, "tz"],
  [/ού/g, "ou"],
  [/ου/g, "ou"],
  [/αύ/g, "av"],
  [/αυ/g, "av"],
  [/εύ/g, "ev"],
  [/ευ/g, "ev"],
  [/αί/g, "ai"],
  [/αι/g, "ai"],
  [/εί/g, "ei"],
  [/ει/g, "ei"],
  [/οί/g, "oi"],
  [/οι/g, "oi"],
  [/υι/g, "yi"],
];

const SINGLES: Record<string, string> = {
  α: "a",
  ά: "a",
  β: "v",
  γ: "g",
  δ: "d",
  ε: "e",
  έ: "e",
  ζ: "z",
  η: "i",
  ή: "i",
  θ: "th",
  ι: "i",
  ί: "i",
  ϊ: "i",
  ΐ: "i",
  κ: "k",
  λ: "l",
  μ: "m",
  ν: "n",
  ξ: "ks",
  ο: "o",
  ό: "o",
  π: "p",
  ρ: "r",
  σ: "s",
  ς: "s",
  τ: "t",
  υ: "i",
  ύ: "i",
  ϋ: "i",
  ΰ: "i",
  φ: "f",
  χ: "ch",
  ψ: "ps",
  ω: "o",
  ώ: "o",
};

export function transliterate(text: unknown) {
  if (!text) return "";
  let s = String(text);
  for (const [pat, repl] of DIGRAPHS) s = s.replace(pat, repl);
  let out = "";
  for (const ch of s) out += SINGLES[ch] ?? ch;
  return out;
}

function stripMarks(text: string) {
  return text.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
}

function normalizeForSearch(text: unknown) {
  return stripMarks(transliterate(String(text || "")))
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/ch|kh/g, "x")
    .replace(/ks/g, "x")
    .replace(/ai/g, "e")
    .replace(/ei|oi|yi/g, "i")
    .replace(/ou/g, "u")
    .replace(/g(?=[ie])/g, "y")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function textMatchesSearch(text: unknown, query: unknown) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return true;
  const raw = String(text || "").toLowerCase();
  const transText = transliterate(raw).toLowerCase();
  const transQuery = transliterate(q).toLowerCase();
  const normText = normalizeForSearch(raw);
  const normQuery = normalizeForSearch(q);
  return (
    raw.includes(q) ||
    transText.includes(q) ||
    raw.includes(transQuery) ||
    transText.includes(transQuery) ||
    (normQuery.length > 0 && normText.includes(normQuery))
  );
}
