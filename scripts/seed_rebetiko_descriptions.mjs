// Seeds course + lesson markdown descriptions for the
// "Modern Greek Cultural Heritage and Music" course (rebetiko).
//
// Pattern: each course/lesson gets a `description` markdown field that
//  1) renders as the home page in the UI, and
//  2) is passed to the AI as authoritative context for plans + games.
//
// Run:   node scripts/seed_rebetiko_descriptions.mjs

import { Firestore } from "@google-cloud/firestore";

const PROJECT_ID = "didibros-6d3ed";
const DATABASE_ID = "greek-vocab";
const COURSE_ID = "modern-greek-cultural-heritage-and-music";

const db = new Firestore({ projectId: PROJECT_ID, databaseId: DATABASE_ID });

const COURSE_DESCRIPTION = `# Modern Greek Cultural Heritage and Music

A journey into **rebetiko** (ρεμπέτικο) — the urban folk song of early-20th-century Greece
that became the soul of a generation. This course teaches modern Greek through the lyrics,
the slang, and the lived world of the rebetes: their cafés (*καφέ-αμάν*), their
*hashish dens* (*τεκέδες*), their dances, their loves and their grief.

## Why learn Greek through rebetiko?

Rebetiko is one of the most **lyrically dense** forms of Greek ever written. In two short
verses a rebetiko song will use everyday vocabulary, sailor slang, Ottoman loanwords, prison
argot, and tender poetic phrasing — all stitched together in a way that no textbook ever
captures. Reading the lyrics is like reading a compressed phrase-book of the Greek street.

## What you'll learn

- **Core thematic vocabulary** of the rebetiko world: instruments, dances, emotions,
  neighbourhoods, social roles.
- **Cultural literacy** — what a *μάγκας* is, what *μεράκι* means, why the *μπουζούκι* was
  once illegal, what *νταλκάς* feels like.
- **The historical arc** — from the 1922 Asia Minor catastrophe and the refugee wave that
  brought *Σμυρναίικο* music to Piraeus, through the 1936 Metaxas ban on hashish songs,
  to the post-war "archontorebetiko" of Tsitsanis.

## The world this music inhabits

> "Στου *Θωμά* το μαγαζί
> γίνεται φασαρία" — *Markos Vamvakaris*

Most rebetiko songs are tiny stories set in very specific places: the *τεκές* (hashish den),
the *ταβέρνα*, the prison yard, the port of *Πειραιάς*, the refugee neighbourhood of
*Κοκκινιά*. Each lesson in this course is anchored in one of these worlds.

## How the lessons are organised

1. **Musical Traditions** — the instruments, the dances, the words for skill, soulfulness
   and longing. The DNA of the genre.
2. **Marriage, Dowry & Social Class** — the *προίκα* drama: arranged marriages, money,
   the woman who runs away with the *μάγκας*.
3. **Urban Folk Poetry** — the emotional vocabulary of love, separation, neighbourhood
   life and night-time confessions.

Every lesson centres on **real song lyrics**. The flashcards drill the vocabulary; the
Plans deep-dive into one cultural or grammatical thread; the Games practise the words in
scenes drawn from the song itself, not from a generic classroom.
`;

