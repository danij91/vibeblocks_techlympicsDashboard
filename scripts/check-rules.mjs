const projectId = process.env.FIREBASE_PROJECT_ID ?? process.env.VITE_FIREBASE_PROJECT_ID ?? 'demo-techlympics-rules'
const host = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080'
const base = `http://${host}/v1/projects/${projectId}/databases/(default)/documents`
const run = `r${Date.now().toString(36)}`
const eventId = `e-${run}`
const frozenEventId = `f-${run}`

function jwt(uid) {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(
    JSON.stringify({
      aud: projectId,
      iss: `https://securetoken.google.com/${projectId}`,
      sub: uid,
      user_id: uid,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      firebase: { sign_in_provider: 'anonymous' },
    }),
  ).toString('base64url')
  return `${header}.${payload}.`
}

function fields(value) {
  if (value === null) return { nullValue: null }
  if (typeof value === 'string') return { stringValue: value }
  if (typeof value === 'boolean') return { booleanValue: value }
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value }
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

function event(overrides = {}) {
  const startsAt = new Date('2026-01-01T00:00:00.000Z')
  const endsAt = new Date('2099-01-01T00:00:00.000Z')
  return {
    id: overrides.id ?? eventId,
    name: 'Rules Check',
    startsAt,
    endsAt,
    challenges: [
      { slot: 'c1', missionId: 201, name: 'Challenge 1' },
      { slot: 'c2', missionId: 202, name: 'Challenge 2' },
      { slot: 'c3', missionId: 203, name: 'Challenge 3' },
    ],
    attemptsPerChallenge: 3,
    visibility: 'code-only',
    scoringVersion: 'v2',
    frozen: false,
    createdAt: startsAt,
    ...overrides,
  }
}

function participant(id, ownerUid, publicId, overrides = {}) {
  const startsAt = new Date('2026-01-01T00:00:00.000Z')
  return {
    id,
    eventId,
    schoolId: 's1',
    classId: 'cls1',
    name: id === 'p1' ? 'Owner' : 'Other',
    publicId,
    status: 'approved',
    ownerUid,
    recoveryHash: `${id}-hash`,
    registeredAt: startsAt,
    statusHistory: [],
    ...overrides,
  }
}

function metrics(missionId, averageTimeSec, successRate = 1) {
  return {
    missionId,
    environment: 'gym',
    solveMode: 'ai',
    successRate,
    averageTimeSec,
    stars: successRate === 1 ? 4 : 1,
    blockCount: 2,
  }
}

async function seedFixture() {
  const startsAt = new Date('2026-01-01T00:00:00.000Z')
  await adminWrite(`events/${eventId}`, event())
  await adminWrite(`events/${eventId}/schools/s1`, {
    id: 's1',
    eventId,
    name: 'School',
    teacherCode: 'T-GOOD2345',
    createdAt: startsAt,
  })
  await adminWrite(`events/${eventId}/schools/s1/classes/cls1`, {
    id: 'cls1',
    eventId,
    schoolId: 's1',
    name: 'Class',
    joinCode: 'ABC234',
    createdAt: startsAt,
  })
  await adminWrite(`events/${eventId}/schools/s1/classes/cls1/participants/p1`, participant('p1', 'u1', 'P-2222'))
  await adminWrite(`events/${eventId}/schools/s1/classes/cls1/participants/p2`, participant('p2', 'u2', 'P-3333'))
  await adminWrite(`events/${eventId}/schools/s1/teachers/t1`, { code: 'T-GOOD2345', boundAt: startsAt })
  await adminWrite('roles/t1', { role: 'teacher', createdAt: startsAt })

  await adminWrite(`events/${frozenEventId}`, event({ id: frozenEventId, frozen: true }))
  await adminWrite(`events/${frozenEventId}/schools/s1/classes/cls1/participants/p1`, {
    ...participant('p1', 'u1', 'P-4444'),
    eventId: frozenEventId,
  })

  const c1 = [metrics(201, 50), metrics(201, 45), metrics(201, 47)]
  for (const [index, m] of c1.entries()) {
    const attemptNo = index + 1
    await adminWrite(`events/${eventId}/schools/s1/classes/cls1/participants/p1/attempts/p1_c1_${attemptNo}`, {
      slot: 'c1',
      attemptNo,
      metrics: m,
      submittedAt: startsAt,
    })
  }
  await adminWrite(`events/${eventId}/schools/s1/classes/cls1/participants/p1/attempts/p1_c3_1`, {
    slot: 'c3',
    attemptNo: 1,
    metrics: metrics(203, null, 0.5),
    submittedAt: startsAt,
  })
}

