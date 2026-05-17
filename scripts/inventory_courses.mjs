import { Firestore } from "@google-cloud/firestore";
const db = new Firestore({ projectId: "didibros-6d3ed", databaseId: "greek-vocab" });

const coursesSnap = await db.collection("courses").get();
const themesSnap = await db.collection("themes").get();
const themes = themesSnap.docs.map(d => d.data());

const courses = coursesSnap.docs.map(d => d.data());
for (const c of courses) {
  const courseThemes = themes.filter(t => t.courseId === c.id);
  console.log(`\n## ${c.id} :: ${c.title}`);
  console.log(`  description present: ${!!c.description} (len=${(c.description||'').length})`);
  console.log(`  themes: ${courseThemes.length}`);
  for (const t of courseThemes) {
    const entrySnap = await db.collection("entries").where("theme_id", "==", Number(t.id)).limit(8).get();
    const samples = entrySnap.docs.map(d => {
      const e = d.data();
      const senses = (e.english_senses || []).slice(0, 2).join(" / ");
      return `${e.lemma} → ${senses}`;
    });
    console.log(`  - ${t.id} | ${t.title} | desc=${!!t.description} | sample: ${samples.slice(0,4).join("; ")}`);
  }
}