const LESSON_DESCRIPTIONS = {
  // Theme 1: Musical Traditions
  1778952957251427: `# Musical Traditions: The World of Rebetiko Songs

This lesson unpacks the **sonic and material world** of rebetiko: the instruments the
musicians played, the dances they danced, and the cluster of Greek words that name
the *feeling* of the music itself.

## Cornerstone song: "Φραγκοσυριανή" (Markos Vamvakaris, 1935)

One of the most beloved rebetika ever recorded. Vamvakaris was a *Συριανός* (from
Syros) who fell for a Catholic ("Frankish") girl from his island. The song's plain
language and naked longing made it a national standard.

> Μια φραγκοσυριανή γλυκιά
> θα κάνω βόλτα στο γιαλό
> να σε ιδώ να σε γνωρίσω
> να σου πω τον καημό μου
> να σου πω και τον *νταλκά* μου

> Όλη μέρα θα 'μαι μάγκας
> και την νύχτα *μερακλής*
> θα ξοδεύω χίλια φράγκα
> για ν' ακούσεις πως πονείς

Notice how a *single quatrain* delivers a perfect rebetiko vocabulary kit: **μάγκας**
(the streetwise figure), **μερακλής** (a person of refined taste, an aesthete of
pleasure), **νταλκάς** (a deep, almost narcotic longing), **καημός** (a slower-burning
grief). These four words alone open the door to half the genre.

## The instruments

Rebetiko's signature sound is the **μπουζούκι** — a long-necked lute brought from Asia
Minor refugees in 1922. Its smaller cousin the **μπαγλαμάς** could be hidden inside a
jacket during the Metaxas years when bouzouki was effectively banned. The **τζουράς**
sits between them in size and tone.

| Instrument | Modern Greek | Origin |
|---|---|---|
| Bouzouki | μπουζούκι | Asia Minor (from Turkish *bozuk*) |
| Baglamas | μπαγλαμάς | Pocket-sized, smuggle-friendly |
| Tzouras | τζουράς | Mid-sized, mellower |

## The dances

- **Ζεϊμπέκικο** (zeibekiko) — a solo male dance in 9/8 time, danced inward, eyes down,
  arms wide. It's not for a partner; it's a confession in motion.
- **Χασάπικο** — the "butcher's dance," shoulder-to-shoulder, the precursor to syrtaki.
- **Καρσιλαμάς** — face-to-face, in 9/8, originally Asia Minor.

## Core feelings: a vocabulary of soul

Three Greek words English can barely translate:

- **μεράκι** — to do something with your whole self, with love and craft. *"Το έκανε
  με μεράκι."*
- **νταλκάς** — the heavy, drugged ache of unrequited or unreachable love.
- **καημός** — a long-running sorrow you almost cherish. The bittersweet residue
  of loss.

## Pedagogical note

When studying these words, **resist the urge** to map them to single English glosses.
A *μάγκας* is not just a "tough guy" — he's a posture, a code, a way of carrying
yourself in the *μαχαλάς*. The flashcards give you a hook; the songs give you the
real meaning.
`,

  // Theme 2: Marriage, Dowry & Social Class
  1778955198501602: `# Marriage, Dowry, and Social Class in Rebetiko

Rebetiko was the soundtrack of people the bourgeois Greek state preferred not to
acknowledge: refugees, dockworkers, prisoners, hashish smokers, the urban poor.
Inevitably, **marriage** — and the system of *προίκα* (dowry) that gated it —
becomes one of the genre's recurring battlegrounds.

## Cornerstone song: "Η προίκα σου" (Vassilis Tsitsanis)

> Δεν θέλω την προίκα σου
> δε θέλω τα λεφτά σου
> εσένα μόνο αγαπώ
> κι ας με μαλώνει η μάνα σου

A plainspoken protest against the **transactional marriage**. The *μάγκας* declares
that he wants the woman, not her dowry — knowing full well that this refusal of money
is itself a class statement.

## The προίκα system

Until well into the 20th century, a Greek woman's chance of marriage depended on the
*προίκα* her family could provide: cash, gold, linens, sometimes a house. The system
locked poor women out of "good" marriages and gave families enormous control over
their daughters. Rebetiko, born in the slums where προίκες were small or non-existent,
treats it with mockery, defiance, and occasionally rage.

## Vocabulary of class and family

| Greek | English | Register |
|---|---|---|
| προίκα | dowry | neutral / formal |
| γαμπρός | groom / son-in-law | neutral |
| νύφη | bride / daughter-in-law | neutral |
| πεθερά | mother-in-law | neutral (but often loaded) |
| νοικοκυρά | housewife / good homemaker | values-laden compliment |
| αρχόντισσα | lady (of standing) | aspirational |
| ντόρτυ | bad / cheap (slang) | rebetiko slang |
| μάγκας | streetwise man | rebetiko core |
| σαλταδόρος | "jumper" / petty thief | early-20th-century slang |

## A recurring rebetiko archetype

The **runaway bride** — the *κόρη* of a wealthy household who falls for a *μάγκας*
from the docks and chooses him over the rich, dull *γαμπρός* her father has arranged.
This is partly fantasy, partly real, but always a class allegory.

## Cultural notes for the AI and the learner

- The word *νοικοκυρά* is **not a neutral synonym** for "housewife" — it carries the
  full weight of bourgeois respectability. To call a rebetissa a *νοικοκυρά* would
  be a compliment with an edge.
- *Πεθερά* (mother-in-law) appears in dozens of rebetika as the gatekeeper of the
  *προίκα* and therefore the obstacle to the wedding.
- The *μάγκας* refusing the προίκα is **the** signature romantic gesture of the
  genre, comparable to the rock-and-roll motif of running away from home.
`,

  // Theme 3: Urban Folk Poetry
  1778962044555247: `# Urban Folk Poetry: Emotions and Neighborhood Life

This lesson is about rebetiko **as poetry** — the way the songs compress entire
emotional lives into 8-line verses, and the way they map the Greek city: the
*γειτονιά* (neighbourhood), the *πλατεία* (square), the *παράθυρο* (window) above
the street, the *καπηλειό* (small taverna) on the corner.

## Cornerstone song: "Συννεφιασμένη Κυριακή" (Tsitsanis, 1948)

The most famous Greek song ever written. Composed under the Nazi occupation and
released after the civil war, it's a national lament in the form of an apostrophe
to a *Sunday*.

> Συννεφιασμένη Κυριακή,
> μοιάζεις με την καρδιά μου
> που έχει πάντα συννεφιά,
> Χριστέ και Παναγιά μου.

> Είσαι μια μέρα σαν κι αυτή,
> που 'χασα τη χαρά μου.
> Συννεφιασμένη Κυριακή,
> ματώνεις την καρδιά μου.

Notice the **technique**: the weather *is* the heart. The Sunday *bleeds* the heart.
The whole song is a single sustained metaphor — a structure that recurs across
rebetiko, where a season, a port, or a window stands in for an interior state.

## Vocabulary of feeling and place

| Greek | English | Notes |
|---|---|---|
| καρδιά | heart | the seat of all feeling — used relentlessly |
| πόνος | pain | emotional more often than physical |
| λύπη | sorrow | quieter than πόνος |
| χαρά | joy | often "lost" rather than felt |
| παράθυρο | window | the rebetiko stage for longing |
| γειτονιά | neighbourhood | almost a character in many songs |
| μαχαλάς | quarter / hood | slangier than γειτονιά (Turkish loan) |
| ταβέρνα | taverna | where the songs are sung |
| καπηλειό | small wine-shop / hole-in-the-wall | older, more intimate |
| φεγγάρι | moon | witness to lovers' farewells |

## Recurring poetic moves

1. **Direct address** to a weather, a day, or a place: *"Συννεφιασμένη Κυριακή…"* or
   *"Πειραιά μου…"*.
2. **Body as map**: the heart bleeds, the eyes drink, the soul drowns. Always
   somatic, never abstract.
3. **Neighbourhood as character**: *"στη γειτονιά μας"* (*in our quarter*) frames
   many songs — the *γειτονιά* knows, gossips, judges, comforts.
4. **The window**: the lover at the window, the rival under it, the rain against
   it. The *παράθυρο* is the rebetiko proscenium.

## A second song: "Φραγκοσυριανή"… revisited

Cross-pollinate with Lesson 1: notice how the *νταλκάς* there — narcotic longing —
is the same emotional family as the *πόνος* and *λύπη* here, but the **register**
is wildly different. *Νταλκάς* belongs in the τεκές; *λύπη* belongs in the church
and the kitchen. Same wound, two vocabularies.

## Pedagogical note for plan and game generation

When constructing exercises, **stay inside this world**. A practice sentence about
a *γειτονιά* should evoke a balcony, a *φεγγάρι*, a passing accordion — not a
classroom whiteboard. The lesson's vocabulary lives where the songs live.
`,
};

async function main() {
  console.log(`Updating course ${COURSE_ID}…`);
  await db
    .collection("courses")
    .doc(COURSE_ID)
    .set(
      {
        description: COURSE_DESCRIPTION,
        updatedAt: Date.now(),
      },
      { merge: true },
    );
  console.log("  ✓ course description written");

  for (const [themeId, description] of Object.entries(LESSON_DESCRIPTIONS)) {
    console.log(`Updating theme ${themeId}…`);
    await db
      .collection("themes")
      .doc(themeId)
      .set(
        {
          description,
          updatedAt: Date.now(),
        },
        { merge: true },
      );
    console.log(`  ✓ theme ${themeId} description written`);
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
