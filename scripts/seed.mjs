import { initializeApp } from 'firebase/app'
import { getAuth, connectAuthEmulator, signInAnonymously } from 'firebase/auth'
import {
  Timestamp,
  collection,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore'
import { webcrypto } from 'node:crypto'

const alphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'

function randomCode(length) {
  const buf = new Uint32Array(length)
  webcrypto.getRandomValues(buf)
  return Array.from(buf, (n) => alphabet[n % alphabet.length]).join('')
}

const newJoinCode = () => randomCode(6)
const newTeacherCode = () => `T-${randomCode(8)}`

function firebaseConfig() {
  const projectId = process.env.VITE_FIREBASE_PROJECT_ID
  if (!projectId) throw new Error('VITE_FIREBASE_PROJECT_ID is required')
  return {
    apiKey: process.env.VITE_FIREBASE_API_KEY ?? 'demo',
    authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN ?? `${projectId}.firebaseapp.com`,
    projectId,
    storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.VITE_FIREBASE_APP_ID ?? 'demo',
  }
}

function connectEmulators(auth, db) {
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':')
    connectFirestoreEmulator(db, host, Number(port))
  }
  if (process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    connectAuthEmulator(auth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, { disableWarnings: true })
  }
}

async function signIn(auth) {
  const credential = await signInAnonymously(auth)
  return credential.user.uid
}

async function uniqueCode(db, collectionName, makeCode) {
  for (let i = 0; i < 30; i += 1) {
    const code = makeCode()
    if (!(await getDoc(doc(db, collectionName, code))).exists()) return code
  }
  throw new Error(`Could not allocate ${collectionName} code`)
}

async function requireAdminOrMaster(db, uid) {
  const deadline = Date.now() + 120_000
  let announced = false
  for (;;) {
    const snap = await getDoc(doc(db, 'roles', uid))
    if (snap.exists() && ['admin', 'master'].includes(snap.data().role)) return snap.data().role
    if (!announced) {
      console.log(`Waiting for role grant: create roles/${uid} with role "master" or "admin"`)
      announced = true
    }
    if (Date.now() > deadline) throw new Error(`Timed out waiting for roles/${uid}`)
    await new Promise((resolve) => setTimeout(resolve, 3000))
  }
}

async function seed() {
  const app = initializeApp(firebaseConfig())
  const auth = getAuth(app)
  const db = getFirestore(app)
  connectEmulators(auth, db)

  const uid = await signIn(auth)
  if (process.argv.includes('--whoami')) {
    console.log(uid)
    return
  }

  const role = await requireAdminOrMaster(db, uid)

  const eventRef = doc(collection(db, 'events'))
  const event = {
    id: eventRef.id,
    name: 'Techlympics 2026 (Demo)',
    startsAt: Timestamp.fromDate(new Date('2026-06-01T00:00:00.000Z')),
    endsAt: Timestamp.fromDate(new Date('2026-12-31T23:59:59.000Z')),
    challenges: [
      { slot: 'c1', missionId: 201, name: 'Challenge 1' },
      { slot: 'c2', missionId: 202, name: 'Challenge 2' },
      { slot: 'c3', missionId: 203, name: 'Challenge 3' },
    ],
    attemptsPerChallenge: 3,
    visibility: 'code-only',
    scoringVersion: 'v2',
    frozen: false,
    createdAt: serverTimestamp(),
  }

  const rows = [
    { schoolName: 'Kedah Legacy School', state: 'Kedah', classes: ['3 Amanah', '3 Bestari'] },
    { schoolName: 'Selangor Pilot School', state: 'Selangor', classes: ['5 Cerdik'] },
  ]

  const batch = writeBatch(db)
  batch.set(eventRef, event)
  const output = { eventId: eventRef.id, role, schools: [] }

  for (const row of rows) {
    const schoolRef = doc(collection(db, 'events', eventRef.id, 'schools'))
    const teacherCode = await uniqueCode(db, 'teacherCodes', newTeacherCode)
    const school = {
      id: schoolRef.id,
      eventId: eventRef.id,
      name: row.schoolName,
      state: row.state,
      teacherCode,
      createdAt: serverTimestamp(),
    }
    batch.set(schoolRef, school)
    batch.set(doc(db, 'teacherCodes', teacherCode), {
      eventId: eventRef.id,
      schoolId: schoolRef.id,
      schoolName: row.schoolName,
      state: row.state,
      createdAt: serverTimestamp(),
    })

    const classes = []
    for (const className of row.classes) {
      const classRef = doc(collection(db, 'events', eventRef.id, 'schools', schoolRef.id, 'classes'))
      const joinCode = await uniqueCode(db, 'joinCodes', newJoinCode)
      batch.set(classRef, {
        id: classRef.id,
        eventId: eventRef.id,
        schoolId: schoolRef.id,
        name: className,
        joinCode,
        createdAt: serverTimestamp(),
      })
      batch.set(doc(db, 'joinCodes', joinCode), {
        eventId: eventRef.id,
        schoolId: schoolRef.id,
        classId: classRef.id,
        schoolName: row.schoolName,
        className,
        state: row.state,
        createdAt: serverTimestamp(),
      })
      classes.push({ classId: classRef.id, className, joinCode })
    }
    output.schools.push({ schoolId: schoolRef.id, schoolName: row.schoolName, teacherCode, classes })
  }

  await batch.commit()

  const eventCount = (await getDocs(collection(db, 'events'))).size
  console.log(JSON.stringify({ ...output, eventCount }, null, 2))
}

seed().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
