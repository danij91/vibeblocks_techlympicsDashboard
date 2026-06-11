const projectId = process.env.FIREBASE_PROJECT_ID ?? process.env.VITE_FIREBASE_PROJECT_ID ?? 'demo-techlympics-rules'
const host = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080'
const base = `http://${host}/v1/projects/${projectId}/databases/(default)/documents`

function jwt(uid) {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({
    aud: projectId,
    iss: `https://securetoken.google.com/${projectId}`,
    sub: uid,
    user_id: uid,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
    firebase: { sign_in_provider: 'anonymous' },
  })).toString('base64url')
  return `${header}.${payload}.`
}

function fields(value) {
  if (value === null) return { nullValue: null }
  if (typeof value === 'string') return { stringValue: value }
  if (typeof value === 'boolean') return { booleanValue: value }
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value }
  }
  if (value instanceof Date) return { timestampValue: value.toISOString() }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(fields) } }
  return { mapValue: { fields: encodeFields(value) } }
}

function encodeFields(data) {
  return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, fields(value)]))
}

async function request(method, path, uid, data) {
  const res = await fetch(`${base}/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${jwt(uid)}`,
      'Content-Type': 'application/json',
    },
    body: data ? JSON.stringify({ fields: encodeFields(data) }) : undefined,
  })
  const text = await res.text()
  return { ok: res.ok, status: res.status, text }
}

async function adminWrite(path, data) {
  const res = await fetch(`${base}/${path}`, {
    method: 'PATCH',
    headers: {
      Authorization: 'Bearer owner',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields: encodeFields(data) }),
  })
  if (!res.ok) throw new Error(`admin write failed ${path}: ${res.status} ${await res.text()}`)
}

async function seedFixture() {
  const startsAt = new Date('2026-01-01T00:00:00.000Z')
  const endsAt = new Date('2099-01-01T00:00:00.000Z')
  await adminWrite('events/e1', {
    id: 'e1',
    name: 'Rules Check',
    startsAt,
    endsAt,
    maxAttempts: 3,
    visibility: 'code-only',
    scoringVersion: 'v1',
    frozen: false,
    createdAt: startsAt,
  })
  await adminWrite('events/e1/schools/s1', {
    id: 's1',
    eventId: 'e1',
    name: 'School',
    teacherCode: 'T-GOOD2345',
    createdAt: startsAt,
  })
  await adminWrite('events/e1/schools/s1/classes/c1', {
    id: 'c1',
    eventId: 'e1',
    schoolId: 's1',
    name: 'Class',
    joinCode: 'ABC234',
    createdAt: startsAt,
  })
  await adminWrite('events/e1/schools/s1/classes/c1/participants/p1', {
    id: 'p1',
    eventId: 'e1',
    schoolId: 's1',
    classId: 'c1',
    name: 'Owner',
    publicId: 'P-2222',
    status: 'approved',
    ownerUid: 'u1',
    recoveryHash: 'hash1',
    registeredAt: startsAt,
    statusHistory: [],
  })
  await adminWrite('events/e1/schools/s1/classes/c1/participants/p2', {
    id: 'p2',
    eventId: 'e1',
    schoolId: 's1',
    classId: 'c1',
    name: 'Other',
    publicId: 'P-3333',
    status: 'approved',
    ownerUid: 'u2',
    recoveryHash: 'hash2',
    registeredAt: startsAt,
    statusHistory: [],
  })
  await adminWrite('events/frozen', {
    id: 'frozen',
    name: 'Frozen',
    startsAt,
    endsAt,
    maxAttempts: 3,
    visibility: 'code-only',
    scoringVersion: 'v1',
    frozen: true,
    createdAt: startsAt,
  })
  await adminWrite('events/frozen/schools/s1/classes/c1/participants/p1', {
    id: 'p1',
    eventId: 'frozen',
    schoolId: 's1',
    classId: 'c1',
    name: 'Frozen Owner',
    publicId: 'P-4444',
    status: 'approved',
    ownerUid: 'u1',
    recoveryHash: 'hash3',
    registeredAt: startsAt,
    statusHistory: [],
  })
  for (const n of [1, 2, 3]) {
    await adminWrite(`events/e1/schools/s1/classes/c1/participants/p1/attempts/p1_${n}`, {
      attemptNo: n,
      metrics: metrics(n),
      submittedAt: startsAt,
    })
  }
}

function metrics(stars = 1) {
  return {
    missionId: 'm1',
    environment: 'gym',
    solveMode: 'ai',
    successRate: 1,
    averageTimeSec: 50,
    stars,
    blockCount: 2,
  }
}

async function expectDenied(name, action) {
  const res = await action()
  if (res.ok) throw new Error(`${name}: expected denial, got ${res.status}`)
  console.log(`PASS denied: ${name} (${res.status})`)
}

async function main() {
  try {
    await fetch(`${base}`)
  } catch {
    throw new Error(`Firestore emulator is not reachable at ${host}. Start: firebase emulators:start --only firestore`)
  }
  await seedFixture()
  await expectDenied('4th attempt', () =>
    request('PATCH', 'events/e1/schools/s1/classes/c1/participants/p1/attempts/p1_4', 'u1', {
      attemptNo: 4,
      metrics: metrics(4),
      submittedAt: new Date(),
    }),
  )
  await expectDenied('frozen attempt', () =>
    request('PATCH', 'events/frozen/schools/s1/classes/c1/participants/p1/attempts/p1_1', 'u1', {
      attemptNo: 1,
      metrics: metrics(1),
      submittedAt: new Date(),
    }),
  )
  await expectDenied('forged board for another participant', () =>
    request('PATCH', 'events/e1/schools/s1/classes/c1/board/p2', 'u1', {
      participantId: 'p2',
      publicId: 'P-3333',
      name: 'Other',
      status: 'approved',
      bestAttemptNo: 1,
      metrics: metrics(1),
      updatedAt: new Date(),
    }),
  )
  await expectDenied('bad teacher code binding', () =>
    request('PATCH', 'events/e1/schools/s1/teachers/t1', 't1', {
      code: 'T-BAD23456',
      boundAt: new Date(),
    }),
  )
  await expectDenied('ownerUid rebind without recovery claim', () =>
    request('PATCH', 'events/e1/schools/s1/classes/c1/participants/p1', 'u3', {
      id: 'p1',
      eventId: 'e1',
      schoolId: 's1',
      classId: 'c1',
      name: 'Owner',
      publicId: 'P-2222',
      status: 'approved',
      ownerUid: 'u3',
      recoveryHash: 'hash1',
      registeredAt: new Date('2026-01-01T00:00:00.000Z'),
      statusHistory: [],
    }),
  )
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
