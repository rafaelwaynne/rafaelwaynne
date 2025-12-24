const admin = require('firebase-admin');

// Initialize Firebase Admin
// It will attempt to load credentials from GOOGLE_APPLICATION_CREDENTIALS environment variable
// or standard Google Cloud environment discovery.
if (!admin.apps.length) {
  try {
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      // Allow passing JSON directly via env var (useful for some hosting providers)
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
    } else {
      admin.initializeApp();
    }
    console.log('Firebase Admin initialized successfully');
  } catch (error) {
    console.error('Failed to initialize Firebase Admin:', error);
    // Fallback or re-throw depending on strictness. 
    // For now we log error, but if DB calls are made they will fail.
  }
}

const db = admin.firestore();

module.exports = { admin, db };
