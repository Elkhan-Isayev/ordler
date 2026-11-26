import {
  Ban,
  Bot,
  BookOpen,
  CalendarPlus,
  ChartLine,
  CircleCheck,
  IterationCw,
  KeyRound,
  ListPlus,
  Network,
  Send,
  Shapes,
  Stamp,
  Table,
  Undo2,
  UserPlus,
  type LucideIcon,
} from 'lucide-react';

export type HelpSection = 'requests' | 'work' | 'knowledge' | 'agents';

export interface HelpTopic {
  /** Anchor on /help and the clip's file name; titles live under `help.topics.<id>`. */
  id: string;
  section: HelpSection;
  icon: LucideIcon;
  /** Recorded by scripts/help-clips; a missing file shows "coming soon" instead. */
  clip?: string;
}

export const HELP_SECTIONS: HelpSection[] = ['requests', 'work', 'knowledge', 'agents'];

/** Served from apps/web/public/help, so clips ship inside the image and work offline. */
const clip = (id: string) => `/help/${id}.webm`;

export const HELP_TOPICS: HelpTopic[] = (
  [
    { id: 'request-other-department', section: 'requests', icon: Send },
    { id: 'request-several-departments', section: 'requests', icon: Network },
    { id: 'request-add-approvals', section: 'requests', icon: UserPlus },
    { id: 'approval-decide', section: 'requests', icon: Stamp },
    { id: 'issue-create', section: 'work', icon: CircleCheck },
    { id: 'issue-blocking', section: 'work', icon: Ban },
    { id: 'cycle-enable', section: 'work', icon: IterationCw },
    { id: 'cycle-add-issue', section: 'work', icon: CalendarPlus },
    { id: 'cycle-from-backlog', section: 'work', icon: ListPlus },
    { id: 'cycle-to-backlog', section: 'work', icon: Undo2 },
    { id: 'cycle-progress', section: 'work', icon: ChartLine },
    { id: 'wiki-page', section: 'knowledge', icon: BookOpen },
    { id: 'whiteboard-diagram', section: 'knowledge', icon: Shapes },
    { id: 'wiki-table', section: 'knowledge', icon: Table },
    { id: 'mcp-connect-claude', section: 'agents', icon: Bot },
    { id: 'mcp-token', section: 'agents', icon: KeyRound },
  ] satisfies Omit<HelpTopic, 'clip'>[]
).map((topic) => ({ ...topic, clip: clip(topic.id) }));
