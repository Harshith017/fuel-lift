/* Fuel & Lift — your project's settings. Both values are safe to publish:
   the anon key only works together with the database's row-level security,
   which lets each person read and write their own data and nothing else.
   Find them in Supabase → Project Settings → API. */
window.FL_CONFIG = {
  SUPABASE_URL: 'https://YOUR_PROJECT.supabase.co',
  SUPABASE_ANON_KEY: 'YOUR_ANON_KEY',
  GOOGLE_SIGN_IN: false,   // true once Google sign-in is set up (SETUP.md step 4)
  CLAUDE: true,            // false to hide Claude features until the edge function is deployed
};
