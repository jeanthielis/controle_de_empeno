// firebase-config.js
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

// Substitua pelas configurações do seu projeto Firebase Console
const firebaseConfig = {
  apiKey: "AIzaSyCl_EWjmCTJnS-vB5ndpy5eRc-dcc31MAk",
  authDomain: "empeno-pro.firebaseapp.com",
  projectId: "empeno-pro",
  storageBucket: "empeno-pro.firebasestorage.app",
  messagingSenderId: "401582903292",
  appId: "1:401582903292:web:8337cba91871260f72ac79",
  measurementId: "G-D37L5ZQ913"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

export { db };