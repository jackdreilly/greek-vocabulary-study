import { Firestore } from "@google-cloud/firestore";
const db = new Firestore({ projectId: "didibros-6d3ed", databaseId: "greek-vocab" });
const kind = process.argv[2]; // 'course' or 'theme'
const id = process.argv[3];
const doc = await db.collection(kind === "course" ? "courses" : "themes").doc(id).get();
const desc = doc.data()?.description || "";
console.log(desc.slice(0, 4000));