async function expectDenied(name, action) {
  const res = await action()
  if (res.ok) throw new Error(`${name}: expected denial, got ${res.status}`)
  console.log(`PASS denied: ${name} (${res.status})`)
}

async function expectAllowed(name, action) {
  const res = await action()
  if (!res.ok) throw new Error(`${name}: expected allow, got ${res.status} ${res.text}`)
  console.log(`PASS allowed: ${name} (${res.status})`)
}

async function main() {
  try {
    await fetch(`${base}`)
  } catch {
    throw new Error(`Firestore emulator is not reachable at ${host}. Start: firebase emulators:start --only firestore`)
  }
  await seedFixture()

  await expectDenied('slot 4th attempt', () =>
    request('PATCH', `events/${eventId}/schools/s1/classes/cls1/participants/p1/attempts/p1_c1_4`, 'u1', {
      slot: 'c1',
      attemptNo: 4,
      metrics: metrics(201, 40),
      submittedAt: new Date(),
    }),
  )

  await expectAllowed('different slot still available', () =>
    request('PATCH', `events/${eventId}/schools/s1/classes/cls1/participants/p1/attempts/p1_c2_1`, 'u1', {
      slot: 'c2',
      attemptNo: 1,
      metrics: metrics(202, 60),
      submittedAt: new Date(),
    }),
  )

  await expectDenied('frozen event attempt', () =>
    request('PATCH', `events/${frozenEventId}/schools/s1/classes/cls1/participants/p1/attempts/p1_c1_1`, 'u1', {
      slot: 'c1',
      attemptNo: 1,
      metrics: metrics(201, 50),
      submittedAt: new Date(),
    }),
  )

  await expectDenied('board forged with another attempt metrics', () =>
    request('PATCH', `events/${eventId}/schools/s1/classes/cls1/board/p1`, 'u1', {
      participantId: 'p1',
      publicId: 'P-2222',
      name: 'Owner',
      status: 'approved',
      bests: {
        c1: { attemptNo: 2, timeSec: 50, metrics: metrics(201, 50) },
      },
      updatedAt: new Date(),
    }),
  )

  await expectDenied('board forged with failed run', () =>
    request('PATCH', `events/${eventId}/schools/s1/classes/cls1/board/p1`, 'u1', {
      participantId: 'p1',
      publicId: 'P-2222',
      name: 'Owner',
      status: 'approved',
      bests: {
        c3: { attemptNo: 1, timeSec: 999, metrics: metrics(203, null, 0.5) },
      },
      updatedAt: new Date(),
    }),
  )

  await expectDenied('board forged with timeSec mismatch', () =>
    request('PATCH', `events/${eventId}/schools/s1/classes/cls1/board/p1`, 'u1', {
      participantId: 'p1',
      publicId: 'P-2222',
      name: 'Owner',
      status: 'approved',
      bests: {
        c1: { attemptNo: 1, timeSec: 55, metrics: metrics(201, 50) },
      },
      updatedAt: new Date(),
    }),
  )

  await expectDenied('teacher creates admin invite', () =>
    request('PATCH', `adminInvites/V-${run}ABC`, 't1', {
      createdBy: 't1',
      usedBy: null,
      createdAt: new Date(),
    }),
  )

  await expectDenied('self-created master role', () =>
    request('PATCH', `roles/u-master-${run}`, `u-master-${run}`, {
      role: 'master',
      createdAt: new Date(),
    }),
  )
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
