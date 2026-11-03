import { get as idbGet, set as idbSet } from 'idb-keyval';
import { useApp } from './store';
import { emptyModel, type Model } from './types';
import { log } from '../log/sessionLog';
import { applySavedMeta, metaOf, useUnderlay } from '../underlay/store';
import { renumber, spanKey } from '../stair/stair';

const KEY = 'stair-model';

/** Saved model over the defaults, minus spans left on a story that was deleted (older files kept them). */
export function loaded(saved: Partial<Model>): Model {
  const m = { ...emptyModel(), ...saved };
  const names = new Set(m.stories.map((s) => s.name));
  const spans = m.spans.filter((sp) => names.has(sp.story));
  if (spans.length === m.spans.length) return m;
  log('file', `Dropped ${m.spans.length - spans.length} span(s) on deleted stories`);
  const n = { ...m, spans };
  return { ...n, spans: renumber(spans, 'S', (sp) => spanKey(n, sp)) };
}

export async function restoreModel() {
  const m = (await idbGet(KEY)) as Model | undefined;
  if (m && Array.isArray(m.stories)) useApp.getState().setModel(loaded(m));
}

let t = 0;
export function startAutosave() {
  useApp.subscribe((s, prev) => {
    if (s.dirty === prev.dirty) return;
    clearTimeout(t);
    t = window.setTimeout(() => idbSet(KEY, useApp.getState().model), 600);
  });
}

const projectJson = () => JSON.stringify({ app: 'stair-design', version: 1, model: useApp.getState().model, underlay: metaOf(useUnderlay.getState()) });

// File System Access API (Chromium); lib.dom has no types for it yet
type Writable = { write(d: string): Promise<void>; close(): Promise<void> };
type FileHandle = { name: string; createWritable(): Promise<Writable> };
type DirHandle = { name: string };
const fsa = window as unknown as {
  showDirectoryPicker?: (o: object) => Promise<DirHandle>;
  showSaveFilePicker?: (o: object) => Promise<FileHandle>;
};
const FOLDER_KEY = 'work-folder';
/** File the last Save As wrote; Save overwrites it. Cleared on New and Open. */
let saveTarget: FileHandle | null = null;
export const clearSaveTarget = () => void (saveTarget = null);

const userAborted = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';
const fail = (e: unknown) => userAborted(e) || useApp.getState().setToast('Save error: ' + (e as Error).message);

export async function chooseWorkFolder() {
  if (!fsa.showDirectoryPicker) return useApp.getState().setToast('This browser cannot pick folders (use Chrome or Edge)');
  try {
    const d = await fsa.showDirectoryPicker({ id: 'stair-work', mode: 'readwrite', startIn: (await idbGet(FOLDER_KEY)) ?? 'documents' });
    await idbSet(FOLDER_KEY, d);
    log('file', `Working folder: ${d.name}`);
  } catch (e) {
    fail(e);
  }
}

async function writeTo(h: FileHandle) {
  const w = await h.createWritable();
  await w.write(projectJson());
  await w.close();
  log('file', `Saved ${h.name}`);
}

export async function saveProjectAs() {
  if (!fsa.showSaveFilePicker) return downloadFile();
  try {
    const h = await fsa.showSaveFilePicker({
      suggestedName: saveTarget?.name ?? 'stair.sd.json',
      startIn: saveTarget ?? (await idbGet(FOLDER_KEY)) ?? 'documents',
      types: [{ description: 'Stair Design project', accept: { 'application/json': ['.sd.json', '.json'] } }],
    });
    await writeTo(h);
    saveTarget = h;
  } catch (e) {
    fail(e);
  }
}

export function downloadProject() {
  if (saveTarget) return writeTo(saveTarget).catch(fail);
  if (fsa.showSaveFilePicker) return saveProjectAs();
  downloadFile();
}

function downloadFile() {
  const blob = new Blob([projectJson()], { type: 'application/json' });
  log('file', 'Saved stair.sd.json');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'stair.sd.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export async function openProject(file: File) {
  const j = JSON.parse(await file.text());
  if (!j.model) throw new Error('Not a Stair Design project');
  clearSaveTarget();
  useApp.getState().setModel(loaded(j.model));
  // keep the loaded underlay file, apply saved scale/placement only if it is the same file
  if (j.underlay) applySavedMeta(j.underlay);
}
