/** Local input that has not become an acknowledged server mutation yet. */
const active = new Set<object>();
export function retainActiveInput(owner: object, retained: boolean) { if (retained) active.add(owner); else active.delete(owner); }
export function hasActiveInput() { return active.size > 0; }
