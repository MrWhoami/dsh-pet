/**
 * The ledger's remark pools are fed from two layers: the pet manifest's own
 * pools (`remarks` in pet.json) and the voice packs (a pet directory's
 * voice.json over the global `$DSH_HOME/pets/.voice.json`). The service seats
 * both layers on startup, on a pet switch, and whenever the settings surface
 * applies a committed section. A call site that passed only the manifest layer
 * dropped every voice-pack line, so a pet whose remarks a voice pack had
 * translated answered from the built-in pools again as soon as the settings
 * surface applied - which is immediately, since it applies on every change.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { loadPetRegistry, petPackageRoot } from './registry.ts'
import { PetService, type PetSettingsSection } from './service.ts'

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'dsh-pet-service-'))
}

/** A root context stub: the service registers itself and listens for events. */
function fakeRootContext(): Context {
  return {
    reflect: { provide: () => {} },
    on: () => () => {},
    get: () => undefined,
  } as unknown as Context
}

/**
 * A service over the shipped pets plus one temporary user directory carrying the
 * given voice-pack remark pools. `petsDir` is disabled so the legacy hatch-pet
 * source cannot leak the machine's own pets into the fixture.
 */
function serviceWithVoicePack(remarks: Record<string, string[]>): PetService {
  const petsDir = tempDir()
  writeFileSync(join(petsDir, '.voice.json'), JSON.stringify({ voicePackVersion: 1, remarks }))
  const registry = loadPetRegistry({
    packageRoot: petPackageRoot(import.meta.url),
    petsDir: '',
    dshPetsDir: petsDir,
  })
  return new PetService(fakeRootContext(), { registry, persistDir: tempDir() })
}

/**
 * A service over the shipped pets plus one temporary pet directory whose pet.json
 * declares no remark pools and whose voice.json carries them - the writing the
 * voice-pack docs recommend (a pet's lines live in one place). `petsDir` is
 * disabled so the legacy hatch-pet source cannot leak the machine's own pets.
 */
function serviceWithPetVoicePack(id: string, remarks: Record<string, string[]>): PetService {
  const petsDir = tempDir()
  const petDir = join(petsDir, id)
  mkdirSync(petDir, { recursive: true })
  writeFileSync(join(petDir, 'pet.json'), JSON.stringify({
    petManifestVersion: 2,
    id,
    displayName: 'Mumbler',
    license: 'CC0-1.0',
    renderer: 'sprite2d',
    sprite2d: { spritesheetPath: 'spritesheet.webp' },
  }), 'utf8')
  writeFileSync(join(petDir, 'spritesheet.webp'), 'webp', 'utf8')
  writeFileSync(join(petDir, 'voice.json'), JSON.stringify({ voicePackVersion: 1, remarks }), 'utf8')
  const registry = loadPetRegistry({
    packageRoot: petPackageRoot(import.meta.url),
    petsDir: '',
    dshPetsDir: petsDir,
  })
  return new PetService(fakeRootContext(), { registry, persistDir: tempDir() })
}

/**
 * A service whose global voice pack and one pet directory each declare a
 * display-only rank ladder, so the merge precedence is observable end to end.
 */
function serviceWithRankLadders(): PetService {
  const petsDir = tempDir()
  writeFileSync(join(petsDir, '.voice.json'), JSON.stringify({
    voicePackVersion: 1,
    panel: { ranks: [{ min: 0, name: '通用小鲸' }, { min: 25, name: '通用伙伴' }] },
  }), 'utf8')
  const petDir = join(petsDir, 'coalball')
  mkdirSync(petDir, { recursive: true })
  writeFileSync(join(petDir, 'pet.json'), JSON.stringify({
    petManifestVersion: 2,
    id: 'coalball',
    displayName: '黑煤球',
    license: 'CC0-1.0',
    renderer: 'sprite2d',
    sprite2d: { spritesheetPath: 'spritesheet.webp' },
  }), 'utf8')
  writeFileSync(join(petDir, 'spritesheet.webp'), 'webp', 'utf8')
  writeFileSync(join(petDir, 'voice.json'), JSON.stringify({
    voicePackVersion: 1,
    panel: { ranks: [{ min: 0, name: '小煤球', nameEn: 'Little Coal Ball' }] },
  }), 'utf8')
  const registry = loadPetRegistry({
    packageRoot: petPackageRoot(import.meta.url),
    petsDir: '',
    dshPetsDir: petsDir,
  })
  return new PetService(fakeRootContext(), { registry, persistDir: tempDir() })
}

