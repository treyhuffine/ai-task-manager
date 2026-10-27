import { Cable, Cpu, Mic, Globe, LayoutGrid, ScrollText, Settings, User, Users } from 'lucide-react';

export const TEAM_SETTINGS_SECTIONS = [
  { id: 'general', label: 'General', title: 'General', icon: Settings, description: 'The team name and the computer hosting it.', ownerOnly: false },
  { id: 'people', label: 'People', title: 'People', icon: Users, description: 'Team members and invitations.', ownerOnly: false },
  { id: 'ai', label: 'AI & Models', title: 'AI & Models', icon: Cpu, description: 'Shared AI chats inside Ri, sign-in and model preferences.', ownerOnly: false },
  { id: 'voice', label: 'Voice', title: 'Voice', icon: Mic, description: 'Your voice model and auto-send preference for this team.', ownerOnly: false },
  { id: 'skills', label: 'Skills', title: 'Skills', icon: ScrollText, description: 'Skills installed for the team’s agent chats.', ownerOnly: false },
  { id: 'remote', label: 'Remote access', title: 'Remote access', icon: Globe, description: 'The address people use to reach this team.', ownerOnly: true },
  { id: 'areas', label: 'Areas', title: 'Areas', icon: LayoutGrid, description: 'Optional groups for the team’s tasks and notes.', ownerOnly: false },
  { id: 'access', label: 'Your access', title: 'Your access', icon: User, description: 'Your name, sign-ins and connection to your personal Ri.', ownerOnly: false },
  { id: 'external-ai', label: 'Connect your agent', title: 'Connect your agent to the team’s MCP', icon: Cable, description: 'Let Claude Code, Codex, Cursor and other agents read and update the team’s tasks, notes and decisions.', ownerOnly: false },
] as const;

export type TeamSettingsSectionId = typeof TEAM_SETTINGS_SECTIONS[number]['id'];

export function teamSettingsSection(value: string | null | undefined, owner: boolean) {
  return TEAM_SETTINGS_SECTIONS.find(section => section.id === value && (owner || !section.ownerOnly)) ?? TEAM_SETTINGS_SECTIONS[0];
}
