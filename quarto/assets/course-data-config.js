(() => {
  "use strict";

  // The publishable key is intentionally public. Never place a service-role key here.
  // Set enabled to true only after the Supabase migrations and Edge Functions are deployed.
  const defaults = {
    enabled: true,
    supabaseUrl: "https://zptxvabdxohzrixkmvrd.supabase.co",
    publishableKey: "sb_publishable_9SIFT7dttTjzeF4Dixvx5g_pr2xKgSM",
    courseVersion: "1.3.0",
    consentVersion: "2026-08-11-v2",
    noticePath: "/accelerometer-learning-course/data-privacy.html",
    githubOauthEnabled: true,
    emailOtpEnabled: false,
    // Email OTP stays unavailable unless both Turnstile values are deliberately
    // activated in the same reviewed release. The site key is public; the
    // Turnstile secret belongs only in Supabase Auth.
    turnstileEnabled: false,
    turnstileSiteKey: ""
  };

  const supplied = window.ACCELEROMETER_BACKEND_CONFIG || {};
  window.ACCELEROMETER_BACKEND_CONFIG = Object.freeze({ ...defaults, ...supplied });
})();
