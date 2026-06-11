# Techlympics Firestore Scripts

These scripts use the Firebase client SDK. They do not deploy rules.

## One-time master/admin role

Firestore rules cannot mint the first `master` role. Create it manually:

1. Run `node scripts/seed.mjs --whoami`.
2. Copy the printed anonymous `uid`.
3. In Firebase Console or the Firestore emulator UI, create `roles/{uid}`:

```json
{
  "role": "master",
  "createdAt": "<server timestamp>"
}
```

The seed script also accepts `"role": "admin"` because event/school seeding only needs admin-level writes. `master` is required for issuing `adminInvites`.

## Seed demo data

Set the same Firebase web config values used by Vite:

```bash
export VITE_FIREBASE_API_KEY="..."
export VITE_FIREBASE_AUTH_DOMAIN="..."
export VITE_FIREBASE_PROJECT_ID="..."
export VITE_FIREBASE_APP_ID="..."
node scripts/seed.mjs
```

With local emulators:

```bash
export VITE_FIREBASE_PROJECT_ID="demo-techlympics"
export VITE_FIREBASE_API_KEY="demo"
export VITE_FIREBASE_AUTH_DOMAIN="demo-techlympics.firebaseapp.com"
export VITE_FIREBASE_APP_ID="demo"
export FIRESTORE_EMULATOR_HOST="127.0.0.1:8080"
export FIREBASE_AUTH_EMULATOR_HOST="127.0.0.1:9099"
node scripts/seed.mjs
```

Seed output includes a v2 event with challenges 201/202/203, `attemptsPerChallenge`, school IDs, class join codes, and teacher codes.

## Rules invariant check

Start only the Firestore emulator from this package:

```bash
firebase emulators:start --only firestore
```

Then run:

```bash
node scripts/check-rules.mjs
```

The checker verifies these v2 invariants:

- Slot 4th attempt is rejected.
- Another slot is still available after one slot is exhausted.
- Frozen event attempts are rejected.
- Forged board bests are rejected when they point at another attempt, a failed run, or mismatched `timeSec`.
- A `teacher` role cannot issue `adminInvites`.
- A user cannot create their own `master` role.
