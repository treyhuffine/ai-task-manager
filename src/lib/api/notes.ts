import { api } from './client';
import type {
  NoteRecord,
  CreateNoteInput,
  UpdateNoteInput,
  NoteFilter,
} from '@/db/types';

export const notesApi = {
  list(filter?: NoteFilter): Promise<NoteRecord[]> {
    return api.get<NoteRecord[]>('/notes', filter as Record<string, unknown>);
  },

  get(id: string): Promise<NoteRecord> {
    return api.get<NoteRecord>(`/notes/${id}`);
  },

  create(input: CreateNoteInput): Promise<NoteRecord> {
    return api.post<NoteRecord>('/notes', input);
  },

  update(id: string, input: UpdateNoteInput): Promise<NoteRecord> {
    return api.patch<NoteRecord>(`/notes/${id}`, input);
  },

  delete(id: string): Promise<void> {
    return api.delete(`/notes/${id}`);
  },
};
