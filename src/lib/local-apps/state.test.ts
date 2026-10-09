import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AppStateStore } from "./state";
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    fs.rmSync(dir, { recursive: true, force: true });
});
function store() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ri-app-state-"));
  dirs.push(dir);
  return new AppStateStore(path.join(dir, "state.json"));
}
describe("owner app metadata", () => {
  it('keeps a management review valid across activity writes',async()=>{
    const s=store();await s.initialize();const revision=s.read().revision;
    await s.activity(()=>{});
    expect(s.read().revision).toBe(revision);
    await s.edit(revision,()=>{});
    await expect(s.edit(revision,()=>{})).rejects.toMatchObject({code:'conflict'});
  });
  it("does not initialize metadata on read and rejects stale management edits", async () => {
    const s = store();
    expect(s.read().revision).toBe(0);
    expect(fs.existsSync(s.file)).toBe(false);
    await s.initialize();
    const revision = s.read().revision;
    await s.edit(revision, () => {});
    await expect(s.edit(revision, () => {})).rejects.toMatchObject({
      code: "conflict",
    });
  });
  it("serializes concurrent writes and never overwrites corrupt or unknown metadata", async () => {
    const s = store();
    await s.initialize();
    await Promise.all(
      Array.from({ length: 10 }, () => s.edit(undefined, () => {})),
    );
    expect(s.read().revision).toBe(11);
    fs.writeFileSync(s.file, '{"formatVersion":2}');
    expect(() => s.read()).toThrow(/repair/);
    await expect(s.edit(undefined, () => {})).rejects.toThrow();
    expect(fs.readFileSync(s.file, "utf8")).toBe('{"formatVersion":2}');
    fs.writeFileSync(s.file, "not json");
    await expect(s.initialize()).rejects.toThrow();
    expect(fs.readFileSync(s.file, "utf8")).toBe("not json");
  });
});
