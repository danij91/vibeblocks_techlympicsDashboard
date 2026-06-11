# Techlympics Firestore Scripts

These scripts use the Firebase client SDK. They do not deploy rules.

## One-time admin role

Firestore rules cannot mint the first admin. Create one manually:

1. Run `node scripts/seed.mjs --whoami`.
2. Copy the printed anonymous `uid`.
3. In Firebase Console or the Firestore emulator UI, create `roles/{uid}`:

```json
{
  "role": "admin",
  "createdAt": "<server timestamp>"
}
```

For an organizer-only seed account, use `"role": "organizer"` instead. The seed script writes demo data through normal client writes, so this role must exist before seeding.

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

Seed output includes event, school, class, teacher, and join codes.

## Rules invariant check

Start only the Firestore emulator from this package:

```bash
firebase emulators:start --only firestore
```

Then run:

```bash
node scripts/check-rules.mjs
```

The checker loads `firestore.rules` through `firebase emulators:exec` style REST calls when the emulator is already running. It verifies these required denials:

- 4th attempt is rejected.
- Frozen event attempt is rejected.
- Forged board entry for another participant is rejected.
- Bad teacher code binding is rejected.
- `ownerUid` rebinding without a recovery claim is rejected.
