// Deployment config. Everything here can also be overridden in the app's Settings screen.
export const CONFIG = {
  // Where theme requests are POSTed. Empty = fall back to a mailto: link.
  //  - Plain webhook:  any https URL; receives JSON (see js/request.js)
  //  - ntfy.sh topic:  "https://ntfy.sh/<secret-topic>"  (no account needed; push notification + pollable by Zeke)
  REQUEST_WEBHOOK_URL: '',
  // Recipient for the mailto: fallback (used when no webhook is set). Set in Settings or here.
  REQUEST_MAILTO_TO: '',
  REQUEST_MAILTO_SUBJECT: 'Writing Session theme request',
};
