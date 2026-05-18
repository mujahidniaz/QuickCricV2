// QuickCric configuration.
// Fill these in to enable cloud storage + live share links.
//
// Steps (one-time, ~3 minutes, no credit card):
//   1. Sign up at https://supabase.com and create a new project.
//   2. Open the SQL editor and paste the schema from CLAUDE.md (the "Supabase setup" block).
//   3. From Project Settings → API, copy the Project URL and the `anon` public key.
//   4. Paste them below and reload.
//
// If left blank, the app falls back to localStorage (single-device, no sharing).

window.QC_CONFIG = {
  SUPABASE_URL: 'https://nwfzivzgfwruhedxpyuv.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im53ZnppdnpnZndydWhlZHhweXV2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkwMzc5MDcsImV4cCI6MjA5NDYxMzkwN30.0UI0ouSISdnkfx1Iw91hgEOCVaH9-zeHNbhLr_Tl3Qg',

  // Passcode required to delete a saved match. Change this to your own.
  DELETE_PASSCODE: '1234'
};
