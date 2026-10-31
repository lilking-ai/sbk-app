// Paste the Firebase web config here (Project settings → Your apps → </>).
// These values are not secret. Security comes from firestore.rules.
export const firebaseConfig = {
  apiKey: "AIzaSyAoXRFPG0_cf_rOfFQ-ieMfwsfnIyA9YxA",
  authDomain: "storm-breakers-24185.firebaseapp.com",
  projectId: "storm-breakers-24185",
  storageBucket: "storm-breakers-24185.firebasestorage.app",
  messagingSenderId: "513277250987",
  appId: "1:513277250987:web:b4a3d124c0fc4a656116ee"
};

export const CHANNELS = [
  { id: 'announcements', name: 'announcements', icon: '📢', desc: 'Clan news. Only staff can post here.', staffOnly: true },
  { id: 'general', name: 'general', icon: '💬', desc: 'Hang out and chat.' },
  { id: 'lfg', name: 'looking-for-squad', icon: '🎮', desc: 'Find a duo, trio or squad.' },
  { id: 'clips', name: 'clips', icon: '🎬', desc: 'Screenshots and best plays. Press F8 to share fast.' },
  { id: 'wins', name: 'wins', icon: '🏅', desc: 'Post your Victory Royales.' },
];

export const LINKS = {
  apply: 'https://tally.so/r/J1qKJY',
  cup: 'https://tally.so/r/laBaD5',
  challenge: 'https://tally.so/r/VpGpEa',
  staff: 'https://tally.so/r/Qo1o2g',
  report: 'https://tally.so/r/7XqXRL',
  discord: 'https://discord.gg/pkhaeUHX7W',
};

export const SCHEDULE = [
  ['🏆 Weekly SBK Cup', 'Sat 8:00 PM', 'https://tally.so/r/laBaD5'],
  ['⚔️ Clan War Night', 'Wed 8:00 PM'],
  ['🎓 Coaching Night', 'Mon 7:00 PM'],
];
