// One lazily created Firestore client for the account portal's database
// (project PLAN_FIRESTORE_PROJECT_ID), shared by the plan lookup (reads
// `organizations`) and the monthly usage counters (writes
// `api_usage_monthly`). Created on first use so nothing needs credentials or
// opens a connection until a request actually needs it, which keeps unit and
// e2e tests offline. Credentials come from ADC: on Cloud Run, the runtime
// service account, which needs roles/datastore.user on the project (viewer is
// enough for plan reads alone; the counters write).
let client: any | undefined;

/** Whether the hosted portal's Firestore is configured. Self-hosted installs leave it unset. */
export function portalFirestoreConfigured(): boolean {
  return !!process.env.PLAN_FIRESTORE_PROJECT_ID;
}

export function portalFirestore(): any {
  if (!client) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Firestore } = require('@google-cloud/firestore');
    client = new Firestore({
      projectId: process.env.PLAN_FIRESTORE_PROJECT_ID,
      preferRest: true,
    });
  }
  return client;
}

export function firestoreFieldValue(): any {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('@google-cloud/firestore').FieldValue;
}