/** The display fields the settings surface always commits. */
function section(petId: string): PetSettingsSection {
  return { petId, visible: true, size: 160, right: 24, bottom: 20 }
}

describe('PetService remark layers', () => {
  it('keeps a stable instance id until the service is recreated', async () => {
    const first = serviceWithVoicePack({})
    const second = serviceWithVoicePack({})
    const id = (await first.state()).serviceInstanceId
    expect(id).toEqual(expect.any(String))
    expect((await first.state()).serviceInstanceId).toBe(id)
    expect((await second.state()).serviceInstanceId).not.toBe(id)
  })
  it('user keeps the voice-pack remarks after the settings surface applies a section', async () => {
    const voice = { pet: ['Голос: погладили'], noTreats: ['Голос: нет угощений'] }
    const service = serviceWithVoicePack(voice)

    // The startup path seats both layers: the first petting answers from the
    // voice pack.
    expect((await service.interact('pet')).reaction).toBe(voice.pet[0])

    // Applying a section re-seats the pools. The voice layer must survive it;
    // this is the regression: the manifest layers alone came back, so the pet
    // answered from the built-in pools again.
    service.applySettingsSection(section(service.selectedPetId()))
    expect((await service.interact('feed')).reaction).toBe(voice.noTreats[0])
  })

  it('user keeps the voice-pack remarks after switching pets through the RPC', async () => {
    const voice = { pet: ['Голос: погладили'], noTreats: ['Голос: нет угощений'] }
    const service = serviceWithVoicePack(voice)
    // A pet whose own manifest declares no remark pools: the voice pack is its
    // only layer. A manifest-declared pool outranks the voice packs by contract
    // (RemarkPicker: manifest, then voice, then built-in), so such a pet is not
    // what this case pins.
    const other = service
      .registrySnapshot()
      .entries
      .find(entry => entry.id !== service.selectedPetId() && entry.remarks === undefined)

    expect(other).toBeDefined()
    expect(await service.setPetId(other!.id)).toEqual({ ok: true, petId: other!.id })
    expect((await service.interact('feed')).reaction).toBe(voice.noTreats[0])
  })

  it('uses the declared rank ladder and keeps it across switches and settings applies', async () => {
    const service = serviceWithRankLadders()
    const whale = service.selectedPetId()
    expect(whale).not.toBe('coalball')

    // A pet with no ladder of its own inherits the global one.
    const whaleView = await service.state()
    expect(whaleView.affinity.rank).toBe('通用小鲸')
    expect(whaleView.affinity.rankEn).toBeUndefined()

    // The pet's own ladder replaces the global ladder whole.
    expect(await service.setPetId('coalball')).toEqual({ ok: true, petId: 'coalball' })
    const petView = await service.state()
    expect(petView.affinity.rank).toBe('小煤球')
    expect(petView.affinity.rankEn).toBe('Little Coal Ball')

    // The settings surface re-seats the pet on every change; the ladder rides
    // the same resolver as the remarks, so it must survive that apply.
    service.applySettingsSection(section('coalball'))
    const applied = await service.state()
    expect(applied.affinity.rank).toBe('小煤球')
    expect(applied.affinity.rankEn).toBe('Little Coal Ball')

    // Switching back restores the global ladder.
    await service.setPetId(whale)
    expect((await service.state()).affinity.rank).toBe('通用小鲸')
  })

  it('user keeps a pet-directory voice pack remarks after the settings surface applies a section', async () => {
    const voice = { pet: ['呼……好多了'], noTreats: ['现在不困啦～'] }
    const service = serviceWithPetVoicePack('mumbler', voice)

    // The reported repro (issue #10): the pet declares no remarks in pet.json,
    // so its own voice pack is the only layer, and the settings surface applies
    // a committed section on every change - that apply seats the pet and its
    // pools. The voice layer has to survive it, or the pet answers from the
    // built-in pools while its panel copy stays translated.
    service.applySettingsSection(section('mumbler'))
    expect(service.selectedPetId()).toBe('mumbler')
    expect((await service.interact('pet')).reaction).toBe(voice.pet[0])
    expect((await service.interact('feed')).reaction).toBe(voice.noTreats[0])
  })

  it('projects the desktop companion flag only while it runs', async () => {
    const service = serviceWithVoicePack({})

    service.desktopOverlayRunningProvider = () => true
    expect((await service.state()).desktopOverlayRunning).toBe(true)

    // The browser half hides its sprite only while the separate window owns
    // the pet; a stopped/crashed companion drops the flag on the next poll.
    service.desktopOverlayRunningProvider = () => false
    expect((await service.state()).desktopOverlayRunning).toBeUndefined()
  })

  it('projects client-supplied session titles above the bubble body', async () => {
    const handlers: Array<(session: unknown, event: unknown) => void> = []
    const ctx = {
      reflect: { provide: () => {} },
      on: (event: string, handler: (session: unknown, event: unknown) => void) => {
        if (event === 'session/event') handlers.push(handler)
        return () => {}
      },
      get: () => undefined,
    } as unknown as Context
    const petsDir = tempDir()
    writeFileSync(join(petsDir, '.voice.json'), JSON.stringify({ voicePackVersion: 1, remarks: {} }))
    const registry = loadPetRegistry({
      packageRoot: petPackageRoot(import.meta.url),
      petsDir: '',
      dshPetsDir: petsDir,
    })
    const service = new PetService(ctx, { registry, persistDir: tempDir() })
    const session = { id: 'session-title', header: { origin: 'user' } }
    service.setSessionTitles({ 'session-title': '分析 Playwright CI 报错' })
    for (const handler of handlers) {
      handler(session, { type: 'activity/status', data: { phase: 'thinking', line: '正在思考' } })
    }
    const view = await service.state()
    expect(view.sessions?.find(entry => entry.sessionId === 'session-title')).toMatchObject({
      title: '分析 Playwright CI 报错',
      bubble: '正在思考',
    })
    service.setSessionTitles({ 'session-title': 'A'.repeat(79) + '\u{1F600}' + 'tail' })
    const title = (await service.state()).sessions?.find(entry => entry.sessionId === 'session-title')?.title
    expect(title).toBe('A'.repeat(79) + '\u{1F600}')
    expect(title?.isWellFormed()).toBe(true)
    service.setSessionTitles({ phone: 'Phone title' }, true)
    expect((await service.state()).sessions?.find(entry => entry.sessionId === 'session-title')?.title).toBe(title)
    service.setSessionTitles({ 'session-title': 'Renamed remotely' }, true)
    expect((await service.state()).sessions?.find(entry => entry.sessionId === 'session-title')?.title).toBe('Renamed remotely')
    service.setSessionTitles(null, true)
    expect((await service.state()).sessions?.find(entry => entry.sessionId === 'session-title')?.title).toBe('Renamed remotely')
    service.setSessionTitles(Object.fromEntries(Array.from({ length: 200 }, (_, id) => ['recent-' + id, 'Recent'])), true)
    expect((await service.state()).sessions?.find(entry => entry.sessionId === 'session-title')?.title).toBeUndefined()
    for (const titles of [{}, { 'session-title': '' }, { 'session-title': '   ' }]) {
      service.setSessionTitles({ 'session-title': 'Old title' })
      service.setSessionTitles(titles, false)
      expect((await service.state()).sessions?.find(entry => entry.sessionId === 'session-title')?.title).toBeUndefined()
    }
    service.setSessionTitles({ 'session-title': 'Local' }, false, 'local:a')
    service.setSessionTitles({ 'session-title': 'Phone' }, false, 'remote:b')
    expect((await service.state()).sessions?.find(entry => entry.sessionId === 'session-title')?.title).toBe('Phone')
    service.setSessionTitles({}, false, 'remote:b')
    expect((await service.state()).sessions?.find(entry => entry.sessionId === 'session-title')?.title).toBe('Local')
    service.setSessionTitles({}, false, 'local:a')
    expect((await service.state()).sessions?.find(entry => entry.sessionId === 'session-title')?.title).toBeUndefined()
    const full = { 'session-title': 'Surviving page', ...Object.fromEntries(Array.from({ length: 199 }, (_, i) => ['shared-' + i, 'Title'])) }
    service.setSessionTitles(full, false, 'local:a')
    service.setSessionTitles({ ...full, 'session-title': 'Latest page' }, false, 'remote:b')
    expect((await service.state()).sessions?.find(entry => entry.sessionId === 'session-title')?.title).toBe('Latest page')
    service.setSessionTitles({}, false, 'remote:b')
    expect((await service.state()).sessions?.find(entry => entry.sessionId === 'session-title')?.title).toBe('Surviving page')
    // Bound sources independently even when all of them refer to the same session.
    for (let i = 0; i < 256; i++) service.setSessionTitles({ 'session-title': String(i) }, false, 'page-' + i)
    for (let i = 0; i < 256; i++) service.setSessionTitles({}, false, 'page-' + i)
    expect((await service.state()).sessions?.find(entry => entry.sessionId === 'session-title')?.title).toBeUndefined()
  })
})
