// Force-regenerate description for one theme id.
import { Firestore } from "@google-cloud/firestore";
const db = new Firestore({ projectId: "didibros-6d3ed", databaseId: "greek-vocab" });
const themeId = process.argv[2];
if (!themeId) { console.error("usage: regen_theme.mjs <themeId>"); process.exit(1); }
await db.collection("themes").doc(themeId).update({ description: "" });
console.log(`cleared description for theme ${themeId}`);
