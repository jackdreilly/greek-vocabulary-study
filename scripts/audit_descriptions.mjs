// Audit all course and theme descriptions for malformed markdown.
import { Firestore } from "@google-cloud/firestore";
const db = new Firestore({ projectId: "didibros-6d3ed", databaseId: "greek-vocab" });

function audit(text) {
  const issues = [];
  if (!text) { issues.push("empty"); return issues; }
  if (text.length > 7800) issues.push(`too long (${text.length})`);
  if (text.length < 400) issues.push(`too short (${text.length})`);
  // Real "runaway" — 40+ consecutive dashes outside a table separator line (which starts with |).
  for (const line of text.split("\n")) {
    if (/-{40,}/.test(line) && !/^\s*\|/.test(line)) {
      issues.push(`runaway dashes in prose line: "${line.slice(0, 80)}…"`);
      break;
    }
  }
  if (/^```/m.test(text)) issues.push("contains code fence (AI wrapped output)");
  // Raw HTML tags where markdown should be (h1/h2/h3 in particular).
  if (/<h[123]>/i.test(text)) issues.push("uses raw <h1>/<h2>/<h3> HTML instead of markdown");
  if (!/^#\s/.test(text.trim())) issues.push("no leading H1 (# title)");
  // Stray template artifacts.
  if (/STYLE GUIDE|systemInstruction|^STRICT:/m.test(text)) issues.push("leaked prompt text");
  return issues;
}

const [csnap, tsnap] = await Promise.all([
  db.collection("courses").get(),
  db.collection("themes").get(),
]);

let ok = 0, bad = 0;
for (const d of csnap.docs) {
  const data = d.data();
  const issues = audit(data.description, `course/${d.id}`);
  if (issues.length) { console.log(`COURSE ${d.id}:`, issues.join("; ")); bad++; }
  else ok++;
}
for (const d of tsnap.docs) {
  const data = d.data();
  if (data.hidden === true) continue;
  const issues = audit(data.description, `theme/${d.id}`);
  if (issues.length) { console.log(`THEME ${d.id} (${data.title}):`, issues.join("; ")); bad++; }
  else ok++;
}
console.log(`\nSummary: ${ok} clean, ${bad} with issues`);
