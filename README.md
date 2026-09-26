# MaxxTempo

Food, training, recovery and health tracking. Type or photograph what you ate or did, and Claude turns it into calories, macros, micronutrients, training load and recovery advice. Your targets come from tested formulas, then correct themselves from your own weigh-ins and food logs.

- Open the app: https://harshith017.github.io/maxxtempo/
- Set it up: [SETUP.md](SETUP.md)
- Test the maths: `node --test calc.test.js`

**Layout**
- `index.html`, `app.js`: the app (installable, works offline)
- `calc.js`: every formula, covered by `calc.test.js`
- `foods.js`: built-in food table (130 foods with micronutrients)
- `backend.js`: sign-in, offline-first sync, calls to Claude
- `supabase/`: database script, the `claude` server function, one-command setup
