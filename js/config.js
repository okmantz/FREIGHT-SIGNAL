// Cloud accounts: the two values that connect this site to YOUR Firebase project (free "Spark" plan, no credit card).
// Setup takes about 5 minutes: see docs/CLOUD-SETUP.md. Both values are safe to publish (they identify the project, they are not
// secrets); what actually protects each person's data is the rule in database.rules.json that you publish in the Firebase console.
//
// Leave apiKey / databaseURL empty and Freight Signal keeps working exactly as before (data only in this browser, local sign-in).
export const CLOUD_CONFIG = {
  apiKey: '',        // Firebase console > Project settings > General > Web API Key
  databaseURL: '',   // Firebase console > Build > Realtime Database > the URL at the top, e.g. https://your-project-default-rtdb.firebaseio.com
  shareUrl: 'https://okmantz.github.io/FREIGHT-SIGNAL/',  // the link shown under Account Settings > Invite people
};
