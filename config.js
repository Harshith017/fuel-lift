/* MaxxTempo — your project's settings. Both values are safe to publish:
   the anon key only works together with the database's row-level security,
   which lets each person read and write their own data and nothing else.
   Find them in Supabase → Project Settings → API. */
window.FL_CONFIG = {
  SUPABASE_URL: 'https://idmvlecpdgtiyjeikphi.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlkbXZsZWNwZGd0aXlqZWlrcGhpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA0MjMyOTIsImV4cCI6MjEwNTk5OTI5Mn0.eX2G--DGOTm2lJUriMKflHlYQzg2LVZiFPPLcXjyTrk',
  GOOGLE_SIGN_IN: false,   // true once Google sign-in is set up in Supabase (SETUP.md step 4)
  CLAUDE: true,            // false to hide Claude features until the edge function is deployed
};
