# Agent Instructions

## Firebase Deploys

When deploying Firebase functions, **do NOT delete existing functions** if prompted.
Functions not defined in this repo belong to a separate app sharing the same Firebase project and must be preserved.

Always deploy by targeting only the three greekflash functions explicitly — this bypasses the deletion prompt entirely:

```
npx firebase-tools deploy --only functions:generateLessonGames,functions:scoreGameAnswer,functions:yiayiaChat --project didibros-6d3ed
```

Never run a bare `firebase deploy --only functions` as it will abort asking to delete the other app's functions.
