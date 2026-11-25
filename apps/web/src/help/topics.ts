import {
  BookOpen,
  CircleCheck,
  Network,
  Send,
  Shapes,
  Stamp,
  Table,
  UserPlus,
  type LucideIcon,
} from 'lucide-react';

export type HelpSection = 'requests' | 'work' | 'knowledge';

export interface HelpTopic {
  /** Anchor on /help and the clip's file name; titles live under `help.topics.<id>`. */
  id: string;
  section: HelpSection;
  icon: LucideIcon;
  /** Recorded by scripts/help-clips; a missing file shows "coming soon" instead. */
  clip?: string;
}

export const HELP_SECTIONS: HelpSection[] = ['requests', 'work', 'knowledge'];

/** Served from apps/web/public/help, so clips ship inside the image and work offline. */
const clip = (id: string) => `/help/${id}.webm`;

export const HELP_TOPICS: HelpTopic[] = (
  [
    { id: 'request-other-department', section: 'requests', icon: Send },
    { id: 'request-several-departments', section: 'requests', icon: Network },
    { id: 'request-add-approvals', section: 'requests', icon: UserPlus },
    { id: 'approval-decide', section: 'requests', icon: Stamp },
    { id: 'issue-create', section: 'work', icon: CircleCheck },
    { id: 'wiki-page', section: 'knowledge', icon: BookOpen },
    { id: 'whiteboard-diagram', section: 'knowledge', icon: Shapes },
    { id: 'wiki-table', section: 'knowledge', icon: Table },
  ] satisfies Omit<HelpTopic, 'clip'>[]
).map((topic) => ({ ...topic, clip: clip(topic.id) }));
