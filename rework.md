Time for a from-scratch rewrite, targeting code health, reactivity, performance, maintenance, and usability.

Use ~/Documents/fanariotes as a suggestion on how to restructure the DB and app for better reactivity and code health

Make everything more firestore reactive with immediate writes, triggers, and streams

Reimagine the database schema from scratch to most usefully match the new intentions I mentioned above around immediacy, and leveraging the underlying strengths of firestore, and also given the current understanding of what the app is: a language learning app with courses -> lessons+overview -> overview+vocab -> games,plans and an AI assistant that follows you through the whole process. On top of this, it's been designed from the beginning to support AI-based generation of new material, based on the prompts of the users. Maybe we should be leveraging firestore child collections more, since we do have a lot hierarchical concepts.

Don't use modals for new material, just go ahead and create the material immediately, and then the user can revert what they don't like (Add a somewhat hidden "generation ID" to all entities, or some sort of AI edit log, so that the AI can later remove its material in bulk if a user requests through YiaYia Admin features)

Have the AI more "streaming". If it's doing bulk work, then have it do it in pieces that stream back (yet still being smart about avoid duplication/repetition of previous work through agentic concepts and RAG concepts)

De-emphasize everywhere in the UI all the "total" stats, like # of lessons, # of cards, games, etc... We don't need to see totals everywhere.

Do group-by counting through firestore triggers. perhaps using best practices from the web on how to solve this common problem with nosql-style DB's.

Use firestore triggers to make everything feel snappier. For instance, when you first prompt for a course generation, you could:

1. Immediately generate the courses/<newcourseid> firestore record from the front-end through immediate/direct writes, storing the prompt on the backend
2. Navigate to the currently-generating course, with a banner or something to indicate it's currently being initialized via AI on the backend
2. Firestore trigger then has the data it needs to AI generate a
  3. title
  4. overview
  5. first lesson
  6. lesson overview
  7. etc...
8. The firestore trigger finishes with a write to clear the initializing status
9. The front-end is listening to all these changes via firestore realtime stream, and showing the new material reactively

You can apply these same exact concepts for all AI generation features

In other words, we want tons of reactivity/realtime/immediate writes to make everything feel magical and confident and purposeful.

Break up the Gen AI calls into smaller pieces that are orchestrated together through deterministic code and RAG and such

The Gen AI has been having reliability issues, perhaps due to the complexity of the calls.

Create an admin page which allows me to tweak which model is used for all AI features dynamically (the AI checks the DB for its config before issuing the GenKit call for instance to determine its model). Set all models to flash lite 3.1 (preview i think) for now.
