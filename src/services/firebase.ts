import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  type User as FirebaseUser,
} from 'firebase/auth';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'AIzaSyAvAJNn-KUfMC10Msa5ChJ9aJBsMIlVSQc',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'ekarting-92ce9.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'ekarting-92ce9',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'ekarting-92ce9.firebasestorage.app',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '153855892524',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:153855892524:web:3e1e65f23e371b83068589',
};

const hasConfig = !!firebaseConfig.apiKey;
const app = hasConfig ? initializeApp(firebaseConfig) : null;
const auth = app ? getAuth(app) : null;
const googleProvider = hasConfig ? new GoogleAuthProvider() : null;

export { auth, googleProvider, signInWithPopup, signOut, onAuthStateChanged, hasConfig };
export type { FirebaseUser };
