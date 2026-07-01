/**
 * firebase.js
 * Initializes Firebase and exports the Firestore database instance used by
 * multiplayer.js.
 *
 * ------------------------------------------------------------------
 * SETUP INSTRUCTIONS
 * ------------------------------------------------------------------
 * 1. Go to https://console.firebase.google.com/ and create a project.
 * 2. In the project, add a "Web App" (</> icon) to get your config object.
 * 3. Enable Cloud Firestore (Build -> Firestore Database -> Create database).
 *    Start in test mode while developing, then lock it down using the
 *    security rules example in README.md before going live.
 * 4. Paste your config values into firebaseConfig below.
 * ------------------------------------------------------------------
 */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  updateDoc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  deleteField,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

// ------------------------------------------------------------------
// REPLACE WITH YOUR OWN FIREBASE PROJECT CONFIG
// ------------------------------------------------------------------
const firebaseConfig = {
  apiKey: "AIzaSyCR6RBMZM0WB2bWnKdE8qXljpe7KLXn7Wg",
  authDomain: "avalanche-mancala.firebaseapp.com",
  projectId: "avalanche-mancala",
  storageBucket: "avalanche-mancala.firebasestorage.app",
  messagingSenderId: "377333989320",
  appId: "1:377333989320:web:0fb3b53cba269eef4c0afd",
  measurementId: "G-1PH5Y5YNPY"
};
// ------------------------------------------------------------------

let app = null;
let db = null;
let initError = null;

try {
  const isPlaceholder = firebaseConfig.apiKey === 'YOUR_API_KEY';
  if (isPlaceholder) {
    initError = 'Firebase config has not been set up yet (still using placeholders).';
    console.warn(
      '[firebase.js] ' +
        initError +
        ' Online multiplayer will be disabled until you add real credentials in firebase.js.'
    );
  } else {
    app = initializeApp(firebaseConfig);
    db = getFirestore(app);
  }
} catch (err) {
  initError = err.message;
  console.error('[firebase.js] Failed to initialize Firebase:', err);
}

export function isFirebaseReady() {
  return !!db;
}

export function getInitError() {
  return initError;
}

export {
  db,
  doc,
  setDoc,
  getDoc,
  updateDoc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  deleteField,
};
