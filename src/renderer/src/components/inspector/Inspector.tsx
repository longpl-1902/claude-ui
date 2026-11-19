import type { KeyboardEvent, ReactNode } from "react";
import { formatElapsed, formatTokens } from "@shared/format";
import {
  selectSelectedAgentOrNull,
  useAgentStatusInfo,
  useConsoleStore,
  type InspectorTab,
} from "../../store/useConsoleStore";
import type { Agent } from "@shared/types";
import { Avatar } from "../ui/Avatar";
import { Button } from "../ui/Button";
import { StatusPill } from "../ui/StatusPill";
import { ActivityTab } from "./ActivityTab";
import { FilesTab } from "./FilesTab";
import { MessagesTab } from "./MessagesTab";
import "./inspector.css";

const TABS: { id: InspectorTab; label: string }[] = [
  { id: "activity", label: "Activity" },
  { id: "files", label: "Files" },
  { id: "messages", label: "Messages" },
];
const tabId = (t: InspectorTab): string => `insp-tab-${t}`;
const PANEL_ID = "insp-panel";

export interface InspectorLayoutProps {
  /** Height (px) of the top section (header, stats, task, actions); the tabs fill the rest. */
  topHeight?: number;
  /** Rendered between the top section and the tabs (the resize handle, owned by TeamView). */
  splitter?: ReactNode;
}

export const INSPECTOR_TOP_ID = "ac-insp-top";

export function Inspector({ topHeight, splitter }: InspectorLayoutProps = {}): JSX.Element {
  const agent = useConsoleStore(selectSelectedAgentOrNull);
  const agentCount = useConsoleStore((s) => s.team.agents.length);
  if (!agent) {
    return (
      <aside className="insp" aria-label="Agent inspector">
        <h2 className="insp__name">Inspector</h2>
        <span className="insp-empty">
          {agentCount === 0 ? "No agents yet" : "Select an agent"}
        </span>
      </aside>
    );
  }
  return <InspectorBody agent={agent} topHeight={topHeight} splitter={splitter} />;
}

function InspectorBody({
  agent,
  topHeight,
  splitter,
}: { agent: Agent } & InspectorLayoutProps): JSX.Element {
  const info = useAgentStatusInfo(agent.id);
  const source = useConsoleStore((s) => s.team.source);
  const live = source !== "demo";
  const tab = useConsoleStore((s) => s.inspectorTab);
  const setInspectorTab = useConsoleStore((s) => s.setInspectorTab);
  const worktrees = useConsoleStore((s) => s.team.worktrees);
  const worktreePath = worktrees.find((w) => w.branch === agent.worktree)?.path;
  const setConsoleDraft = useConsoleStore((s) => s.setConsoleDraft);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const i = TABS.findIndex((t) => t.id === tab);
    const next =
      TABS[(i + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length]!;
    setInspectorTab(next.id);
    document.getElementById(tabId(next.id))?.focus();
  };

  const messageAgent = (): void => {
    setConsoleDraft(`@${agent.name} `);
    document.getElementById("ac-prompt")?.focus();
  };

  const stats = [
    ["Elapsed", formatElapsed(agent.elapsedSec)],
    ["Tokens", formatTokens(agent.tokens)],
    ["Tool calls", String(agent.toolCalls)],
  ];

  return (
    <aside className="insp" aria-label="Agent inspector">
      <div
        id={INSPECTOR_TOP_ID}
        className="insp__top"
        style={topHeight === undefined ? undefined : { height: topHeight }}
      >
      <div className="insp__head">
        <Avatar initials={agent.initials} color={agent.avatarColor} size={40} />
        <div className="insp__who">
          <span className="insp__name">{agent.name}</span>
          <span className="insp__sub">
            {[agent.role, agent.model && !agent.role.includes(agent.model) ? agent.model : '']
              .filter(Boolean)
              .join(' · ')}
          </span>
        </div>
        <span title={info.reason}>
          <StatusPill status={info.status} />
        </span>
      </div>
      {live && agent.cwd && (
        <div className="insp__sub" style={{ fontFamily: "var(--ac-font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={agent.cwd}>
          {agent.cwd}
        </div>
      )}

      <div className="insp__stats">
        {stats.map(([label, value]) => (
          <div key={label} className="insp__stat">
            <div className="insp__stat-label">{label}</div>
            <div className="insp__stat-value">{value}</div>
          </div>
        ))}
      </div>

      <div className="insp__task">
        <span className="insp__task-label">Assigned task</span>
        <span className="insp__task-title">{agent.taskTitle}</span>
        <span className="insp__task-wt">⎇ {live ? agent.worktree || "—" : agent.worktree}</span>
      </div>
      <div className="insp__actions">
        <Button
          size="lg"
          disabled={live}
          title={live ? "Arrives in Phase 3b" : undefined}
          onClick={messageAgent}
        >
          Message agent
        </Button>
        <Button
          size="lg"
          disabled={!worktreePath}
          title={worktreePath ? undefined : "No worktree path for this agent"}
          onClick={() => {
            if (worktreePath)
              void window.api?.worktree.openInEditor(worktreePath);
          }}
        >
          Open worktree
        </Button>
        <Button
          size="lg"
          disabled={live}
          title={live ? "Arrives in Phase 4" : undefined}
          onClick={() => void window.api?.agent.pause(agent.id)}
        >
          Pause
        </Button>
        <Button
          size="lg"
          variant="danger"
          disabled={live}
          title={live ? "Arrives in Phase 4" : undefined}
          onClick={() => void window.api?.agent.stop(agent.id)}
        >
          Stop
        </Button>
      </div>
      </div>
      {splitter}
      <div className="insp__bottom">
      <div
        role="tablist"
        aria-label="Agent details"
        className="insp__tabs"
        onKeyDown={onKeyDown}
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={tabId(t.id)}
            aria-selected={tab === t.id}
            aria-controls={PANEL_ID}
            tabIndex={tab === t.id ? 0 : -1}
            className={tab === t.id ? "insp__tab insp__tab--on" : "insp__tab"}
            onClick={() => setInspectorTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={PANEL_ID} aria-labelledby={tabId(tab)}>
        {tab === "activity" && <ActivityTab items={agent.activity} />}
        {tab === "files" && <FilesTab files={agent.files} />}
        {tab === "messages" && <MessagesTab messages={agent.messages} />}
      </div>
      </div>
    </aside>
  );
}
